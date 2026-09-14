# Delivera — Architecture

## Product Vision

Delivera is a performance-based contracting platform. Clients lock payment in real USDC escrow on Base
Sepolia; freelancers/agencies submit deliverables; a GenLayer Intelligent Contract — not either party —
decides whether the agreed acceptance criteria were met, using AI evaluation executed independently by
multiple validators under Optimistic Democracy consensus. GenLayer's decision is then mirrored by a
backend relay onto the escrow contract, which releases (or refunds, or splits) the real USDC. Funds
release only on verified delivery, and only GenLayer ever gets to decide that — but GenLayer itself
never custodies a dollar of it.

Why this needs GenLayer (and not just an AI backend): the settlement decision — "did the work meet the
criteria, so should escrow release?" — is a subjective judgment that directly moves funds. A single
off-chain LLM answer would let whoever runs the server decide payouts. GenLayer validators each
independently fetch the evidence (live website, GitHub repo, API endpoint, document), run their own AI
evaluation, and must agree before the state transition (approve / reject / dispute split) happens. The
contract verifies actual outcomes against real evidence via contract-side web access, never
user-submitted claims alone.

Why the *payment* isn't on GenLayer: GenLayer is well suited to adjudication (non-deterministic,
consensus-checked AI evaluation) but the goal here is to settle real value quickly and cheaply once a
decision is made, in a widely-held stablecoin. So the value layer was moved to a purpose-built Solidity
escrow contract on Base Sepolia, and GenLayer's role narrowed to exactly what it's good at: deciding.

## Personas

- **Client** — connects a wallet to sign in, funds escrow directly from that wallet in USDC on Base
  Sepolia, defines milestones + acceptance criteria, can dispute.
- **Provider** (freelancer/agency/DAO contributor) — connects a wallet to sign in (or is invited by
  wallet address or email), accepts contract, submits deliverables (URLs to live evidence), can
  resubmit after rejection.
- **Platform** — never custodies funds directly; runs GenLayer adjudication (via a per-user custodial
  signing wallet) and the relay that mirrors decisions onto the real escrow, plus UX, indexing,
  notifications.

## System Overview

```
┌──────────────┐  connect + sign  ┌────────────────┐
│  User's own  │ ────────────────▶│  Next.js app   │
│  wallet      │  fund escrow     │  (Vercel)      │
│ (MetaMask…)  │ ────────────────▶└───────┬────────┘
└──────────────┘  (direct tx,             │ HTTPS
                   Base Sepolia)           ▼
                                   ┌────────────────────┐
                                   │  Fastify API        │
                                   │  (Fly.io)           │
                                   │  ├─ Postgres (Fly)  │
                                   │  ├─ Redis (Upstash) │
                                   │  ├─ Tigris S3       │
                                   │  └─ Brevo (email)   │
                                   └───┬─────────────┬──┘
                genlayer-js, signed with              │ ethers v6, signed with
                the user's custodial                   │ a dedicated relayer key
                GenLayer wallet                          │ (relay.ts, 30s poll)
                                   ▼                      ▼
                ┌─────────────────────────┐   ┌──────────────────────────┐
                │ Delivera Intelligent     │   │  DeliveraEscrow.sol      │
                │ Contract (GenLayer       │   │  Base Sepolia            │
                │ StudioNet) — decides,    │──▶│  holds real USDC,        │
                │ moves no value           │mirror│ release/refund/       │
                │ escrow bookkeeping ·     │decision│ resolveDispute      │
                │ milestones · AI          │   │  (relayer-only)          │
                │ verification (web fetch) │   │  fundEscrow (client-only)│
                │ · validator consensus ·  │   └──────────────────────────┘
                │ disputes                 │
                └─────────────────────────┘
```

Boundary (per GenLayer guidance, adapted for the two-chain split):
- **Frontend/backend own**: auth (wallet-signature), profiles, notifications, file attachments,
  indexing/caching of chain state, previews, and the relay that copies GenLayer's decisions onto the
  escrow contract.
