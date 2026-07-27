import { ethers } from "hardhat";
import * as fs from "fs";

async function main() {
  const network = (await ethers.provider.getNetwork()).name;
  const manifestPath = `./deployments/${network}_addresses.json`;
  const signers = await ethers.getSigners();

  let clientWallet: any;
  let freelancerWallet: any;
  let judgeWallet: any;
  let addresses: any;

  if (network === "hardhat" || network === "localhost") {
    clientWallet = signers[0];
    freelancerWallet = signers[1];
    judgeWallet = signers[0];

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

    const ARBITRATOR_ROLE = await factoryContract.ARBITRATOR_ROLE();
    await factoryContract.grantRole(ARBITRATOR_ROLE, judgeWallet.address);

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
    const judgePrivateKey = process.env.JUDGE_PRIVATE_KEY || clientPrivateKey;

    if (!clientPrivateKey || !freelancerPrivateKey) {
      throw new Error("CLIENT_PRIVATE_KEY and FREELANCER_PRIVATE_KEY env vars are required.");
    }

    clientWallet = new ethers.Wallet(clientPrivateKey, ethers.provider);
    freelancerWallet = new ethers.Wallet(freelancerPrivateKey, ethers.provider);
    judgeWallet = new ethers.Wallet(judgePrivateKey, ethers.provider);
  }

  console.log("═══════════════════════════════════════");
  console.log(` PolyLance Dispute Path Smoke Test — ${network}`);
  console.log("═══════════════════════════════════════");
  console.log("Client:", clientWallet.address);
  console.log("Freelancer:", freelancerWallet.address);
  console.log("Judge/Arbitrator:", judgeWallet.address);
  console.log("JobFactory:", addresses.JobFactory);
  console.log("═══════════════════════════════════════\n");

  const factory = await ethers.getContractAt("JobFactory", addresses.JobFactory, clientWallet);

  // 1. Post job
  console.log("1/7 Posting dispute test job...");
  let tx = await factory.postJob("ipfs://dispute-test-job-description");
  await tx.wait();
  const jobs = await factory.getAllJobs();
  const jobAddress = jobs[jobs.length - 1];
  console.log("    ✓ Job deployed at:", jobAddress);

  const job = await ethers.getContractAt("JobEscrow", jobAddress);

  // 2. Fund job
  console.log("2/7 Funding job...");
  tx = await job.connect(clientWallet).fundJob({ value: ethers.parseEther("0.01") });
  await tx.wait();

  // 3. Apply & Select
  console.log("3/7 Freelancer applying & Client selecting...");
  tx = await job.connect(freelancerWallet).applyToJob("ipfs://dispute-proposal");
  await tx.wait();
  tx = await job.connect(clientWallet).selectFreelancer(freelancerWallet.address);
  await tx.wait();

  // 4. Propose terms & Submit work
  console.log("4/7 Terms & Work submission...");
  const termsHash = ethers.keccak256(ethers.toUtf8Bytes("dispute test terms"));
  tx = await job.connect(clientWallet).proposeTerms(termsHash);
  await tx.wait();
  tx = await job.connect(freelancerWallet).proposeTerms(termsHash);
  await tx.wait();
  tx = await job.connect(freelancerWallet).submitWork("Deliverable", "Details", ["ipfs://evidence"]);
  await tx.wait();

  // 5. Raise dispute
  console.log("5/7 Client raising dispute...");
  tx = await job.connect(clientWallet).raiseDispute(0, "ipfs://client-dispute-evidence"); // 0 = QualityUnsatisfactory
  let receipt = await tx.wait();
  console.log("    ✓ Dispute tx:", receipt!.hash);
  console.log("    ✓ On-chain status():", (await job.status()).toString(), "(4 = Disputed)");

  // 6. Arbitrator resolves dispute with 50/50 split
  console.log("6/7 Arbitrator resolving dispute (5000 bps = 50% split)...");
  tx = await job.connect(judgeWallet).resolveDispute(5000, "ipfs://arbitrator-reasoning");
  receipt = await tx.wait();
  console.log("    ✓ Resolution tx:", receipt!.hash);
  console.log("    ✓ On-chain status():", (await job.status()).toString(), "(5 = Completed)");

  // 7. Verify reputation SBT minted
  console.log("7/7 Verifying ReputationSBT status post-dispute...");
  const sbt = await ethers.getContractAt("ReputationSBT", addresses.ReputationSBT);
  const balance = await sbt.balanceOf(freelancerWallet.address);
  console.log("    ✓ Freelancer SBT balance:", balance.toString());

  console.log("\n═══════════════════════════════════════");
  console.log(" DISPUTE SMOKE TEST COMPLETE — live resolution verified");
  console.log(" Job contract:", jobAddress);
  console.log(" View on Polygonscan:", `https://amoy.polygonscan.com/address/${jobAddress}`);
  console.log("═══════════════════════════════════════");
}

main().catch((error) => {
  console.error("Dispute smoke test FAILED:", error.message);
  process.exitCode = 1;
});
