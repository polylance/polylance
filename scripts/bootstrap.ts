import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

export async function bootstrapRoles(): Promise<boolean> {
  const [deployer] = await ethers.getSigners();
  const networkObj = await ethers.provider.getNetwork();
  const network = networkObj.name === "unknown" ? "hardhat" : networkObj.name;

  const YOUR_WALLET = process.env.JUDGE_1_ADDRESS || "";
  const TEAM_MEMBER_WALLET = process.env.JUDGE_2_ADDRESS || "";
  const TREASURY_SAFE_ADDRESS = process.env.TREASURY_SAFE_ADDRESS || ""; // 2-of-2 Safe, NOT an EOA
  const ORACLE_SIGNING_ADDRESS = process.env.ORACLE_ADDRESS || ""; // your githubScorer.js signing key's address

  const missing = [
    ["JUDGE_1_ADDRESS", YOUR_WALLET],
    ["JUDGE_2_ADDRESS", TEAM_MEMBER_WALLET],
    ["TREASURY_SAFE_ADDRESS", TREASURY_SAFE_ADDRESS],
    ["ORACLE_ADDRESS", ORACLE_SIGNING_ADDRESS],
  ].filter(([, val]) => !val);

  if (missing.length > 0) {
    console.error("Missing required env vars:", missing.map(([k]) => k).join(", "));
    console.error("Set these before running bootstrap — refusing to proceed with placeholders.");
    throw new Error(`Bootstrap failed: missing env vars ${missing.map(([k]) => k).join(", ")}`);
  }

  const manifestPath = path.join(__dirname, "..", "deployments", `${network}_addresses.json`);
  if (!fs.existsSync(manifestPath)) {
    console.error(`No deployment manifest found at ${manifestPath}. Run deploy.ts first.`);
    throw new Error(`No deployment manifest found at ${manifestPath}`);
  }
  const addresses = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

  console.log("═══════════════════════════════════════");
  console.log(" PolyLance MVP Bootstrap");
  console.log("═══════════════════════════════════════");
  console.log("Network:", network);
  console.log("Judge 1:", YOUR_WALLET);
  console.log("Judge 2:", TEAM_MEMBER_WALLET);
  console.log("Treasury Safe:", TREASURY_SAFE_ADDRESS);
  console.log("Oracle:", ORACLE_SIGNING_ADDRESS);
  console.log("═══════════════════════════════════════\n");

  const factory = await ethers.getContractAt("JobFactory", addresses.JobFactory);
  const githubRegistry = await ethers.getContractAt("GithubReputationRegistry", addresses.GithubReputationRegistry);

  // ── 1. Grant ARBITRATOR_ROLE to the 2 founding judges ──
  console.log("1/5 Granting ARBITRATOR_ROLE...");
  const ARBITRATOR_ROLE = await factory.ARBITRATOR_ROLE();
  let tx = await factory.grantRole(ARBITRATOR_ROLE, YOUR_WALLET);
  await tx.wait();
  tx = await factory.grantRole(ARBITRATOR_ROLE, TEAM_MEMBER_WALLET);
  await tx.wait();
  console.log("    ✓ Both judges granted ARBITRATOR_ROLE");

  // ── 2. Grant TREASURY_ADMIN_ROLE to the Safe — NOT an EOA ──
  console.log("2/5 Granting TREASURY_ADMIN_ROLE to Safe...");
  const TREASURY_ADMIN_ROLE = await factory.TREASURY_ADMIN_ROLE();
  tx = await factory.grantRole(TREASURY_ADMIN_ROLE, TREASURY_SAFE_ADDRESS);
  await tx.wait();
  console.log("    ✓ Treasury control granted to Safe:", TREASURY_SAFE_ADDRESS);

  // ── 3. Grant ORACLE_OPERATOR_ROLE for GitHub verification ──
  console.log("3/5 Granting ORACLE_OPERATOR_ROLE...");
  const ORACLE_OPERATOR_ROLE = await githubRegistry.ORACLE_OPERATOR_ROLE();
  tx = await githubRegistry.grantRole(ORACLE_OPERATOR_ROLE, ORACLE_SIGNING_ADDRESS);
  await tx.wait();
  console.log("    ✓ Oracle operator granted:", ORACLE_SIGNING_ADDRESS);

  // ── 4. Verify every grant actually landed — don't trust tx success alone ──
  console.log("4/5 Verifying role grants...");
  const checks: [string, boolean][] = [
    ["Judge 1 has ARBITRATOR_ROLE", await factory.hasRole(ARBITRATOR_ROLE, YOUR_WALLET)],
    ["Judge 2 has ARBITRATOR_ROLE", await factory.hasRole(ARBITRATOR_ROLE, TEAM_MEMBER_WALLET)],
    ["Safe has TREASURY_ADMIN_ROLE", await factory.hasRole(TREASURY_ADMIN_ROLE, TREASURY_SAFE_ADDRESS)],
    ["Oracle has ORACLE_OPERATOR_ROLE", await githubRegistry.hasRole(ORACLE_OPERATOR_ROLE, ORACLE_SIGNING_ADDRESS)],
  ];
  let allPassed = true;
  for (const [label, result] of checks) {
    console.log(`    ${result ? "✓" : "✗"} ${label}`);
    if (!result) allPassed = false;
  }
  if (!allPassed) {
    console.error("\nOne or more role grants failed verification. Stopping — do not proceed to Step 5.");
    throw new Error("One or more role grants failed verification.");
  }

  // ── 5. Optional: transfer DEFAULT_ADMIN_ROLE to the Safe too ──
  //     Only run this once everything above is confirmed working —
  //     this is the point of no easy return for direct admin access
  const TRANSFER_ADMIN = process.env.TRANSFER_ADMIN_TO_SAFE === "true";
  if (TRANSFER_ADMIN) {
    console.log("5/5 Transferring DEFAULT_ADMIN_ROLE to Safe...");
    const DEFAULT_ADMIN_ROLE = await factory.DEFAULT_ADMIN_ROLE();
    tx = await factory.grantRole(DEFAULT_ADMIN_ROLE, TREASURY_SAFE_ADDRESS);
    await tx.wait();

    // Verify the Safe actually has it BEFORE renouncing deployer's —
    // renouncing first with a bad Safe address is unrecoverable
    const safeHasAdmin = await factory.hasRole(DEFAULT_ADMIN_ROLE, TREASURY_SAFE_ADDRESS);
    if (!safeHasAdmin) {
      console.error("    ✗ Safe does not have DEFAULT_ADMIN_ROLE after grant — NOT renouncing deployer's role.");
      throw new Error("Safe does not have DEFAULT_ADMIN_ROLE after grant.");
    }
    tx = await factory.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address);
    await tx.wait();
    console.log("    ✓ DEFAULT_ADMIN_ROLE transferred to Safe, deployer renounced");
  } else {
    console.log("5/5 Skipping DEFAULT_ADMIN_ROLE transfer (set TRANSFER_ADMIN_TO_SAFE=true to enable).");
    console.log("    Deployer still holds admin — fine for initial testnet iteration,");
    console.log("    must be transferred before any real funds flow through this.");
  }

  console.log("\n═══════════════════════════════════════");
  console.log(" Bootstrap complete.");
  console.log("═══════════════════════════════════════\n");

  return true;
}

if (require.main === module) {
  bootstrapRoles().catch((error) => {
    console.error("Bootstrap failed:", error);
    process.exitCode = 1;
  });
}
