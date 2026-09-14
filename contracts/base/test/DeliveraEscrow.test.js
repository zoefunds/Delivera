const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DeliveraEscrow", function () {
  const CONTRACT_ID = ethers.encodeBytes32String("job-1");
  const AMOUNT = 1_000_000n; // 1.00 mUSDC (6 decimals)

  async function deployFixture() {
    const [owner, relayer, client, freelancer, stranger] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();

    const DeliveraEscrow = await ethers.getContractFactory("DeliveraEscrow");
    const escrow = await DeliveraEscrow.deploy(await usdc.getAddress(), relayer.address);

    await usdc.mint(client.address, 10_000_000n);
    await usdc.connect(client).approve(await escrow.getAddress(), ethers.MaxUint256);

    return { owner, relayer, client, freelancer, stranger, usdc, escrow };
  }

  it("funds an escrow and records balances", async function () {
    const { client, freelancer, usdc, escrow } = await deployFixture();

    await expect(escrow.connect(client).fundEscrow(CONTRACT_ID, freelancer.address, AMOUNT))
      .to.emit(escrow, "EscrowFunded")
      .withArgs(CONTRACT_ID, client.address, freelancer.address, AMOUNT);

    expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(AMOUNT);

    const e = await escrow.getEscrow(CONTRACT_ID);
    expect(e.client).to.equal(client.address);
    expect(e.freelancer).to.equal(freelancer.address);
    expect(e.funded).to.equal(AMOUNT);
    expect(e.status).to.equal(1n); // FUNDED
  });

  it("lets the relayer release a milestone to the freelancer", async function () {
    const { relayer, client, freelancer, usdc, escrow } = await deployFixture();
    await escrow.connect(client).fundEscrow(CONTRACT_ID, freelancer.address, AMOUNT);

    const releaseAmount = 400_000n;
    await expect(escrow.connect(relayer).releaseMilestone(CONTRACT_ID, releaseAmount))
      .to.emit(escrow, "MilestoneReleased")
      .withArgs(CONTRACT_ID, freelancer.address, releaseAmount);

    expect(await usdc.balanceOf(freelancer.address)).to.equal(releaseAmount);
    expect(await escrow.remainingEscrow(CONTRACT_ID)).to.equal(AMOUNT - releaseAmount);
  });

  it("reverts releaseMilestone when called by a non-relayer", async function () {
    const { client, freelancer, stranger, escrow } = await deployFixture();
    await escrow.connect(client).fundEscrow(CONTRACT_ID, freelancer.address, AMOUNT);

    await expect(
      escrow.connect(stranger).releaseMilestone(CONTRACT_ID, 100_000n)
    ).to.be.revertedWith("DeliveraEscrow: not relayer");

    await expect(
      escrow.connect(client).releaseMilestone(CONTRACT_ID, 100_000n)
    ).to.be.revertedWith("DeliveraEscrow: not relayer");
  });

  it("refunds remaining escrow to the client on cancellation", async function () {
    const { relayer, client, freelancer, usdc, escrow } = await deployFixture();
    await escrow.connect(client).fundEscrow(CONTRACT_ID, freelancer.address, AMOUNT);

    const clientBalBefore = await usdc.balanceOf(client.address);

    await expect(escrow.connect(relayer).refund(CONTRACT_ID, "client cancelled"))
      .to.emit(escrow, "Refunded")
      .withArgs(CONTRACT_ID, client.address, AMOUNT, "client cancelled");

    expect(await usdc.balanceOf(client.address)).to.equal(clientBalBefore + AMOUNT);
    expect(await escrow.remainingEscrow(CONTRACT_ID)).to.equal(0n);

    const e = await escrow.getEscrow(CONTRACT_ID);
    expect(e.status).to.equal(2n); // SETTLED
  });

  it("reverts refund by a non-relayer", async function () {
    const { client, freelancer, stranger, escrow } = await deployFixture();
    await escrow.connect(client).fundEscrow(CONTRACT_ID, freelancer.address, AMOUNT);

    await expect(
      escrow.connect(stranger).refund(CONTRACT_ID, "nope")
    ).to.be.revertedWith("DeliveraEscrow: not relayer");
  });

  it("splits a disputed amount between freelancer and client per bps", async function () {
    const { relayer, client, freelancer, usdc, escrow } = await deployFixture();
    await escrow.connect(client).fundEscrow(CONTRACT_ID, freelancer.address, AMOUNT);

    const disputedAmount = AMOUNT; // whole pot in dispute
    const providerBps = 7000n; // 70% to freelancer, 30% back to client

    await expect(
      escrow.connect(relayer).resolveDispute(CONTRACT_ID, disputedAmount, providerBps)
    )
      .to.emit(escrow, "DisputeResolved")
      .withArgs(CONTRACT_ID, disputedAmount, 700_000n, 300_000n, providerBps);

    expect(await usdc.balanceOf(freelancer.address)).to.equal(700_000n);
    expect(await usdc.balanceOf(client.address)).to.equal(10_000_000n - AMOUNT + 300_000n);
    expect(await escrow.remainingEscrow(CONTRACT_ID)).to.equal(0n);
  });

  it("blocks double-release: cannot release more than remains, and a settled escrow rejects further action", async function () {
    const { relayer, client, freelancer, escrow } = await deployFixture();
    await escrow.connect(client).fundEscrow(CONTRACT_ID, freelancer.address, AMOUNT);

    // Release the full amount once.
    await escrow.connect(relayer).releaseMilestone(CONTRACT_ID, AMOUNT);
    expect(await escrow.remainingEscrow(CONTRACT_ID)).to.equal(0n);

    // Escrow auto-settles once exhausted — any further release reverts.
    await expect(
      escrow.connect(relayer).releaseMilestone(CONTRACT_ID, 1n)
    ).to.be.revertedWith("DeliveraEscrow: escrow not active");

    // Refund and dispute resolution are likewise blocked once settled.
    await expect(
      escrow.connect(relayer).refund(CONTRACT_ID, "double spend attempt")
    ).to.be.revertedWith("DeliveraEscrow: escrow not active");

    await expect(
      escrow.connect(relayer).resolveDispute(CONTRACT_ID, 1n, 5000n)
    ).to.be.revertedWith("DeliveraEscrow: escrow not active");
  });

  it("reverts releaseMilestone for more than the remaining balance", async function () {
    const { relayer, client, freelancer, escrow } = await deployFixture();
    await escrow.connect(client).fundEscrow(CONTRACT_ID, freelancer.address, AMOUNT);

    await expect(
      escrow.connect(relayer).releaseMilestone(CONTRACT_ID, AMOUNT + 1n)
    ).to.be.revertedWith("DeliveraEscrow: amount exceeds remaining escrow");
  });
});
