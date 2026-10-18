/**
 * Complete current-deployment production E2E.
 *
 * Requires E2E_CLIENT_PRIVATE_KEY. It derives a throwaway provider wallet,
 * but never prints or persists either private key. All client/provider
 * lifecycle writes are signed by those wallets; the API only confirms them.
 */
import { ethers } from "ethers";
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import type { Address, CalldataEncodable } from "genlayer-js/types";

const API = process.env.E2E_API_URL || "https://delivera-api-gideon.fly.dev/api/v1";
const GENLAYER = (process.env.E2E_GENLAYER_CONTRACT || "0xDa4B86C86010329dbf484a1ccD1BD64396B25cBa") as Address;
const ESCROW = process.env.E2E_ESCROW_ADDRESS || "0x2bA36CD29993cf4250adfb48F367E1893dcd43B5";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const rawKey = process.env.E2E_CLIENT_PRIVATE_KEY;
if (!rawKey) throw new Error("E2E_CLIENT_PRIVATE_KEY is required");
const clientKey = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`;
const providerKey = ethers.keccak256(ethers.solidityPacked(
  ["bytes32", "string"], [clientKey, "delivera-current-production-provider-v1"],
)) as `0x${string}`;
const clientWallet = new ethers.Wallet(clientKey, new ethers.JsonRpcProvider("https://sepolia.base.org"));
const providerWallet = new ethers.Wallet(providerKey);
const clientChain = createClient({ chain: studionet, account: createAccount(clientKey) });
const providerChain = createClient({ chain: studionet, account: createAccount(providerKey) });

async function authenticate(wallet: ethers.Wallet): Promise<string> {
  const nonceRes = await fetch(`${API}/auth/nonce?address=${wallet.address}`);
  if (!nonceRes.ok) throw new Error(`nonce failed: ${nonceRes.status} ${await nonceRes.text()}`);
  const { message } = await nonceRes.json() as { message: string };
  const signature = await wallet.signMessage(message);
  const verifyRes = await fetch(`${API}/auth/verify`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: wallet.address, signature }),
  });
  if (!verifyRes.ok) throw new Error(`auth failed: ${verifyRes.status} ${await verifyRes.text()}`);
  return ((await verifyRes.json()) as { accessToken: string }).accessToken;
}

async function api<T>(token: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function write(chain: typeof clientChain, method: string, args: CalldataEncodable[]) {
  const hash = await chain.writeContract({ address: GENLAYER, functionName: method, args, value: 0n });
  const receipt = await chain.waitForTransactionReceipt({ hash, status: "FINALIZED", retries: 240, interval: 3000 });
  return { hash, status: receipt.status_name ?? String(receipt.status) };
}

async function readContract(id: string) {
  return clientChain.readContract({ address: GENLAYER, functionName: "get_contract", args: [id] }) as Promise<any>;
}

async function waitFor<T>(label: string, read: () => Promise<T>, ready: (value: T) => boolean, attempts = 60, delay = 5000): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    const value = await read();
    if (ready(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const escrowAbi = [
  "function fundEscrow(bytes32,address,uint256[],uint256,bytes)",
  "function remainingEscrow(bytes32) view returns(uint256)",
  "function milestoneSettled(bytes32,uint256) view returns(uint256)",
  "function isActivated(bytes32) view returns(bool)",
  "function getEscrow(bytes32) view returns(address,address,uint256,uint256,uint256,uint256,uint8)",
  "event EscrowFunded(bytes32 indexed contractId,address indexed client,address indexed freelancer,uint256 amount,bytes32 allocationHash)",
  "event EscrowActivated(bytes32 indexed contractId)",
  "event MilestoneReleased(bytes32 indexed contractId,bytes32 indexed settlementId,uint256 indexed milestoneIndex,address freelancer,uint256 amount)",
  "event DisputeResolved(bytes32 indexed contractId,bytes32 indexed settlementId,uint256 indexed milestoneIndex,uint256 disputedAmount,uint256 providerShare,uint256 clientShare,uint256 providerBps)",
  "event EscrowSettled(bytes32 indexed contractId)",
];
const erc20Abi = ["function approve(address,uint256) returns(bool)", "function allowance(address,address) view returns(uint256)", "function balanceOf(address) view returns(uint256)"];

async function main() {
  const started = new Date().toISOString();
  const clientToken = await authenticate(clientWallet);
  const providerToken = await authenticate(providerWallet);
  if (process.env.E2E_LIST_ONLY === "1") {
    const contracts = await api<any[]>(clientToken, "/contracts");
    console.log(JSON.stringify(contracts.slice(0, 5).map((c) => ({ id: c.id, chainContractId: c.chainContractId, title: c.title, status: c.status })), null, 2));
    return;
  }
  const title = `Current deployment funded lifecycle — ${started}`;
  const description = "Wallet-originated production verification of domain-separated funding, independent evidence retrieval, milestone isolation, arbitration, replay-safe Base settlement, and final USDC balance changes.";
  const milestones = [
    { title: "Public reference page delivery", description: "Publish and identify a stable public reference page.", acceptanceCriteria: "The submitted page must be publicly reachable and visibly contain the exact heading Example Domain.", evidenceType: "website", amountAtto: "110000000000000000" },
    { title: "Unavailable endpoint incident", description: "Demonstrate validator rejection and milestone-scoped arbitration for unavailable evidence.", acceptanceCriteria: "The submitted endpoint must be publicly reachable and return a JSON object containing status, timestamp, and incident_id fields.", evidenceType: "api_endpoint", amountAtto: "120000000000000000" },
    { title: "Independent validator retrieval", description: "Run a validator-backed evaluation against a stable public artifact.", acceptanceCriteria: "The submitted page must be reachable independently by validators and contain the phrase Example Domain without authentication.", evidenceType: "website", amountAtto: "130000000000000000" },
  ];
  const chainMilestones = milestones.map((m) => ({ title: m.title, description: m.description, acceptance_criteria: m.acceptanceCriteria, evidence_type: m.evidenceType, amount_atto: m.amountAtto }));
  let created: { hash: string; status: string };
  let dbId: string;
  let chainId: string;
  if (process.env.E2E_RESUME_DB_ID && process.env.E2E_RESUME_CHAIN_ID) {
    created = { hash: "RESUMED", status: "FINALIZED" };
    dbId = process.env.E2E_RESUME_DB_ID;
    chainId = process.env.E2E_RESUME_CHAIN_ID;
  } else {
    created = await write(clientChain, "create_contract", [providerWallet.address, title, description, JSON.stringify(chainMilestones)]);
    const confirmed = await api<{ contract: { id: string; chainContractId: string } }>(clientToken, "/contracts/confirm-create", "POST", {
      providerWalletAddress: providerWallet.address, title, description, txHash: created.hash, milestones,
    });
    dbId = confirmed.contract.id;
    chainId = confirmed.contract.chainContractId;
  }

  const auth = await api<{ deadline: string; signature: string; allocations: string[]; escrowKey: string }>(clientToken, `/contracts/${dbId}/funding-authorization`, "POST");
  const escrow = new ethers.Contract(ESCROW, escrowAbi, clientWallet);
  const usdc = new ethers.Contract(USDC, erc20Abi, clientWallet);
  const allocations = auth.allocations.map(BigInt);
  const total = allocations.reduce((a, b) => a + b, 0n);
  const balancesBefore = {
    client: String(await usdc.balanceOf(clientWallet.address)), provider: String(await usdc.balanceOf(providerWallet.address)), escrow: String(await usdc.balanceOf(ESCROW)),
  };
  await (await usdc.approve(ESCROW, total)).wait();
  // Public RPC endpoints may load-balance reads across nodes a few seconds
  // behind the receipt node. Do not estimate fundEscrow until allowance is
  // visible from the same read path used for the subsequent transaction.
  await waitFor("USDC allowance propagation", () => usdc.allowance(clientWallet.address, ESCROW), (v) => BigInt(v) >= total, 30, 2000);
  const fundTx = await escrow.fundEscrow(auth.escrowKey, providerWallet.address, allocations, BigInt(auth.deadline), auth.signature);
  await fundTx.wait();
  await api(clientToken, `/contracts/${dbId}/fund`, "POST", { fundTxHash: fundTx.hash });
  if (!(await escrow.isActivated(auth.escrowKey))) throw new Error("escrow was not activated after finalized GenLayer confirmation");

  const accepted = await write(providerChain, "accept_contract", [chainId]);
  await api(providerToken, `/contracts/${dbId}/accept`, "POST", { txHash: accepted.hash });

  const submitted0 = await write(providerChain, "submit_deliverable", [chainId, 0, JSON.stringify(["https://example.com/"]), "Public IANA Example Domain reference page, submitted as a stable real URL."]);
  await api(providerToken, `/contracts/${dbId}/milestones/0/submit`, "POST", { txHash: submitted0.hash });
  const approved0 = await write(clientChain, "approve_milestone", [chainId, 0]);
  await api(clientToken, `/contracts/${dbId}/milestones/0/approve`, "POST", { txHash: approved0.hash });
  await waitFor("milestone 0 Base release", () => escrow.milestoneSettled(auth.escrowKey, 0), (v) => BigInt(v) === allocations[0]);

  const submitted1 = await write(providerChain, "submit_deliverable", [chainId, 1, JSON.stringify(["https://delivera-evidence.invalid/current-deployment-missing.json"]), "Intentionally unavailable endpoint to prove independent retrieval and conservative rejection."]);
  await api(providerToken, `/contracts/${dbId}/milestones/1/submit`, "POST", { txHash: submitted1.hash });
  const verified1 = await write(clientChain, "verify_deliverable", [chainId, 1]);
  await api(clientToken, `/contracts/${dbId}/milestones/1/verify`, "POST", { txHash: verified1.hash });
  const disputed = await write(clientChain, "raise_dispute", [chainId, 1, "The endpoint is unreachable and contains none of the required auditable JSON fields; the isolated allocation should return to the client."]);
  await api(clientToken, `/contracts/${dbId}/disputes`, "POST", { txHash: disputed.hash, milestoneIndex: 1, reason: "The endpoint is unreachable and contains none of the required auditable JSON fields; the isolated allocation should return to the client." });
  const providerStatement = "Validators could not retrieve the endpoint. I acknowledge the missing evidence and request only the objectively supported share.";
  const stated = await write(providerChain, "add_dispute_statement", [chainId, 0, providerStatement]);
  await api(providerToken, `/contracts/${dbId}/disputes/0/statement`, "POST", { txHash: stated.hash, statement: providerStatement });
  const resolved = await write(clientChain, "resolve_dispute", [chainId, 0]);
  await api(clientToken, `/contracts/${dbId}/disputes/0/resolve`, "POST", { txHash: resolved.hash });
  await waitFor("milestone 1 Base dispute", () => escrow.milestoneSettled(auth.escrowKey, 1), (v) => BigInt(v) === allocations[1]);

  const submitted2 = await write(providerChain, "submit_deliverable", [chainId, 2, JSON.stringify(["https://example.com/"]), "Stable public page for independent validator-backed retrieval and evaluation."]);
  await api(providerToken, `/contracts/${dbId}/milestones/2/submit`, "POST", { txHash: submitted2.hash });
  const verified2 = await write(clientChain, "verify_deliverable", [chainId, 2]);
  await api(clientToken, `/contracts/${dbId}/milestones/2/verify`, "POST", { txHash: verified2.hash });
  let chain = await readContract(chainId);
  if (chain.milestones[2].status !== "APPROVED") {
    const manual2 = await write(clientChain, "approve_milestone", [chainId, 2]);
    await api(clientToken, `/contracts/${dbId}/milestones/2/approve`, "POST", { txHash: manual2.hash });
  }
  await waitFor("milestone 2 Base release", () => escrow.milestoneSettled(auth.escrowKey, 2), (v) => BigInt(v) === allocations[2]);
  chain = await waitFor("GenLayer completion", () => readContract(chainId), (v) => v.status === "COMPLETED");
  const base = await escrow.getEscrow(auth.escrowKey);
  const balancesAfter = {
    client: String(await usdc.balanceOf(clientWallet.address)), provider: String(await usdc.balanceOf(providerWallet.address)), escrow: String(await usdc.balanceOf(ESCROW)),
  };
  const baseEvents: Array<{ name: string; transactionHash: string; blockNumber: number }> = [];
  const latestBlock = await clientWallet.provider!.getBlockNumber();
  for (const name of ["EscrowFunded", "EscrowActivated", "MilestoneReleased", "DisputeResolved", "EscrowSettled"]) {
    for (let fromBlock = 48_259_013; fromBlock <= latestBlock; fromBlock += 200) {
      const logs = await escrow.queryFilter(
        (escrow.filters as any)[name](auth.escrowKey), fromBlock, Math.min(fromBlock + 199, latestBlock),
      );
      for (const log of logs) baseEvents.push({ name, transactionHash: log.transactionHash, blockNumber: log.blockNumber });
    }
  }
  console.log(JSON.stringify({
    started, completed: new Date().toISOString(), title, client: clientWallet.address, provider: providerWallet.address,
    genLayerContract: GENLAYER, escrow: ESCROW, chainId, databaseId: dbId, escrowKey: auth.escrowKey,
    transactions: { create: created, fund: fundTx.hash, accept: accepted, approve0: approved0, verify1: verified1, dispute: disputed, resolve: resolved, verify2: verified2 },
    chain, base: { client: base[0], provider: base[1], funded: String(base[2]), released: String(base[3]), refunded: String(base[4]), milestones: String(base[5]), status: Number(base[6]), remaining: String(await escrow.remainingEscrow(auth.escrowKey)), activated: await escrow.isActivated(auth.escrowKey) },
    balancesBefore, balancesAfter, baseEvents,
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
