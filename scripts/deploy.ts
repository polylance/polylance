import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

export interface DeploymentAddresses {
  JobEscrowImplementation: string;
  JobFactory: string;
  ReputationSBT: string;
  ProfileRegistry: string;
  GithubReputationRegistry: string;
  JudgeDAO: string;
  deployedAt: string;
  network: string;
  deployerAddress: string;
}

export async function deployContracts(): Promise<DeploymentAddresses> {
  const [deployer] = await ethers.getSigners();
  const networkObj = await ethers.provider.getNetwork();
  const network = networkObj.name === "unknown" ? "hardhat" : networkObj.name;

  console.log("═══════════════════════════════════════");
  console.log(" PolyLance MVP Deployment");
  console.log("═══════════════════════════════════════");
  console.log("Network:", network);
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "MATIC");
  console.log("═══════════════════════════════════════\n");

  // ── 1. JobEscrow implementation (deployed once, cloned per job) ──
  console.log("1/6 Deploying JobEscrow implementation...");
  const JobEscrow = await ethers.getContractFactory("JobEscrow");
  const jobEscrowImpl = await JobEscrow.deploy();
  await jobEscrowImpl.waitForDeployment();
  const jobEscrowImplAddr = await jobEscrowImpl.getAddress();
  console.log("    ✓", jobEscrowImplAddr);

  // ── 2. ReputationSBT (needs factory address, so deploy factory first ──
  //     with a placeholder, OR restructure to grant MINTER_ROLE post-deploy —
  //     going with post-deploy grant since it's cleaner than a 2-step constructor dance)
  console.log("2/6 Deploying ReputationSBT...");
  const ReputationSBT = await ethers.getContractFactory("ReputationSBT");
  const sbt = await ReputationSBT.deploy(deployer.address); // deployer temporarily, re-granted below
  await sbt.waitForDeployment();
  const sbtAddr = await sbt.getAddress();
  console.log("    ✓", sbtAddr);

  // ── 3. JobFactory ──
  console.log("3/6 Deploying JobFactory...");
  const JobFactory = await ethers.getContractFactory("JobFactory");
  const factory = await JobFactory.deploy(jobEscrowImplAddr, sbtAddr);
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log("    ✓", factoryAddr);

  // Grant JobFactory the real MINTER_ROLE on the SBT, revoke deployer's
  console.log("    Granting MINTER_ROLE to JobFactory...");
  const MINTER_ROLE = await sbt.MINTER_ROLE();
  let tx = await sbt.grantRole(MINTER_ROLE, factoryAddr);
  await tx.wait();
  tx = await sbt.revokeRole(MINTER_ROLE, deployer.address);
  await tx.wait();
  console.log("    ✓ MINTER_ROLE moved to JobFactory, revoked from deployer");

  // ── 4. ProfileRegistry ──
  console.log("4/6 Deploying ProfileRegistry...");
  const ProfileRegistry = await ethers.getContractFactory("ProfileRegistry");
  const profileRegistry = await ProfileRegistry.deploy();
  await profileRegistry.waitForDeployment();
  const profileRegistryAddr = await profileRegistry.getAddress();
  console.log("    ✓", profileRegistryAddr);

  // ── 5. GithubReputationRegistry ──
  console.log("5/6 Deploying GithubReputationRegistry...");
  const GithubReputationRegistry = await ethers.getContractFactory("GithubReputationRegistry");
  const githubRegistry = await GithubReputationRegistry.deploy();
  await githubRegistry.waitForDeployment();
  const githubRegistryAddr = await githubRegistry.getAddress();
  console.log("    ✓", githubRegistryAddr);

  // ── 6. JudgeDAO (needs SBT as the votes token — SBT already deployed) ──
  console.log("6/6 Deploying JudgeDAO...");
  const JudgeDAO = await ethers.getContractFactory("JudgeDAO");
  const judgeDAO = await JudgeDAO.deploy(sbtAddr);
  await judgeDAO.waitForDeployment();
  const judgeDAOAddr = await judgeDAO.getAddress();
  console.log("    ✓", judgeDAOAddr);

  // ── Write manifest — single source of truth, learned this the hard
  //     way across this whole project's earlier address-chaos problems ──
  const addresses: DeploymentAddresses = {
    JobEscrowImplementation: jobEscrowImplAddr,
    JobFactory: factoryAddr,
    ReputationSBT: sbtAddr,
    ProfileRegistry: profileRegistryAddr,
    GithubReputationRegistry: githubRegistryAddr,
    JudgeDAO: judgeDAOAddr,
    deployedAt: new Date().toISOString(),
    network,
    deployerAddress: deployer.address,
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });

  const manifestPath = path.join(deploymentsDir, `${network}_addresses.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(addresses, null, 2));

  // Also maintain root amoy_deployment_addresses.json for backwards compatibility if network is amoy
  if (network === "amoy" || network === "polygonAmoy") {
    const rootPath = path.join(__dirname, "..", "amoy_deployment_addresses.json");
    fs.writeFileSync(rootPath, JSON.stringify({ network, chainId: "80002", deployedAt: addresses.deployedAt, deployer: deployer.address, contracts: { JobEscrowImpl: jobEscrowImplAddr, ReputationSBT: sbtAddr, JobFactory: factoryAddr, ProfileRegistry: profileRegistryAddr, GithubReputationRegistry: githubRegistryAddr, JudgeDAO: judgeDAOAddr } }, null, 2));
  }

  console.log("\n═══════════════════════════════════════");
  console.log(" Deployment complete. Manifest written to:");
  console.log(" ", manifestPath);
  console.log("═══════════════════════════════════════");
  console.log("\nNext: run bootstrap.ts to configure roles before this is usable.\n");

  return addresses;
}

if (require.main === module) {
  deployContracts().catch((error) => {
    console.error("Deployment failed:", error);
    process.exitCode = 1;
  });
}
