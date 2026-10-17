import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(), updateMany: vi.fn(), contractUpdate: vi.fn(), transactionCreate: vi.fn(),
  isProcessed: vi.fn(), release: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    milestone: { findMany: mocks.findMany },
    transaction: { create: mocks.transactionCreate },
    $transaction: vi.fn(async (fn) => fn({
      milestone: { updateMany: mocks.updateMany },
      contract: { update: mocks.contractUpdate },
    })),
  },
}));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock("../services/baseSepolia.js", () => ({
  isEscrowConfigured: () => true,
  settlementId: () => "0xsettlement",
  isSettlementProcessed: mocks.isProcessed,
  releaseMilestone: mocks.release,
  refund: vi.fn(), resolveDispute: vi.fn(), getRemainingEscrow: vi.fn(),
}));

import { relayApprovedMilestones } from "./relay.js";

describe("relay recovery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reconciles a mined settlement after a crash without broadcasting again", async () => {
    mocks.findMany.mockResolvedValue([{
      id: "milestone-db-id", index: 0, amountAtto: 500_000_000_000_000_000n,
      contract: { id: "contract-db-id", chainContractId: "delivera-2", providerId: "provider", clientId: "client" },
    }]);
    mocks.isProcessed.mockResolvedValue(true);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.contractUpdate.mockResolvedValue({});
    mocks.transactionCreate.mockResolvedValue({});

    await expect(relayApprovedMilestones()).resolves.toEqual({ relayed: ["milestone-db-id"] });
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { relayTxHash: "RECOVERED:0xsettlement" },
    }));
  });
});
