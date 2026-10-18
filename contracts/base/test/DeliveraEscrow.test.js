const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DeliveraEscrow deployment-aware custody", function () {
  const ID = ethers.id("delivera-1");
  const ALLOCATIONS = [400_000n, 350_000n, 250_000n];

  async function fixture() {
    const [owner, relayer, authority, client, provider, attacker] = await ethers.getSigners();
    const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    const escrow = await (await ethers.getContractFactory("DeliveraEscrow")).deploy(
      await usdc.getAddress(), relayer.address, authority.address,
    );
    await usdc.mint(client.address, 10_000_000n);
    await usdc.mint(attacker.address, 10_000_000n);
    await usdc.connect(client).approve(await escrow.getAddress(), ethers.MaxUint256);
    await usdc.connect(attacker).approve(await escrow.getAddress(), ethers.MaxUint256);
    const deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp + 3600);
    async function fundingSig(funder = client, freelancer = provider, allocations = ALLOCATIONS, id = ID) {
      const digest = await escrow.fundingDigest(id, funder.address, freelancer.address, allocations, deadline);
      return authority.signMessage(ethers.getBytes(digest));
    }
    async function settlementSig(sid, action, index, amount, bps) {
      const digest = await escrow.settlementDigest(sid, ID, action, index, amount, bps, deadline);
      return authority.signMessage(ethers.getBytes(digest));
    }
    async function activate(id = ID) {
      const digest = await escrow.activationDigest(id, deadline);
      await escrow.activateEscrow(id, deadline, await authority.signMessage(ethers.getBytes(digest)));
    }
    async function fund() {
      await escrow.connect(client).fundEscrow(ID, provider.address, ALLOCATIONS, deadline, await fundingSig());
      await activate();
    }
    return { owner, relayer, authority, client, provider, attacker, usdc, escrow, deadline, fundingSig, settlementSig, activate, fund };
  }

  it("binds the client, provider, total, and milestone allocations", async function () {
    const { client, provider, usdc, escrow, deadline, fundingSig } = await fixture();
    await expect(escrow.connect(client).fundEscrow(ID, provider.address, ALLOCATIONS, deadline, await fundingSig()))
      .to.emit(escrow, "EscrowFunded");
    expect(await escrow.milestoneAllocation(ID, 0)).to.equal(400_000n);
    expect(await escrow.milestoneAllocation(ID, 2)).to.equal(250_000n);
    expect(await escrow.remainingEscrow(ID)).to.equal(1_000_000n);
    expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(1_000_000n);
  });

  it("rejects unauthorized pre-funding and altered funding claims", async function () {
    const { client, provider, attacker, escrow, deadline, fundingSig } = await fixture();
    const clientSignature = await fundingSig(client, provider, ALLOCATIONS);
    await expect(
      escrow.connect(attacker).fundEscrow(ID, provider.address, ALLOCATIONS, deadline, clientSignature),
    ).to.be.revertedWith("DeliveraEscrow: invalid authority signature");
    await expect(
      escrow.connect(client).fundEscrow(ID, attacker.address, ALLOCATIONS, deadline, clientSignature),
    ).to.be.revertedWith("DeliveraEscrow: invalid authority signature");
    await expect(
      escrow.connect(client).fundEscrow(ID, provider.address, [1_000_000n], deadline, clientSignature),
    ).to.be.revertedWith("DeliveraEscrow: invalid authority signature");
  });

  it("independently funds the same local id from two GenLayer deployments", async function () {
    const { client, provider, usdc, escrow, deadline, fundingSig } = await fixture();
    const abi = ethers.AbiCoder.defaultAbiCoder();
    const scopedKey = (adjudicator) => ethers.keccak256(abi.encode(
      ["string", "uint256", "address", "string"],
      ["DELIVERA_AGREEMENT_V1", 61999, adjudicator, "delivera-1"],
    ));
    const first = scopedKey("0x1111111111111111111111111111111111111111");
    const second = scopedKey("0x2222222222222222222222222222222222222222");
    expect(first).not.to.equal(second);

    await escrow.connect(client).fundEscrow(first, provider.address, ALLOCATIONS, deadline, await fundingSig(client, provider, ALLOCATIONS, first));
    await escrow.connect(client).fundEscrow(second, provider.address, ALLOCATIONS, deadline, await fundingSig(client, provider, ALLOCATIONS, second));

    expect(await escrow.remainingEscrow(first)).to.equal(1_000_000n);
    expect(await escrow.remainingEscrow(second)).to.equal(1_000_000n);
    expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(2_000_000n);
  });

  it("recovers only an untouched deposit that never received adjudication activation", async function () {
    const { client, provider, attacker, relayer, usdc, escrow, deadline, fundingSig, settlementSig, activate } = await fixture();
    await escrow.connect(client).fundEscrow(ID, provider.address, ALLOCATIONS, deadline, await fundingSig());
    const sid = ethers.id("premature-release");
    await expect(escrow.connect(relayer).releaseMilestone(
      ID, sid, 0, 400_000n, deadline, await settlementSig(sid, 1, 0, 400_000n, 10_000n),
    )).to.be.revertedWith("DeliveraEscrow: escrow not activated");
    await expect(escrow.connect(client).recoverUnconfirmedFunding(ID)).to.be.revertedWith("DeliveraEscrow: recovery delay");
    await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");
    await expect(escrow.connect(attacker).recoverUnconfirmedFunding(ID)).to.be.revertedWith("DeliveraEscrow: not client");
    const before = await usdc.balanceOf(client.address);
    await expect(escrow.connect(client).recoverUnconfirmedFunding(ID)).to.emit(escrow, "UnconfirmedFundingRecovered");
    expect(await usdc.balanceOf(client.address)).to.equal(before + 1_000_000n);
    expect(await escrow.remainingEscrow(ID)).to.equal(0n);
    await expect(activate()).to.be.revertedWith("DeliveraEscrow: cannot activate");
  });

  it("permanently disables recovery after finalized adjudication activation", async function () {
    const { client, provider, escrow, deadline, fundingSig, activate } = await fixture();
    await escrow.connect(client).fundEscrow(ID, provider.address, ALLOCATIONS, deadline, await fundingSig());
    await activate();
    await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");
    await expect(escrow.connect(client).recoverUnconfirmedFunding(ID)).to.be.revertedWith("DeliveraEscrow: recovery unavailable");
  });

  it("allows permissionless activation transport but requires the exact authority signature", async function () {
    const { client, provider, attacker, authority, escrow, deadline, fundingSig } = await fixture();
    await escrow.connect(client).fundEscrow(ID, provider.address, ALLOCATIONS, deadline, await fundingSig());
    const digest = await escrow.activationDigest(ID, deadline);
    await expect(
      escrow.connect(attacker).activateEscrow(ID, deadline, await attacker.signMessage(ethers.getBytes(digest))),
    ).to.be.revertedWith("DeliveraEscrow: invalid authority signature");
    await expect(
      escrow.connect(attacker).activateEscrow(ID, deadline, await authority.signMessage(ethers.getBytes(digest))),
    ).to.emit(escrow, "EscrowActivated");
    expect(await escrow.isActivated(ID)).to.equal(true);
  });

  it("isolates a disputed milestone and leaves unrelated funds untouched", async function () {
    const { relayer, client, provider, usdc, escrow, deadline, settlementSig, fund } = await fixture();
    await fund();
    const sid = ethers.id("delivera-1:dispute:1");
    const sig = await settlementSig(sid, 2, 1, 350_000n, 6000n);
    const clientBefore = await usdc.balanceOf(client.address);
    await escrow.connect(relayer).resolveDispute(ID, sid, 1, 350_000n, 6000n, deadline, sig);
    expect(await usdc.balanceOf(provider.address)).to.equal(210_000n);
    expect(await usdc.balanceOf(client.address)).to.equal(clientBefore + 140_000n);
    expect(await escrow.remainingEscrow(ID)).to.equal(650_000n);
    expect(await escrow.milestoneSettled(ID, 0)).to.equal(0n);
    expect(await escrow.milestoneSettled(ID, 1)).to.equal(350_000n);
    expect(await escrow.milestoneSettled(ID, 2)).to.equal(0n);
  });

  it("requires a genuine unaltered signed settlement, not just the relayer", async function () {
    const { relayer, attacker, escrow, deadline, settlementSig, fund } = await fixture();
    await fund();
    const sid = ethers.id("delivera-1:release:0");
    const sig = await settlementSig(sid, 1, 0, 400_000n, 10_000n);
    await expect(
      escrow.connect(relayer).releaseMilestone(ID, sid, 0, 350_000n, deadline, sig),
    ).to.be.revertedWith("DeliveraEscrow: invalid authority signature");
    await expect(
      escrow.connect(attacker).releaseMilestone(ID, sid, 0, 400_000n, deadline, sig),
    ).to.be.revertedWith("DeliveraEscrow: not relayer");
  });

  it("blocks duplicate ids and duplicate milestone settlement on-chain", async function () {
    const { relayer, escrow, deadline, settlementSig, fund } = await fixture();
    await fund();
    const sid = ethers.id("delivera-1:release:0");
    const sig = await settlementSig(sid, 1, 0, 400_000n, 10_000n);
    await escrow.connect(relayer).releaseMilestone(ID, sid, 0, 400_000n, deadline, sig);
    await expect(
      escrow.connect(relayer).releaseMilestone(ID, sid, 0, 400_000n, deadline, sig),
    ).to.be.revertedWith("DeliveraEscrow: settlement already processed");
    const secondId = ethers.id("delivera-1:release:0:retry");
    const secondSig = await settlementSig(secondId, 1, 0, 400_000n, 10_000n);
    await expect(
      escrow.connect(relayer).releaseMilestone(ID, secondId, 0, 400_000n, deadline, secondSig),
    ).to.be.revertedWith("DeliveraEscrow: milestone already settled");
  });

  it("supports multi-milestone release, dispute split, and exact cancellation refund", async function () {
    const { relayer, client, provider, usdc, escrow, deadline, settlementSig, fund } = await fixture();
    await fund();
    const releaseId = ethers.id("release-0");
    await escrow.connect(relayer).releaseMilestone(
      ID, releaseId, 0, 400_000n, deadline,
      await settlementSig(releaseId, 1, 0, 400_000n, 10_000n),
    );
    const disputeId = ethers.id("dispute-1");
    await escrow.connect(relayer).resolveDispute(
      ID, disputeId, 1, 350_000n, 6000n, deadline,
      await settlementSig(disputeId, 2, 1, 350_000n, 6000n),
    );
    const clientBefore = await usdc.balanceOf(client.address);
    const refundId = ethers.id("cancel-rest");
    await escrow.connect(relayer).refund(
      ID, refundId, 250_000n, "cancelled", deadline,
      await settlementSig(refundId, 3, ethers.MaxUint256, 250_000n, 0n),
    );
    expect(await usdc.balanceOf(provider.address)).to.equal(610_000n);
    expect(await usdc.balanceOf(client.address)).to.equal(clientBefore + 250_000n);
    expect(await escrow.remainingEscrow(ID)).to.equal(0n);
    expect((await escrow.getEscrow(ID))[6]).to.equal(2n);
  });
});
