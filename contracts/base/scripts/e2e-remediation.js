// Reproducible Base Sepolia leg of the funded Delivera remediation demo.
// Private keys are read/derived locally and are never printed or persisted.
const hre = require("hardhat");

const ESCROW_ADDRESS = "0xC7A0AC77AE3058D0a1A8E3874C8e394D0E4a7875";
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const ORIGINAL_RELAYER = "0xd07E3D1bAF59F1c09e2F8842786D89B716915f3E";
const CONTRACT_ID = process.env.E2E_CONTRACT_ID || "delivera-1";
const ALLOCATIONS = [500_000n, 600_000n, 700_000n];
const PROVIDER = process.env.E2E_PROVIDER || "0xdeba1bd4b9fb3853eceaa80cc1316e4289491f3a";

const usdcAbi = [
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function receipt(tx) {
  const mined = await tx.wait();
  if (mined.status !== 1) throw new Error(`Transaction failed: ${tx.hash}`);
  return { hash: tx.hash, blockNumber: mined.blockNumber, gasUsed: mined.gasUsed.toString(), status: mined.status };
}

async function main() {
  const action = process.env.E2E_ACTION || "state";
  const provider = hre.ethers.provider;
  const authority = new hre.ethers.Wallet(required("BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY"), provider);
  const relayerKey = hre.ethers.keccak256(
    hre.ethers.solidityPacked(["bytes32", "string"], [authority.privateKey, "delivera-remediation-e2e-relayer-v1"]),
  );
  const relayer = new hre.ethers.Wallet(relayerKey, provider);
  const escrow = await hre.ethers.getContractAt("DeliveraEscrow", ESCROW_ADDRESS, authority);
  const escrowAsRelayer = escrow.connect(relayer);
  const usdc = new hre.ethers.Contract(USDC_ADDRESS, usdcAbi, authority);
  const id = hre.ethers.id(CONTRACT_ID);

  const balances = async () => ({
    client: (await usdc.balanceOf(authority.address)).toString(),
    provider: (await usdc.balanceOf(PROVIDER)).toString(),
    escrow: (await usdc.balanceOf(ESCROW_ADDRESS)).toString(),
  });
  const state = async () => {
    const e = await escrow.getEscrow(id);
    return {
      client: e[0], provider: e[1], funded: e[2].toString(), released: e[3].toString(),
      refunded: e[4].toString(), milestoneCount: e[5].toString(), status: Number(e[6]),
      remaining: (await escrow.remainingEscrow(id)).toString(),
      milestoneSettled: await Promise.all([0, 1, 2].map(async (i) => (await escrow.milestoneSettled(id, i)).toString())),
      processedSettlements: {
        release0: await escrow.processedSettlements(hre.ethers.id(`${CONTRACT_ID}:release:0`)),
        dispute1: await escrow.processedSettlements(hre.ethers.id(`${CONTRACT_ID}:dispute:1`)),
        release2: await escrow.processedSettlements(hre.ethers.id(`${CONTRACT_ID}:release:2`)),
      },
      relayer: await escrow.relayer(), authority: await escrow.decisionAuthority(), balances: await balances(),
    };
  };

  if (action === "fund") {
    const before = await balances();
    const txs = {};
    if ((await escrow.relayer()).toLowerCase() !== relayer.address.toLowerCase()) {
      txs.setRelayer = await receipt(await escrow.setRelayer(relayer.address));
    }
    if ((await provider.getBalance(relayer.address)) < hre.ethers.parseEther("0.00015")) {
      txs.fundRelayerGas = await receipt(await authority.sendTransaction({ to: relayer.address, value: hre.ethers.parseEther("0.0003") }));
    }
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const digest = await escrow.fundingDigest(id, authority.address, PROVIDER, ALLOCATIONS, deadline);
    const signature = await authority.signMessage(hre.ethers.getBytes(digest));
    txs.approve = await receipt(await usdc.approve(ESCROW_ADDRESS, ALLOCATIONS.reduce((a, b) => a + b, 0n)));
    txs.fundEscrow = await receipt(await escrow.fundEscrow(id, PROVIDER, ALLOCATIONS, deadline, signature));
    console.log(JSON.stringify({ action, contractId: CONTRACT_ID, relayer: relayer.address, before, txs, state: await state() }, null, 2));
    return;
  }

  if (action === "release" || action === "dispute" || action === "refund") {
    const index = BigInt(required("E2E_MILESTONE_INDEX"));
    const amount = BigInt(required("E2E_AMOUNT"));
    const bps = action === "dispute" ? BigInt(required("E2E_PROVIDER_BPS")) : action === "release" ? 10_000n : 0n;
    const sequence = process.env.E2E_SEQUENCE || (action === "refund" ? "cancel" : index.toString());
    const sid = hre.ethers.id(`${CONTRACT_ID}:${action}:${sequence}`);
    const actionCode = action === "release" ? 1 : action === "dispute" ? 2 : 3;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const digest = await escrow.settlementDigest(sid, id, actionCode, action === "refund" ? hre.ethers.MaxUint256 : index, amount, bps, deadline);
    const signature = await authority.signMessage(hre.ethers.getBytes(digest));
    const before = await state();
    let tx;
    if (action === "release") tx = await escrowAsRelayer.releaseMilestone(id, sid, index, amount, deadline, signature);
    else if (action === "dispute") tx = await escrowAsRelayer.resolveDispute(id, sid, index, amount, bps, deadline, signature);
    else tx = await escrowAsRelayer.refund(id, sid, amount, process.env.E2E_REASON || "GenLayer cancellation finalized", deadline, signature);
    const mined = await receipt(tx);
    let duplicateRevert = "unexpected success";
    try {
      if (action === "release") await escrowAsRelayer.releaseMilestone.staticCall(id, sid, index, amount, deadline, signature);
      else if (action === "dispute") await escrowAsRelayer.resolveDispute.staticCall(id, sid, index, amount, bps, deadline, signature);
      else await escrowAsRelayer.refund.staticCall(id, sid, amount, process.env.E2E_REASON || "GenLayer cancellation finalized", deadline, signature);
    } catch (error) { duplicateRevert = error.shortMessage || error.message; }
    console.log(JSON.stringify({ action, settlementId: sid, before, transaction: mined, processed: await escrow.processedSettlements(sid), duplicateRevert, after: await state() }, null, 2));
    return;
  }

  if (action === "restore") {
    const tx = (await escrow.relayer()).toLowerCase() === ORIGINAL_RELAYER.toLowerCase() ? null : await receipt(await escrow.setRelayer(ORIGINAL_RELAYER));
    console.log(JSON.stringify({ action, transaction: tx, state: await state() }, null, 2));
    return;
  }

  if (action === "events") {
    const names = ["EscrowFunded", "MilestoneReleased", "DisputeResolved", "Refunded", "EscrowSettled"];
    const events = [];
    const latest = await provider.getBlockNumber();
    for (const name of names) {
      for (let from = 48_255_000; from <= latest; from += 200) {
        for (const log of await escrow.queryFilter(escrow.filters[name](id), from, Math.min(from + 199, latest))) {
          events.push({ name, transactionHash: log.transactionHash, blockNumber: log.blockNumber });
        }
      }
    }
    console.log(JSON.stringify({ action, contractId: CONTRACT_ID, events }, null, 2));
    return;
  }

  console.log(JSON.stringify({ action, contractId: CONTRACT_ID, state: await state() }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
