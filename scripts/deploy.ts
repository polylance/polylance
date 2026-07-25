import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

export interface DeploymentAddresses {
  JobEscrowImplementation: string;
  JobFactory: string;
  ReputationSBT: string;
  ProfileRegistry: string;
  GithubReputationRegistry: string;
  TimelockController: string;
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

  // ── 1. JobEscrow implementation ──
  console.log("1/7 Deploying JobEscrow implementation...");
  const JobEscrow = await ethers.getContractFactory("JobEscrow");
  const jobEscrowImpl = await JobEscrow.deploy();
  await jobEscrowImpl.waitForDeployment();
  const jobEscrowImplAddr = await jobEscrowImpl.getAddress();
  console.log("    ✓", jobEscrowImplAddr);

  // ── 2. ReputationSBT ──
  console.log("2/7 Deploying ReputationSBT...");
  const ReputationSBT = await ethers.getContractFactory("ReputationSBT");
  const sbt = await ReputationSBT.deploy(deployer.address);
  await sbt.waitForDeployment();
  const sbtAddr = await sbt.getAddress();
  console.log("    ✓", sbtAddr);

  // ── 3. JobFactory ──
  console.log("3/7 Deploying JobFactory...");
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
  console.log("4/7 Deploying ProfileRegistry...");
  const ProfileRegistry = await ethers.getContractFactory("ProfileRegistry");
  const profileRegistry = await ProfileRegistry.deploy();
  await profileRegistry.waitForDeployment();
  const profileRegistryAddr = await profileRegistry.getAddress();
  console.log("    ✓", profileRegistryAddr);

  // ── 5. GithubReputationRegistry ──
  console.log("5/7 Deploying GithubReputationRegistry...");
  const GithubReputationRegistry = await ethers.getContractFactory("GithubReputationRegistry");
  const githubRegistry = await GithubReputationRegistry.deploy();
  await githubRegistry.waitForDeployment();
  const githubRegistryAddr = await githubRegistry.getAddress();
  console.log("    ✓", githubRegistryAddr);

  // ── 6. TimelockController (2-day minDelay = 172800s) ──
  console.log("6/7 Deploying TimelockController (2-day delay)...");
  const TimelockController = await ethers.getContractFactory("TimelockController");
  const timelock = await TimelockController.deploy(
    172800, // 2 days minDelay
    [],     // proposers (granted to JudgeDAO below)
    [ethers.ZeroAddress], // executors (open execution once delay expires)
    deployer.address
  );
  await timelock.waitForDeployment();
  const timelockAddr = await timelock.getAddress();
  console.log("    ✓", timelockAddr);

  // ── 7. JudgeDAO (bound to ReputationSBT and TimelockController) ──
  console.log("7/7 Deploying JudgeDAO...");
  const JudgeDAO = await ethers.getContractFactory("JudgeDAO");
  const judgeDAO = await JudgeDAO.deploy(sbtAddr, timelockAddr);
  await judgeDAO.waitForDeployment();
  const judgeDAOAddr = await judgeDAO.getAddress();
  console.log("    ✓", judgeDAOAddr);

  // Grant JudgeDAO PROPOSER_ROLE on TimelockController
  const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
  tx = await timelock.grantRole(PROPOSER_ROLE, judgeDAOAddr);
  await tx.wait();
  console.log("    ✓ PROPOSER_ROLE on TimelockController granted to JudgeDAO");

  // Write manifest
  const addresses: DeploymentAddresses = {
    JobEscrowImplementation: jobEscrowImplAddr,
    JobFactory: factoryAddr,
    ReputationSBT: sbtAddr,
    ProfileRegistry: profileRegistryAddr,
    GithubReputationRegistry: githubRegistryAddr,
    TimelockController: timelockAddr,
    JudgeDAO: judgeDAOAddr,
    deployedAt: new Date().toISOString(),
    network,
    deployerAddress: deployer.address,
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });

  const manifestPath = path.join(deploymentsDir, `${network}_addresses.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(addresses, null, 2));

  if (network === "amoy" || network === "polygonAmoy") {
    const rootPath = path.join(__dirname, "..", "amoy_deployment_addresses.json");
    fs.writeFileSync(
      rootPath,
      JSON.stringify(
        {
          network,
          chainId: "80002",
          deployedAt: addresses.deployedAt,
          deployer: deployer.address,
          contracts: {
            JobEscrowImpl: jobEscrowImplAddr,
            ReputationSBT: sbtAddr,
            JobFactory: factoryAddr,
            ProfileRegistry: profileRegistryAddr,
            GithubReputationRegistry: githubRegistryAddr,
            TimelockController: timelockAddr,
            JudgeDAO: judgeDAOAddr,
          },
        },
        null,
        2
      )
    );
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
