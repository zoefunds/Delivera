# Delivera — Database Design (PostgreSQL via Prisma)

PostgreSQL is an application index and recovery mirror. GenLayer StudioNet is authoritative for agreement decisions; `DeliveraEscrow` on Base Sepolia is authoritative for USDC custody, allocation settlement, and replay protection. The active Prisma schema is [`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma).

## Current entities

| Prisma model | Purpose | Important fields |
|---|---|---|
| `User` | Wallet-native account and optional profile | `walletAddress` (unique), optional legacy-compatible `email`, `name`, `role`, `avatarUrl` |
| `Session` | Hashed refresh-token session | `tokenHash` (unique), `userId`, `expiresAt`, `revokedAt`, `ip`, `userAgent` |
| `Project` | Client-owned grouping for agreements | `ownerId`, `title`, `description`, `status` |
| `Contract` | Indexed GenLayer agreement and Base accounting mirror | `chainContractId` (unique), parties, `totalAtto`, lifecycle status, funding proof, mirrored funded/released/refunded totals, refund relay hash |
| `Milestone` | Ordered milestone and relay checkpoint | `(contractId, index)` (unique), acceptance criteria, evidence type, `amountAtto`, status, attempts, `relayTxHash` |
| `Deliverable` | Evidence submission history | `milestoneId`, `submitterId`, `evidenceUrls`, notes, attempt |
| `AiEvaluation` | Structured verdict mirror | `deliverableId`, verdict, score, criteria result, reasoning, consensus round |
| `Dispute` | Milestone-specific arbitration mirror | `chainDisputeIndex`, `milestoneIndex`, statements, finalized basis-point split, resolution summary, `relayTxHash` |
| `Transaction` | Application transaction audit record | user/contract references, kind, chain hash, status, JSON payload |
| `Review` | Post-agreement rating | contract, reviewer, reviewee, rating, comment |
| `Attachment` | Optional uploaded-file metadata | owner, optional milestone, storage key, filename, MIME type, size |
| `Notification` | In-app notification and optional email-delivery state | user, type, title, body, `readAt`, `emailedAt` |
| `AuditLog` | Security and operational audit trail | optional user, action, IP, user agent, JSON detail |
| `ApiKey` | Hashed programmatic credential | user, `keyHash` (unique), label, last use, revocation |

There are no custodial-wallet, email-token, validator-decision, consensus-record, or escrow-balance tables. Per-validator consensus and financial balances must be read from their respective chains, not invented from PostgreSQL rows.

## Financial recovery rules

- Ledger amounts in PostgreSQL use `Decimal(78,0)` and the inherited 18-decimal contract convention. Base USDC uses 6 decimals; relay code performs the explicit conversion.
- PostgreSQL relay hashes are checkpoints, not the replay-protection boundary. Before retrying an uncertain payout, the relay derives the deterministic settlement identifier and reads `processedSettlements` and the milestone allocation from Base.
- If Base already processed a settlement but PostgreSQL missed the receipt, the relay records `RECOVERED:<settlementId>` and reconciles the mirror without broadcasting another transfer.
- Funding confirmation stores the Base transaction hash and binding data only after verifying the emitted funding event and the finalized GenLayer state.
- A dispute is tied to its exact milestone index. Its finalized split applies only to that milestone's remaining allocation.

## Constraints and indexes

- Foreign keys define explicit cascade or restrict behavior for owned and financial records.
- Unique constraints cover wallet addresses, session hashes, chain contract IDs, `(contractId, index)`, review pairs, and API-key hashes.
- Query indexes cover agreement parties/status, project ownership, milestone and deliverable relationships, dispute lookup, transaction hashes, notifications, and audit timestamps.
- Financial mirrors use exact decimal columns; floating-point values are never used for money.

## Migration and production

The canonical database is Fly Postgres app `delivera-db-gideon`. Apply checked-in migrations with:

```bash
cd backend
npx prisma migrate deploy
```

Use `prisma migrate dev` only for local development. Never edit production financial mirrors by hand; reconcile them from finalized GenLayer reads and Base receipts/state.
