import { ethers } from "hardhat";
import * as fs from "fs";

async function main() {
  const network = (await ethers.provider.getNetwork()).name;
  const manifestPath = `./deployments/${network}_addresses.json`;
  const signers = await ethers.getSigners();

  let clientWallet: any;
  let freelancerWallet: any;
  let addresses: any;

  if (network === "hardhat" || network === "localhost") {
    clientWallet = signers[0];
    freelancerWallet = signers[1];

    console.log("Deploying fresh contracts on local ephemeral network for smoke test...");
    const jobImpl = await ethers.deployContract("JobEscrow");
    await jobImpl.waitForDeployment();

    const sbt = await ethers.deployContract("ReputationSBT", [clientWallet.address]);
    await sbt.waitForDeployment();

    const factoryContract = await ethers.deployContract("JobFactory", [
      await jobImpl.getAddress(),
      await sbt.getAddress(),
    ]);
    await factoryContract.waitForDeployment();

    const MINTER_ROLE = await sbt.MINTER_ROLE();
    await sbt.grantRole(MINTER_ROLE, await factoryContract.getAddress());

    addresses = {
      JobEscrowImplementation: await jobImpl.getAddress(),
      JobFactory: await factoryContract.getAddress(),
      ReputationSBT: await sbt.getAddress(),
    };
  } else {
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Deployment manifest not found at ${manifestPath}. Run deploy.ts first.`);
    }
    addresses = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    const clientPrivateKey = process.env.CLIENT_PRIVATE_KEY || process.env.PRIVATE_KEY;
    const freelancerPrivateKey = process.env.FREELANCER_PRIVATE_KEY;

    if (!clientPrivateKey || !freelancerPrivateKey) {
      throw new Error("CLIENT_PRIVATE_KEY and FREELANCER_PRIVATE_KEY env vars are required for live testnet smoke test.");
    }

    clientWallet = new ethers.Wallet(clientPrivateKey, ethers.provider);
    freelancerWallet = new ethers.Wallet(freelancerPrivateKey, ethers.provider);
  }

  console.log("═══════════════════════════════════════");
  console.log(` PolyLance Live Smoke Test — ${network}`);
  console.log("═══════════════════════════════════════");
  console.log("Client:", clientWallet.address);
  console.log("Freelancer:", freelancerWallet.address);
  console.log("JobFactory:", addresses.JobFactory);
  console.log("═══════════════════════════════════════\n");

  const factory = await ethers.getContractAt("JobFactory", addresses.JobFactory, clientWallet);

  // ── 1. Post a real job ──
  console.log("1/8 Posting job...");
  let tx = await factory.postJob("ipfs://smoke-test-job-description");
  let receipt = await tx.wait();
  console.log("    ✓ tx:", receipt!.hash);

  const jobs = await factory.getAllJobs();
  const jobAddress = jobs[jobs.length - 1]; // most recent
  console.log("    ✓ Job deployed at:", jobAddress);

  const job = await ethers.getContractAt("JobEscrow", jobAddress);

  // ── 2. Fund it ──
  console.log("2/8 Funding job with test MATIC...");
  const fundAmount = ethers.parseEther("0.01"); // small amount
  tx = await job.connect(clientWallet).fundJob({ value: fundAmount });
  receipt = await tx.wait();
  console.log("    ✓ tx:", receipt!.hash);
  console.log("    ✓ On-chain amount():", ethers.formatEther(await job.amount()), "MATIC");

  // ── 3. Freelancer applies ──
  console.log("3/8 Freelancer applying...");
  tx = await job.connect(freelancerWallet).applyToJob("ipfs://smoke-test-proposal");
  receipt = await tx.wait();
  console.log("    ✓ tx:", receipt!.hash);

  const applicants = await job.getApplicants();
  console.log("    ✓ Applicants on-chain:", applicants.length);

  // ── 4. Client selects ──
  console.log("4/8 Client selecting freelancer...");
  tx = await job.connect(clientWallet).selectFreelancer(freelancerWallet.address);
  receipt = await tx.wait();
  console.log("    ✓ tx:", receipt!.hash);
  console.log("    ✓ On-chain freelancer():", await job.freelancer());

  // ── 5. Both propose terms ──
  console.log("5/8 Proposing terms (both parties)...");
  const termsHash = ethers.keccak256(ethers.toUtf8Bytes("smoke test terms v1"));
  tx = await job.connect(clientWallet).proposeTerms(termsHash);
  await tx.wait();
  tx = await job.connect(freelancerWallet).proposeTerms(termsHash);
  receipt = await tx.wait();
  console.log("    ✓ tx:", receipt!.hash);
  console.log("    ✓ On-chain termsHash():", await job.termsHash());

  // ── 6. Freelancer submits work ──
  console.log("6/8 Freelancer submitting work...");
  tx = await job.connect(freelancerWallet).submitWork(
    "Smoke Test Delivery",
    "Real end-to-end test on live deployment",
    ["ipfs://smoke-test-evidence"]
  );
  receipt = await tx.wait();
  console.log("    ✓ tx:", receipt!.hash);
  console.log("    ✓ On-chain status():", (await job.status()).toString(), "(3 = Submitted)");

  // ── 7. Client releases payment ──
  console.log("7/8 Client releasing payment...");
  const freelancerBalanceBefore = await ethers.provider.getBalance(freelancerWallet.address);
  tx = await job.connect(clientWallet).releasePayment();
  receipt = await tx.wait();
  console.log("    ✓ tx:", receipt!.hash);
  const freelancerBalanceAfter = await ethers.provider.getBalance(freelancerWallet.address);
  console.log("    ✓ Freelancer balance change:", ethers.formatEther(freelancerBalanceAfter - freelancerBalanceBefore), "MATIC");

  // ── 8. Confirm reputation SBT minted ──
  console.log("8/8 Verifying ReputationSBT minted...");
  const sbt = await ethers.getContractAt("ReputationSBT", addresses.ReputationSBT);
  const balance = await sbt.balanceOf(freelancerWallet.address);
  console.log("    ✓ Freelancer SBT balance:", balance.toString());

  console.log("\n═══════════════════════════════════════");
  console.log(` SMOKE TEST COMPLETE — full lifecycle verified live on ${network}`);
  console.log(" Job contract:", jobAddress);
  console.log(" View on Polygonscan:", `https://amoy.polygonscan.com/address/${jobAddress}`);
  console.log("═══════════════════════════════════════");
}

main().catch((error) => {
  console.error("Smoke test FAILED at step:", error.message);
  process.exitCode = 1;
});
