import { describe, expect, it, vi } from "vitest";
import { ethers } from "ethers";

vi.mock("../config.js", () => ({
  config: {
    BASE_SEPOLIA_RPC_URL: "https://example.invalid",
    BASE_SEPOLIA_USDC_ADDRESS: ethers.ZeroAddress,
    DELIVERA_ESCROW_ADDRESS: ethers.Wallet.createRandom().address,
    BASE_SEPOLIA_RELAYER_PRIVATE_KEY: "",
    BASE_SEPOLIA_DECISION_AUTHORITY_PRIVATE_KEY: "",
  },
}));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));

import { DELIVERA_ESCROW_ABI } from "../lib/escrowAbi.js";
import { contractIdToBytes32, verifyEscrowFundingReceipt } from "./baseSepolia.js";

describe("verifyEscrowFundingReceipt", () => {
  const escrow = ethers.Wallet.createRandom().address;
  const client = ethers.Wallet.createRandom().address;
  const provider = ethers.Wallet.createRandom().address;
  const allocations = [400_000n, 600_000n];
  const iface = new ethers.Interface(DELIVERA_ESCROW_ABI);

  function receipt(eventClient = client, amount = 1_000_000n, committed = allocations) {
    const allocationHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["uint256[]"], [committed]),
    );
    const encoded = iface.encodeEventLog(iface.getEvent("EscrowFunded")!, [
      contractIdToBytes32("agreement-1"), eventClient, provider, amount, allocationHash,
    ]);
    return { status: 1, logs: [{ address: escrow, topics: encoded.topics, data: encoded.data }] } as never;
  }

  it("accepts only the exact client, provider, amount, and allocation commitment", () => {
    expect(verifyEscrowFundingReceipt(receipt(), escrow, "agreement-1", client, provider, 1_000_000n, allocations)).toEqual({
      ok: true, amount: 1_000_000n,
    });
  });

  it("rejects false funding claims and unauthorized pre-funding receipts", () => {
    const attacker = ethers.Wallet.createRandom().address;
    expect(verifyEscrowFundingReceipt(receipt(attacker), escrow, "agreement-1", client, provider, 1_000_000n, allocations).ok).toBe(false);
    expect(verifyEscrowFundingReceipt(receipt(client, 999_999n), escrow, "agreement-1", client, provider, 1_000_000n, allocations).ok).toBe(false);
    expect(verifyEscrowFundingReceipt(receipt(client, 1_000_000n, [1_000_000n]), escrow, "agreement-1", client, provider, 1_000_000n, allocations).ok).toBe(false);
  });
});