- **Intelligent contract (GenLayer) owns**: the milestone state machine, evidence-based AI
  verification, the validator comparison rule, dispute resolution — every *decision* about whether
  money should move, but not custody of the money itself.
- **Escrow contract (Base Sepolia) owns**: actual USDC custody and transfers — funding (called
  directly by the client's wallet), release, refund, and dispute-split payout (relayer-only, driven
  only by a GenLayer decision already mirrored in Postgres).
- **External sources own**: the deliverable evidence (live URLs) — validators re-fetch them
  independently; the contract never trusts submitted text alone.

## Wallet Architecture (two separate wallets)

The login wallet and the GenLayer signing wallet are different wallets with different purposes — this
is the single most load-bearing fact about the current architecture.

- **Login / funding wallet** — the user's own external wallet (MetaMask, etc.), connected via Reown
  AppKit (`frontend/src/lib/appkit.ts`). It signs the SIWE-style login message and sends every real
  Base Sepolia USDC transaction (funding, receiving a payout or refund). Delivera never holds this
  wallet's key.
- **GenLayer signing wallet** — custodial, backend-held, provisioned automatically on a user's first
  sign-in purely so the backend can sign GenLayer intelligent-contract calls on that user's behalf.
  - Private key encrypted with AES-256-GCM; data key derived per-user via scrypt from
    `WALLET_MASTER_KEY` + a per-user random salt. Ciphertext + salt + IV stored in Postgres.
  - Export requires the user to sign a fresh one-time message with their *login* wallet (there's no
    password anymore); decrypts and returns the key once; audit-logged.
  - Never holds or moves real money now that escrow lives in USDC on Base Sepolia — its on-chain
    GenLayer "balance" is vestigial bookkeeping.
- All GenLayer contract writes are signed server-side with the calling user's custodial wallet via
  genlayer-js. All client-initiated Base Sepolia writes (funding) are signed by the user's own login
  wallet. All relayer-initiated Base Sepolia writes (release/refund/dispute payout) are signed by a
  third, separate relayer key held by neither wallet above.

## Escrow Flow

1. Client creates contract on GenLayer: milestones, atto-scale (18-decimal, dollar-equivalent) amounts,
   acceptance criteria, evidence type.
