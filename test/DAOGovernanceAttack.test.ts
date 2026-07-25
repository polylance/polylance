import { expect } from "chai";
import { ethers, network } from "hardhat";
import { mine } from "@nomicfoundation/hardhat-network-helpers";
import { JudgeDAO, ReputationSBT, JobFactory, JobEscrow } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("Phase 7 — Governance attack surface", function () {
  let judgeDAO: JudgeDAO;
  let sbt: ReputationSBT;
  let factory: JobFactory;
  let jobImpl: JobEscrow;
  let deployer: HardhatEthersSigner;
  let holder1: HardhatEthersSigner;
  let maliciousCandidate: HardhatEthersSigner;

  const VOTING_DELAY_BLOCKS = 86400;
  const VOTING_PERIOD_BLOCKS = 7 * 86400;

  beforeEach(async function () {
    [deployer, holder1, maliciousCandidate] = await ethers.getSigners();

    jobImpl = await ethers.deployContract("JobEscrow");
    await jobImpl.waitForDeployment();

    sbt = await ethers.deployContract("ReputationSBT", [deployer.address]);
    await sbt.waitForDeployment();

    factory = await ethers.deployContract("JobFactory", [
      await jobImpl.getAddress(),
      await sbt.getAddress(),
    ]);
    await factory.waitForDeployment();

    const MINTER_ROLE = await sbt.MINTER_ROLE();
    await sbt.grantRole(MINTER_ROLE, deployer.address);

    // Mint 1 SBT to holder1 to give them 1 vote
    await sbt.mint(holder1.address, ethers.ZeroAddress);

    judgeDAO = await ethers.deployContract("JudgeDAO", [await sbt.getAddress()]);
    await judgeDAO.waitForDeployment();

    const DEFAULT_ADMIN_ROLE = await factory.DEFAULT_ADMIN_ROLE();
    await factory.grantRole(DEFAULT_ADMIN_ROLE, await judgeDAO.getAddress());
  });

  it("proves quorum=1 risk: a single SBT holder can pass a proposal when total active supply is low", async function () {
    const ARBITRATOR_ROLE = await factory.ARBITRATOR_ROLE();
    const calldata = factory.interface.encodeFunctionData("grantRole", [
      ARBITRATOR_ROLE,
      maliciousCandidate.address,
    ]);
    const description = "Malicious Proposal: Add Rogue Judge";
    const descriptionHash = ethers.id(description);

    // Holder1 creates proposal alone
    const proposeTx = await judgeDAO.connect(holder1).propose(
      [await factory.getAddress()],
      [0],
      [calldata],
      description
    );
    const receipt = await proposeTx.wait();
    const event = receipt?.logs
      .map((l) => {
        try { return judgeDAO.interface.parseLog(l as any); } catch { return null; }
      })
      .find((e) => e?.name === "ProposalCreated");

    const proposalId = event!.args.proposalId as bigint;

    // Advance past voting delay
    await mine(VOTING_DELAY_BLOCKS + 1);

    // Cast vote (1 = For)
    await judgeDAO.connect(holder1).castVote(proposalId, 1);

    // Advance past voting period
    await mine(VOTING_PERIOD_BLOCKS + 1);

    // Proposal passes because quorum = 1
    expect(await judgeDAO.state(proposalId)).to.equal(4n); // Succeeded

    // Execution succeeds
    await judgeDAO.execute(
      [await factory.getAddress()],
      [0],
      [calldata],
      descriptionHash
    );

    // Malicious candidate now holds ARBITRATOR_ROLE — confirming MVP quorum risk
    expect(await factory.hasRole(ARBITRATOR_ROLE, maliciousCandidate.address)).to.be.true;
  });
});
