-- Wallet-signature (SIWE) auth replaces email/password; Base Sepolia escrow
-- relay replaces native-GEN payout, needing idempotency columns.

-- AlterTable: User — email/password become optional, add walletAddress.
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "walletAddress" TEXT;

CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

-- AlterTable: Milestone — relay receipt/recovery mirror (on-chain state is authoritative).
ALTER TABLE "Milestone" ADD COLUMN "relayTxHash" TEXT;

-- AlterTable: Contract — refund receipt/recovery mirror.
ALTER TABLE "Contract" ADD COLUMN "refundRelayTxHash" TEXT;

-- AlterTable: Dispute — resolution receipt/recovery mirror.
ALTER TABLE "Dispute" ADD COLUMN "relayTxHash" TEXT;