2. Client funds escrow themselves: their wallet calls `approve` then
   `fundEscrow(contractId, freelancer, amount)` directly on `DeliveraEscrow.sol` on Base Sepolia
   (`frontend/src/lib/escrow.ts`'s `fundEscrowOnChain`). The frontend posts the resulting tx hash to
   `POST /contracts/:id/fund`; the backend verifies a matching `EscrowFunded` event on-chain
   (`verifyEscrowFunded`) before marking the contract `FUNDED` in Postgres and calling `fund_escrow` on
   GenLayer to flip its own state. GenLayer's own `deposit`/`withdraw` methods are disabled — no real
   value ever moves through GenLayer.
3. Provider accepts → contract ACTIVE.
4. Provider submits deliverable: evidence URL(s) + notes per milestone.
5. GenLayer runs AI verification (leader + validators independently fetch evidence and evaluate) →
   APPROVED / REJECTED / NEEDS_REVISION. This only decides the outcome; no money moves yet.
6. APPROVED is written to Postgres; the relay (`backend/src/jobs/relay.ts`, 30s poll) picks it up and
   calls `releaseMilestone` on `DeliveraEscrow.sol`, paying the milestone amount in real USDC directly
   to the provider's wallet. The tx hash is stored on the row as the idempotency guard.
7. REJECTED/NEEDS_REVISION → provider may resubmit (bounded retries).
8. Either party may dispute; dispute resolution is another validator-consensus AI evaluation over both
   parties' evidence on GenLayer, producing a basis-point split; the relay then calls `resolveDispute`
   on Base Sepolia, which pays both shares in real USDC in one call.
9. Client can cancel unstarted work; any funded-but-unreleased escrow is refunded via the relay calling
   `refund` on Base Sepolia. (Timeout-based recovery for a stalled mid-work contract is not built yet —
   see the README's Known limitations.)

**Unit convention:** ledger amounts (`*Atto` columns) are stored 18-decimal, dollar-equivalent (a $100
milestone is `100 * 10^18`) — inherited from GenLayer's native-GEN accounting even though no GEN is
involved. The relay rescales ÷ `10^12` into 6-decimal USDC base units whenever it actually pays out on
Base Sepolia. The frontend keeps `formatContractAmount` (18-decimal ledger display) and `formatUsdc`
(raw 6-decimal on-chain display) separate for exactly this reason.

## Consensus / AI Verification Flow

- Leader validator executes the nondeterministic block: fetches evidence with `gl.nondet.web.get`, runs `gl.nondet.exec_prompt` scoring against acceptance criteria, returns structured verdict {verdict, score, criteria_met, reasoning}.
- Each validator re-executes the same block independently (own web fetch + own LLM) and compares **decision fields with tolerances**: verdict gate must match on approve/not-approve; scores within tolerance band; deterministic evidence facts (HTTP status, domain) must match. Formatting/reasoning text may differ — that's allowed, which prevents UNDETERMINED outcomes without being leader-trusting.
- Errors are classified ([EXPECTED]/[EXTERNAL]/[TRANSIENT]/[LLM_ERROR]) so failure paths also reach consensus.
- Optimistic democracy: result is accepted optimistically, appealable; on appeal more validators re-evaluate.
- None of this changed with the move to USDC — GenLayer still does 100% of the actual adjudication
  work; only the resulting fund movement was relocated to Base Sepolia.

## Security

- Wallet-signature (SIWE-style) login — no passwords to hash or leak; JWT access (15m) + rotating
  refresh tokens (httpOnly).
- Custodial GenLayer wallet export is gated on signing a fresh message with the login wallet, not a
  password, and is audit-logged.
- On-chain `EscrowFunded` event verification before any funding claim is trusted.
- The relayer's private key is kept separate from every user's custodial GenLayer wallet, so
  compromising one user's account can never reach payout capability.
- Rate limiting (Upstash Redis, per-IP + per-account), CORS allowlist, helmet headers, zod input validation everywhere, Prisma (parameterized SQL).
- Secrets only via Fly/Vercel secrets; never committed.
- Audit log table for auth events, wallet export, contract actions.
- Brevo transactional email is now best-effort notifications only (`email.notify`), sent to accounts
  that happen to have an optional email on file — there is no verification or password-reset flow left
  for it to send.

## Deployment

- Frontend → Vercel project `delivera-frontend` (`vercel --prod`), env: `NEXT_PUBLIC_API_URL`,
  `NEXT_PUBLIC_REOWN_PROJECT_ID`.
- Backend → Fly.io app `delivera-api-v2` (`fly deploy`, no Docker builds locally — Fly builds remotely
  from Dockerfile; the original `delivera-api` name is stuck on an inaccessible account), Fly Postgres
  attach, Upstash Redis, Tigris via `fly storage create`.
- GenLayer contract → GenLayer StudioNet via `genlayer` CLI (gasless). After deploy, set
  `GENLAYER_CONTRACT_ADDRESS` secret and redeploy backend.
- Escrow contract → `DeliveraEscrow.sol` on Base Sepolia (address
  `0x604919F0AB7d0DEdc74102d36C83bB5078714383`); after deploy, set the escrow address, RPC URL, and
  relayer private key secrets and redeploy backend.

## Scaling & Ops

- Stateless API → `fly scale count N`; Postgres read replicas when needed.
- Redis caching of chain reads (contract state polled + cached, TTL 15s).
- The relay job runs in-process on a 30s poll — no separate deployment, but also no built-in alerting
  yet if a decision goes un-relayed for an unusually long time.
- pino structured logs → Fly log shipping; /health + /metrics endpoints.
- Backups: Fly Postgres daily snapshots; S3 versioning on Tigris bucket.
- CI: GitHub Actions — lint, typecheck, tests, contract lint on every push.
