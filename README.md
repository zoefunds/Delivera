# Delivera — Performance-Based Contracting on GenLayer

Payments locked in on-chain escrow, released only when **GenLayer validator consensus** verifies —
against live evidence — that the agreed work was actually delivered.

Clients define milestones with concrete acceptance criteria and fund escrow. Providers submit
URL-addressable evidence (live sites, GitHub repos, APIs, documents). During consensus, **every
validator independently fetches the evidence with contract-side web access and runs its own AI
evaluation**; funds move only when they agree. Disagreements go to AI arbitration with basis-point
split settlement. No party — including the platform — can decide payouts alone.

## Table of contents

- [Why this needs GenLayer](#why-this-needs-genlayer)
- [Personas](#personas)
- [Live deployment](#live-deployment)
- [Architecture](#architecture)
- [The intelligent contract](#the-intelligent-contract-contractsdeliverapy)
- [Escrow & verification lifecycle](#escrow--verification-lifecycle)
- [Consensus / AI verification, in detail](#consensus--ai-verification-in-detail)
- [Wallets](#wallets-custodial)
- [REST API surface](#rest-api-surface)
- [Data model](#data-model)
- [Repository layout](#repository-layout)
- [Local development](#local-development)
- [Deployment](#deployment)
- [Security highlights](#security-highlights)
- [Known gotchas / lessons from getting this on-chain](#known-gotchas--lessons-from-getting-this-on-chain)

## Why this needs GenLayer

"Did this deliverable meet the criteria, so should escrow release?" is a subjective judgment that
directly moves funds. A single off-chain LLM would make whoever runs the server the judge. Here the
judgment is a consensus state transition: leader proposes, validators re-fetch evidence and re-run
the evaluation independently, and tolerance-banded comparison (approve gate + score band + evidence
reachability) makes honest subjectivity converge while catching a dishonest leader. The contract
never resolves anything from user-submitted text alone — evidence is always re-fetched on-chain by
every validator, not just accepted from what the provider claims.

## Personas

- **Client** — funds escrow, defines milestones + acceptance criteria, can approve manually, dispute,
  or cancel unstarted work.
- **Provider** (freelancer/agency) — accepts the contract, submits deliverables as evidence URLs,
  can resubmit after a rejection (bounded retries), receives GEN directly the moment a milestone
  settles.
- **Platform** — never touches funds. It only provides auth, UX, indexing/caching of chain state,
  notifications, and file attachments. Every fund-moving decision happens on the intelligent contract.

## Live deployment

| Component | URL / Address |
|---|---|
| Frontend | https://delivera-frontend.vercel.app |
| Backend API | https://delivera-api.fly.dev (`/health` for status) |
| Intelligent contract | `0x1Edb2894d3Cba0148042BCfBdAC6920691967B60` on GenLayer StudioNet |

Verified directly against this exact address with 30 real on-chain transactions across 5 contracts,
each exercising a different flow: an AI-approved milestone paid directly to the provider's wallet; an
AI-rejected milestone disputed and arbitrated (the arbitrator re-fetched the evidence and split 0% to
the provider / 100% refunded to the client, based on what it actually found); a manually-approved
milestone with no AI verification at all; a contract cancelled pre-funding (DRAFT); a contract
cancelled after funding but before acceptance (FUNDED), refunding real GEN directly to the client; and
a `withdraw` of leftover un-earmarked deposit balance. Every payout landed as a real wallet-balance
change with no separate release step. Earlier deployments of the same contract logic were separately
run through 100+ and 20 further transactions to validate the lifecycle at volume. See
[Known gotchas](#known-gotchas--lessons-from-getting-this-on-chain) for the value-transfer details.

## Architecture

| Layer | Tech | Where |
|---|---|---|
| Intelligent Contract | Python (genlayer-py-std), 1,200 lines, single contract | GenLayer StudioNet |
| Backend API | Node 22, Fastify 5, Prisma, PostgreSQL, Upstash Redis, Brevo, Tigris S3 | Fly.io |
| Frontend | Next.js 15 (App Router), Tailwind, dark mode | Vercel |
| Wallets | Custodial secp256k1, AES-256-GCM encrypted at rest, exportable | Postgres |

```
┌──────────────┐     HTTPS      ┌────────────────────┐
│  Next.js app │ ─────────────▶ │  Fastify API        │
│  (Vercel)    │                │  (Fly.io)            │
└──────────────┘                │  ├─ PostgreSQL (Fly) │
                                 │  ├─ Redis (Upstash)  │
                                 │  ├─ Tigris S3        │
                                 │  └─ Brevo (email)    │
                                 └─────────┬───────────┘
                                           │ genlayer-js, signed with
                                           │ the caller's custodial wallet
                                           ▼
                        ┌──────────────────────────────┐
                        │  DeliveraEscrow contract       │
                        │  (GenLayer StudioNet)           │
                        │  escrow ledger · milestone       │
                        │  state machine · AI verification │
                        │  (web fetch) · validator          │
                        │  consensus · disputes · settlement│
                        └──────────────────────────────┘
```

**Ownership boundary** (per GenLayer's own guidance for this class of app):
- **Frontend/backend own**: auth, profiles, notifications, file attachments, indexing/caching of
  chain state for fast reads, email.
- **Intelligent contract owns**: escrow balances, milestone state machine, evidence-based AI
  verification, the validator comparison rule, dispute resolution, settlement.
- **External sources own**: the deliverable evidence itself (live URLs) — validators re-fetch it
  independently every time; the contract never trusts submitted text alone.

Full documents: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/DATABASE.md](docs/DATABASE.md) ·
[docs/API.md](docs/API.md) · [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) · [MEMORY.md](MEMORY.md).

## The intelligent contract (`contracts/delivera.py`)

One production contract, `DeliveraEscrow` — 23 public methods (9 view / 14 write), deployed with a
pinned GenVM runner hash so its schema never silently drifts.

- **Escrow ledger, backed by real GEN, paid out immediately** — `deposit` is a payable method: the
  client's real GEN (atto-scale, `value × 10^18`) is transferred into the contract's own on-chain
  balance and credited to an un-earmarked `u256` ledger entry. `fund_escrow` locks that entry against
  a specific contract. From there, every exit — milestone settlement, dispute split, cancellation
  refund, contract-completion refund — pays real GEN **directly to the recipient's wallet** the moment
  it's earned, through a single emission choke point (`_send_gen`), not into a balance someone has to
  remember to withdraw. Every payout path follows checks-effects-interactions: ledger fields are zeroed
  and state persisted *before* the external transfer, so a reentrant call always finds the balance
  already spent and can never double-pay. `withdraw` still exists, but only to reclaim a deposit that
  was never locked into any contract.
- **Lifecycle** — `create_contract` (milestones + acceptance criteria + evidence type per milestone),
  `accept_contract`, `cancel_contract`, all behind a strict state-machine (`DRAFT → FUNDED → ACTIVE →
  COMPLETED/CANCELLED/DISPUTED`).
- **Verification** — `submit_deliverable` (evidence URLs + notes only, never free-form claims),
  `verify_deliverable`: leader and every validator independently `gl.nondet.web.get`/`web.render` the
  evidence and score it against the criteria with `gl.nondet.exec_prompt`. A custom validator function
  compares the **approve/not-approve gate**, a **score tolerance band (±20)**, a **borderline band
  (±12 around the 70-point threshold)**, and **evidence reachability**, so honest disagreement in
  wording still converges to one verdict — this is what keeps runs off `UNDETERMINED` without ever
  trusting the leader's output unchecked.
- **Disputes** — `raise_dispute`, `add_dispute_statement`, `resolve_dispute`: another
  validator-consensus AI arbitration, this time producing a basis-point client/provider split that
  settles immediately.
- **Manual override** — `approve_milestone` lets a client accept a deliverable without AI (e.g. after
  a good-faith conversation off-chain); it's blocked once a milestone is already settled by
  `verify_deliverable`, so funds are never released twice.
- **Resilience** — classified errors (`[EXPECTED]/[EXTERNAL]/[TRANSIENT]/[LLM_ERROR]`) so failure
  paths also reach consensus instead of stalling; defensive LLM JSON parsing with key aliasing;
  bounded resubmission attempts per milestone; O(1) status-count indexes for stats.

Lint: `genvm-lint check contracts/delivera.py` → passes.

## Escrow & verification lifecycle

1. Client calls `create_contract` — milestones, atto-scale amounts, acceptance criteria, evidence
   type — creating the on-chain record (mirrored in Postgres for fast listing).
2. Client `deposit`s real GEN (a payable call) into their ledger entry, then `fund_escrow` locks the
   full contract amount against this contract.
3. Provider `accept_contract` → contract goes `ACTIVE`.
4. Provider `submit_deliverable`: one or more evidence URLs + notes, per milestone.
5. Either party (or the platform, on their behalf) triggers `verify_deliverable`. Validators
   independently fetch the evidence and evaluate it → `APPROVED` / `NEEDS_REVISION` / `REJECTED`.
6. `APPROVED` settles immediately: the milestone amount moves from escrow to the provider's balance.
7. `NEEDS_REVISION` / `REJECTED` lets the provider resubmit, up to a configured attempt cap, after
   which the milestone is `EXHAUSTED`.
8. Either party can `raise_dispute` on a submitted/approved/rejected/exhausted milestone; each side
   can `add_dispute_statement`; `resolve_dispute` runs consensus AI arbitration over both statements
   and the original evidence, splitting the disputed amount by basis points.
9. Once every milestone reaches a terminal state, any unreleased escrow refunds to the client and the
   contract closes as `COMPLETED`.

## Consensus / AI verification, in detail

- The leader runs the non-deterministic block: fetch every evidence URL with contract-side web
  access, build a structured prompt from the milestone's title/description/acceptance criteria/notes,
  call `gl.nondet.exec_prompt(..., response_format="json")`, and parse `{verdict, score, criteria_met,
  reasoning}`.
- Each validator independently re-runs the exact same block — its own web fetch, its own LLM call —
  and the contract's validator function checks agreement on the **decision fields**, not the prose:
  verdict gate, score within tolerance, evidence reachability. Reasoning text is allowed to differ
  freely; only the fields that determine fund movement need to agree.
- This is why the contract almost never lands on `UNDETERMINED`: strict byte-for-byte agreement on an
  LLM's free-text output is nearly impossible across independent validator runs, so the comparison
  is deliberately narrowed to the decision-relevant fields with sane tolerance bands.
- Dispute resolution (`resolve_dispute`) follows the same pattern for a provider/client basis-point
  split, agreeing when splits land within 1500 bps of each other on the same side of 50/50.

## Wallets (custodial)

- On signup, the backend generates a secp256k1 keypair (ethers.js) — one wallet per account, forever.
- The private key is encrypted at rest with AES-256-GCM; the data key is derived per-user via scrypt
  from `WALLET_MASTER_KEY` plus a random per-user salt.
- Ciphertext, salt, and IV live in Postgres, so the wallet survives devices, cache clears, reinstalls.
- Exporting the raw key requires fresh password re-authentication and is audit-logged; it's shown once.
- Every contract write is signed server-side with the calling user's wallet via `genlayer-js` — the
  user never handles a private key or signs a transaction manually.

## REST API surface

Base path `/api/v1`, JSON only, `Authorization: Bearer <access JWT>` + an httpOnly refresh cookie.
Errors are a uniform `{ "error": { "code", "message", "details?" } }` envelope. Full reference:
[docs/API.md](docs/API.md).

| Area | Endpoints |
|---|---|
| Auth | register, verify-email, login, refresh, logout, forgot/reset-password, me |
| Wallet | view address + balance, one-time private-key export (re-auth gated) |
| Contracts | create, list, detail (chain state Redis-cached), fund, accept, cancel |
| Milestones | submit deliverable, trigger AI verification, manual approve |
| Disputes | raise, add statement, resolve |
| Funds | deposit, withdraw |
| Evaluations | full on-chain evaluation/consensus audit trail per contract |
| Misc | projects CRUD, notifications, reviews, file attachments (Tigris S3) |

Rate limits (Upstash Redis, sliding/fixed window): 5 req/15min on auth endpoints, 20 req/60s on
chain-write endpoints per user/IP — chain writes are naturally slow (they block on validator
consensus), so this rarely bites real usage.

## Data model

PostgreSQL via Prisma mirrors on-chain state for fast reads/search; the intelligent contract remains
the source of truth for anything that moves funds. Sixteen-plus tables covering users, custodial
wallets, sessions, contracts/milestones/deliverables mirrors, AI evaluation + consensus records,
on-chain transaction audit log, disputes, reviews, attachments, notifications, and a security audit
log. Full schema, constraints, and indexes: [docs/DATABASE.md](docs/DATABASE.md).

## Repository layout

```
contracts/delivera.py     Intelligent contract (GenLayer StudioNet)
backend/                  Fastify API, Prisma schema + migrations, tests
  src/lib/                genlayer.ts (chain client), crypto.ts (wallet encryption),
                          email.ts (Brevo), redis.ts, s3.ts, audit.ts
  src/routes/             auth, wallet, contracts, misc (projects/notifications/reviews/attachments)
  src/plugins/             auth (JWT), rateLimit (Redis)
frontend/                 Next.js 15 App Router + Tailwind
docs/                     ARCHITECTURE.md, DATABASE.md, API.md, DEPLOYMENT.md
MEMORY.md                 Project memory: stack decisions, GenLayer gotchas, deployment state
.github/workflows/ci.yml  Backend typecheck+test, frontend build, contract lint
```

## Local development

```bash
# Backend
cd backend
cp .env.example .env            # fill in values
npm install
npx prisma migrate dev
npm run dev                     # http://localhost:8080

# Frontend
cd frontend
npm install
NEXT_PUBLIC_API_URL=http://localhost:8080 npm run dev   # http://localhost:3000

# Contract lint
python3 -m venv .venv && .venv/bin/pip install genvm-linter
.venv/bin/genvm-lint check contracts/delivera.py
```

Tests: `cd backend && npm test`

## Deployment

Full guide in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Summary:

1. Deploy the contract to StudioNet with the `genlayer` CLI (gasless — no funding needed):
   `genlayer deploy --contract contracts/delivera.py`.
2. `fly deploy` the backend (Fly builds remotely from the Dockerfile) with all secrets set, including
   `GENLAYER_CONTRACT_ADDRESS` pointing at the address from step 1, `DATABASE_URL` (Fly Postgres),
   `REDIS_URL` (Upstash), `BREVO_API_KEY`, `WALLET_MASTER_KEY`, and Tigris S3 credentials.
3. `vercel --prod` the frontend with `NEXT_PUBLIC_API_URL` pointing at the Fly backend, then update
   `APP_URL`/`CORS_ORIGINS` on the backend once the final Vercel domain is known and redeploy.
4. Whenever the contract is redeployed, update the `GENLAYER_CONTRACT_ADDRESS` secret and `fly deploy`
   again — the backend picks it up on the rolling restart.

## Security highlights

Argon2id passwords · JWT (15 min) + rotating httpOnly refresh tokens · per-user AES-256-GCM wallet
encryption (scrypt-derived keys) · one-time audited key export · Redis rate limiting · zod validation
on every route · uniform error envelope · audit log for auth/wallet/contract actions · secrets only in
Fly/Vercel, never committed.

## Known gotchas / lessons from getting this on-chain

A few GenVM/genlayer-js behaviors that aren't obvious from the docs, kept here so they don't get
re-discovered the hard way:

- **Storage containers can't be constructed by hand.** `DynArray[str]()` or similar inside contract
  code raises `TypeError: this class can't be instantiated by user` at runtime (not at lint time).
  Pass a plain Python list (`[]`) instead when initializing a storage-typed field in a dataclass
  constructor — the framework converts it.
- **`gl.message.sender_address`**, not `sender_account` — the latter doesn't exist on the StudioNet
  runtime and only fails when the method actually runs.
- **A write transaction's return value isn't `receipt.result`.** That field is a consensus vote code.
  The actual decoded return value is nested at
  `receipt.consensus_data.leader_receipt[0].result.payload.readable` as a JSON-encoded string —
  decode it explicitly (see `decodeGenvmResult` in `backend/src/lib/genlayer.ts`).
- **Real value transfer works, but only lands at `FINALIZED`, not `ACCEPTED`.** `deposit` is
  `@gl.public.write.payable` and genuinely receives `gl.message.value`; every payout path sends GEN
  back out via `emit_transfer` from a single `@gl.evm.contract_interface` stub, through one emission
  choke point (`_send_gen`) — the pattern in GenLayer's own `faucet.py` example, and in the ShipBond
  project's escrow design this contract's payout paths were rebuilt against. Every payout follows
  checks-effects-interactions: ledger fields are zeroed and state persisted *before* the transfer, so a
  reentrant call always finds the balance already spent. Verified directly multiple ways: a fresh
  0-GEN wallet deposited real GEN and the contract's on-chain balance rose by that exact amount; a
  milestone approval paid the provider's real wallet balance from `0` straight to the milestone amount
  with no separate withdraw call; a dispute resolution split GEN to both parties' real wallets in one
  settlement, and a `0` share correctly triggered no transfer at all. The catch — `ACCEPTED` only means
  validator consensus was reached on the state change; the `emit_transfer` payload doesn't actually
  execute until the transaction reaches `FINALIZED` (past the appeal window), which takes noticeably
  longer. Calls that pay out (`withdraw`, milestone settlement, dispute resolution, cancellation)
  should wait for `FINALIZED` specifically if the caller needs the transfer to have actually landed;
  the rest of the lifecycle only needs `ACCEPTED`. (A related, StudioNet-specific gotcha: on some other
  GenLayer testnets `gl.message.value` is documented to always read `0` even though the EVM-layer
  transfer still happens — that bug does **not** reproduce on StudioNet, confirmed by direct probe
  before relying on it here.)
  Gasless also means a fresh wallet with a 0 GEN balance is normal and needs no funding.
  All-transaction sequences that run for a while should expect the 15-minute access token to expire
  mid-run and handle re-authentication, and treat an occasional 500 from a chain-write endpoint as
  potentially transient (a validator round where the LLM's output didn't parse cleanly) rather than
  fatal — retrying is the normal recovery path.
