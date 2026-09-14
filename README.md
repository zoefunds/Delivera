# Delivera — Performance-Based Contracting, Adjudicated by GenLayer, Paid in USDC

Payments locked in real USDC escrow on Base Sepolia, released only when **GenLayer validator
consensus** verifies — against live evidence — that the agreed work was actually delivered.

Clients define milestones with concrete acceptance criteria and fund escrow directly from their own
wallet. Providers submit URL-addressable evidence (live sites, GitHub repos, APIs, documents). During
consensus, **every validator independently fetches the evidence with contract-side web access and runs
its own AI evaluation**; a decision moves only when they agree. Disagreements go to AI arbitration with
basis-point split settlement. GenLayer decides every outcome — approve, reject, split — but never
custodies a dollar of it: a backend relay mirrors each decision onto a Solidity escrow contract on Base
Sepolia, which is what actually holds and moves the USDC. No party — including the platform — can
decide payouts alone.

## Table of contents

- [Why this needs GenLayer](#why-this-needs-genlayer)
- [Personas](#personas)
- [Live deployment](#live-deployment)
- [Architecture](#architecture)
- [The intelligent contract](#the-intelligent-contract-contractsdeliverapy)
- [Escrow & verification lifecycle](#escrow--verification-lifecycle)
- [Consensus / AI verification, in detail](#consensus--ai-verification-in-detail)
- [Payments: Base Sepolia USDC escrow + relay](#payments-base-sepolia-usdc-escrow--relay)
- [Wallets](#wallets-two-separate-ones)
- [Frontend](#frontend)
- [REST API surface](#rest-api-surface)
- [Data model](#data-model)
- [Repository layout](#repository-layout)
- [Local development](#local-development)
- [Deployment](#deployment)
- [Security highlights](#security-highlights)
- [Known gotchas / lessons from getting this on-chain](#known-gotchas--lessons-from-getting-this-on-chain)
- [Known limitations](#known-limitations)

## Why this needs GenLayer

"Did this deliverable meet the criteria, so should escrow release?" is a subjective judgment that
directly moves funds. A single off-chain LLM would make whoever runs the server the judge. Here the
judgment is a consensus state transition: leader proposes, validators re-fetch evidence and re-run
the evaluation independently, and tolerance-banded comparison (approve gate + score band + evidence
reachability) makes honest subjectivity converge while catching a dishonest leader. The contract
never resolves anything from user-submitted text alone — evidence is always re-fetched on-chain by
every validator, not just accepted from what the provider claims.

GenLayer is the adjudicator, not the vault. It decides *whether* and *how* money should move; a
separate Solidity contract on Base Sepolia (`DeliveraEscrow.sol`) is what actually holds the USDC and
moves it, driven by a backend relay that mirrors each GenLayer decision one-for-one. See
[Payments](#payments-base-sepolia-usdc-escrow--relay) for why the value layer moved off GenLayer.

## Personas

- **Client** — connects a wallet to sign in, funds escrow directly from that wallet in USDC on Base
  Sepolia, defines milestones + acceptance criteria, can approve manually, dispute, or cancel unstarted
  work.
- **Provider** (freelancer/agency) — connects a wallet to sign in (or is invited by wallet address or
  email), accepts the contract, submits deliverables as evidence URLs, can resubmit after a rejection
  (bounded retries), receives real USDC the moment a milestone settles.
- **Platform** — never custodies funds directly. It runs the GenLayer adjudication (via a per-user
  custodial signing wallet, see [Wallets](#wallets-two-separate-ones)) and a relay that mirrors GenLayer's
  decisions onto the real USDC escrow, plus auth, UX, indexing/caching of chain state, notifications,
  and file attachments. Every fund-moving *decision* happens on the intelligent contract; every
  fund-moving *transfer* happens on `DeliveraEscrow.sol`, driven only by that decision.

Contracts are private to their two parties: the list endpoint only ever returns contracts where the
caller is the client or the provider, and the detail endpoint returns `403 Forbidden` for anyone else
— a third account can't see a contract by guessing its URL, and it never appears in their list.

## Live deployment

| Component | URL / Address |
|---|---|
| Frontend | https://delivera-frontend.vercel.app |
| Backend API | Fly.io app `delivera-api-v2` (`/health` for status) — the original `delivera-api` name is stuck on an inaccessible account, so this is the real one despite the mismatched app name in older links |
| Intelligent contract (adjudication only) | `0x0Cf76bb4202FAe133Fa17F6512c03Eba76f9E7Fe` on GenLayer StudioNet |
| Escrow contract (holds real value) | `DeliveraEscrow.sol` at `0x604919F0AB7d0DEdc74102d36C83bB5078714383` on Base Sepolia |
| USDC (Base Sepolia) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

Historically, before the payment layer moved to Base Sepolia, the GenLayer contract itself moved real
native GEN directly on every payout path and was verified with 30+ on-chain transactions doing exactly
that (AI-approved milestones, disputed/arbitrated splits, manual approvals, cancellations with refunds,
and deposit withdrawals — see [Known gotchas](#known-gotchas--lessons-from-getting-this-on-chain) for
that history). GenLayer no longer moves any value at all — `_send_gen` is now a documented no-op and
`deposit`/`withdraw` are disabled — it only decides outcomes, which the relay described in
[Payments](#payments-base-sepolia-usdc-escrow--relay) replays as real USDC transfers on Base Sepolia.

## Architecture

| Layer | Tech | Where |
|---|---|---|
| Intelligent Contract (adjudication) | Python (genlayer-py-std), single contract, no longer moves value | GenLayer StudioNet |
| Escrow Contract (custody) | Solidity, holds real USDC, relayer-controlled release/refund/dispute functions | Base Sepolia |
| Backend API | Node 22, Fastify 5, Prisma, PostgreSQL, Upstash Redis, Brevo, Tigris S3, ethers v6 | Fly.io |
| Frontend | Next.js 15 (App Router), Tailwind, Reown AppKit wallet connect, dark mode | Vercel |
| Login wallet | The user's own external wallet (MetaMask etc.), connected via Reown AppKit; signs in and funds escrow | User-held |
| GenLayer signing wallet | Custodial secp256k1, AES-256-GCM encrypted at rest, exportable; signs GenLayer calls only, never holds real money | Postgres |

```
┌──────────────┐  connect+sign   ┌────────────────┐
│  User's own  │ ───────────────▶│  Next.js app   │
│  wallet      │  fund escrow    │  (Vercel)      │
│ (MetaMask…)  │ ───────────────▶└───────┬────────┘
└──────────────┘  (direct tx,           │ HTTPS
                   Base Sepolia)         ▼
                                 ┌────────────────────┐
                                 │  Fastify API        │
                                 │  (Fly.io)           │
                                 │  ├─ PostgreSQL (Fly)│
                                 │  ├─ Redis (Upstash) │
                                 │  ├─ Tigris S3       │
                                 │  └─ Brevo (email)   │
                                 └───┬─────────────┬──┘
                    genlayer-js, signed with        │ ethers v6, signed with
                    the user's custodial             │ a dedicated relayer key
                    GenLayer wallet                   │ (relay.ts, every 30s)
                                 ▼                    ▼
              ┌─────────────────────────┐   ┌──────────────────────────┐
              │  DeliveraEscrow (GL)     │   │  DeliveraEscrow.sol       │
              │  GenLayer StudioNet      │   │  Base Sepolia             │
              │  milestone state machine │──▶│  holds real USDC          │
              │  AI verification (web    │mirror│ release/refund/         │
              │  fetch) · validator       │decision│ resolveDispute       │
              │  consensus · disputes     │   │  (relayer-only)          │
              └─────────────────────────┘   └──────────────────────────┘
```

**Ownership boundary** (per GenLayer's own guidance for this class of app, adapted for the
two-chain split):
- **Frontend/backend own**: auth (wallet-signature), profiles, notifications, file attachments,
  indexing/caching of chain state for fast reads, email, and the relay that copies GenLayer's
  decisions onto the escrow contract.
- **Intelligent contract (GenLayer) owns**: the milestone state machine, evidence-based AI
  verification, the validator comparison rule, dispute resolution — i.e. every *decision* about
  whether money should move, but not the money itself.
- **Escrow contract (Base Sepolia) owns**: actual custody of USDC and the real transfers — funding
  (called directly by the client's wallet), release, refund, and dispute-split payout (all three
  called only by the relayer, only in response to a GenLayer decision already mirrored in Postgres).
- **External sources own**: the deliverable evidence itself (live URLs) — validators re-fetch it
  independently every time; the contract never trusts submitted text alone.

Full documents: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/DATABASE.md](docs/DATABASE.md) ·
[docs/API.md](docs/API.md) · [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) · [MEMORY.md](MEMORY.md).

## The intelligent contract (`contracts/delivera.py`)

One production contract, `DeliveraEscrow` — 23 public methods (9 view / 14 write), deployed with a
pinned GenVM runner hash so its schema never silently drifts.

- **Escrow ledger, bookkeeping only — no real value moves here anymore.** `deposit` and `withdraw` are
  both disabled and now raise a `UserError` telling the caller to use `DeliveraEscrow.sol` on Base
  Sepolia instead; `_send_gen`, the single choke point every payout path still calls into, is a
  documented no-op. `fund_escrow` still transitions `DRAFT → FUNDED` and sets `funded_atto`, but only
  once the backend relay has independently confirmed a matching USDC deposit happened on Base
  Sepolia — the atto-scale ledger fields (`funded_atto`, `released_atto`, `refunded_atto`,
  `escrow_locked_total`) exist purely so the rest of this contract's milestone/dispute math keeps
  working unchanged. The real payout — real USDC landing in a real wallet — happens later, on Base
  Sepolia, via the relay described in
  [Payments](#payments-base-sepolia-usdc-escrow--relay). Every ledger update still follows
  checks-effects-interactions (fields zeroed and state persisted before the `_send_gen` no-op is even
  called), which is what the relay's idempotency guard on the Base Sepolia side builds on.
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
   type — creating the on-chain record on GenLayer (mirrored in Postgres for fast listing).
2. Client funds escrow themselves, on-chain, in USDC: their connected wallet calls `approve` then
   `fundEscrow(contractId, freelancer, amount)` directly on `DeliveraEscrow.sol` on Base Sepolia (see
   `frontend/src/lib/escrow.ts`'s `fundEscrowOnChain`). The frontend then calls
   `POST /api/v1/contracts/:id/fund` with the resulting tx hash; the backend verifies a matching
   `EscrowFunded` event on-chain (contract id, freelancer address, amount) before mirroring the
   contract as `FUNDED` in Postgres and calling `fund_escrow` on the GenLayer contract to flip its own
   state — a client can't fake this by just hitting the endpoint.
3. Provider `accept_contract` → contract goes `ACTIVE`.
4. Provider `submit_deliverable`: one or more evidence URLs + notes, per milestone.
5. Either party (or the platform, on their behalf) triggers `verify_deliverable` on GenLayer.
   Validators independently fetch the evidence and evaluate it → `APPROVED` / `NEEDS_REVISION` /
   `REJECTED`. This step only ever decides the outcome — no money moves yet.
6. `APPROVED` is written to Postgres; within 30 seconds the relay (`backend/src/jobs/relay.ts`) picks
   it up and calls `releaseMilestone(contractId, amount)` on `DeliveraEscrow.sol`, which pays the
   milestone amount in real USDC **directly to the provider's wallet**. The resulting tx hash is
   stored on the milestone row, which doubles as the idempotency guard against relaying twice.
7. `NEEDS_REVISION` / `REJECTED` lets the provider resubmit, up to a configured attempt cap, after
   which the milestone is `EXHAUSTED`. Every submission's evidence URLs, notes, and timestamp remain
   visible on the contract detail page, alongside the AI's reasoning for each verdict — the full
   history, not just the latest attempt.
8. Either party can `raise_dispute` on a submitted/approved/rejected/exhausted milestone; each side
   can `add_dispute_statement`; `resolve_dispute` runs consensus AI arbitration over both statements
   and the original evidence on GenLayer, producing a basis-point client/provider split. The relay then
   calls `resolveDispute(contractId, disputedAmount, providerBps)` on Base Sepolia, which pays both
   shares as real USDC to each party's wallet.
9. Once every milestone reaches a terminal state, any unreleased escrow is marked refundable on
   GenLayer and the contract closes as `COMPLETED`; the relay calls `refund(contractId, reason)` on
   Base Sepolia to actually return the remaining USDC to the client's wallet.
10. Either party can `cancel_contract` before or shortly after funding (see the state-machine guard in
    the contract); any already-locked escrow is refunded the same way, via the relay calling `refund`
    on Base Sepolia.

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

## Payments: Base Sepolia USDC escrow + relay

The payment layer lives entirely off GenLayer now, on Base Sepolia, in real USDC.

- **`DeliveraEscrow.sol`** (`contracts/base/contracts/DeliveraEscrow.sol`), deployed at
  `0x604919F0AB7d0DEdc74102d36C83bB5078714383`, holds the USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`
  on Base Sepolia) for every contract. Its functions:
  - `fundEscrow(contractId, freelancer, amount)` — called **directly by the client's own wallet** from
    the frontend (an ERC20 `approve` followed by this call — see `fundEscrowOnChain` in
    `frontend/src/lib/escrow.ts`), not by the backend.
  - `releaseMilestone(contractId, amount)`, `refund(contractId, reason)`, and
    `resolveDispute(contractId, disputedAmount, providerBps)` — all three are relayer-only (gated to a
    backend-controlled key) and exist only to mirror a decision GenLayer already made.
  - The `bytes32 contractId` used everywhere is `ethers.id(chainContractId)` — the same hash computed
    identically in `backend/src/services/baseSepolia.ts` and `frontend/src/lib/escrow.ts`, so the two
    sides always agree on which escrow a call refers to.
- **The relay** (`backend/src/jobs/relay.ts`) polls Postgres every 30 seconds for GenLayer decisions
  not yet relayed — `APPROVED` milestones, `CANCELLED`/completed-contract refunds, `RESOLVED`
  disputes — and calls the matching `DeliveraEscrow.sol` function via
  `backend/src/services/baseSepolia.ts` (ethers v6), signed by a dedicated relayer private key that is
  **not** the same key as any user's GenLayer custodial wallet. Idempotency is just a stored
  `relayTxHash` / `refundRelayTxHash` column per row — once set, that decision is never relayed again,
  so the poll can safely re-scan "not yet relayed" rows on every tick with no separate locking.
- **Unit convention (read this before touching amounts):** every ledger amount (`totalAtto`,
  `amountAtto`, etc.) is stored as an 18-decimal, dollar-equivalent value — a `$100` milestone is
  `100 * 10^18`, using the same naming/scale GenLayer's native-GEN accounting used, even though no GEN
  is involved anymore (see `dollarsToAtto` in `frontend/src/app/dashboard/new/page.tsx`). When the
  relay actually pays out, it rescales ÷ `10^12` into 6-decimal USDC base units, because that's what
  USDC and the escrow contract use. The frontend keeps these separate on purpose:
  `formatContractAmount` in `frontend/src/lib/api.ts` renders the 18-decimal ledger value, while
  `formatUsdc` renders a raw 6-decimal on-chain USDC amount — using the wrong one displays a number
  roughly `10^12`× too large or too small.
- **Funding is verified, not trusted.** `POST /api/v1/contracts/:id/fund` requires the tx hash from
  the client's own `fundEscrow` call and independently checks a matching `EscrowFunded` event
  (contract id, freelancer address, amount) via `verifyEscrowFunded` before marking the contract
  `FUNDED` — hitting the endpoint without a real on-chain deposit does nothing.
- **Network switching:** before any on-chain escrow write, `ensureBaseSepolia()`
  (`frontend/src/lib/escrow.ts`) forces the connected wallet onto Base Sepolia (chain id `84532`),
  since a wallet the user has manually pointed elsewhere will otherwise still try to sign there.

## Wallets (two separate ones)

This is the single most important thing to get right about the current architecture: **the wallet a
user logs in with and the wallet GenLayer signs with are two different wallets, for two different
purposes.**

- **Login / funding wallet — the user's own.** The user connects an external wallet (MetaMask, etc.)
  via Reown AppKit (`frontend/src/lib/appkit.ts`). This wallet signs the SIWE-style login message (see
  [REST API surface](#rest-api-surface)) *and* is the wallet that sends the real Base Sepolia USDC
  transactions — funding escrow, receiving a milestone payout, receiving a refund. Delivera never
  holds this wallet's key.
- **GenLayer signing wallet — custodial, backend-held, never touches real money.** On a user's first
  sign-in the backend still auto-generates a secp256k1 keypair (ethers.js) purely so it can sign
  GenLayer intelligent-contract calls (`create_contract`, `submit_deliverable`, `approve_milestone`,
  etc.) on that user's behalf — GenLayer transactions need a signer, and requiring every user to sign
  every GenLayer call manually would be a terrible UX for a chain that only ever produces a decision,
  not a payment. This wallet:
  - has its private key encrypted at rest with AES-256-GCM, the data key derived per-user via scrypt
    from `WALLET_MASTER_KEY` plus a random per-user salt (ciphertext, salt, and IV all in Postgres);
  - is exportable, but only after the user re-authenticates by signing a fresh one-time message with
    their *login* wallet (there's no password to re-check anymore — see
    `GET/POST /api/v1/wallet/export{/nonce,}` in `backend/src/routes/wallet.ts`), and the export is
    audit-logged;
  - now that escrow lives in USDC on Base Sepolia, never holds or moves anything of real value — its
    on-chain GenLayer "balance" is vestigial bookkeeping, not spendable funds.
- Every GenLayer contract write is signed server-side with the calling user's custodial wallet via
  `genlayer-js`; every Base Sepolia escrow write that a user initiates (funding) is signed client-side
  by their own connected wallet; every Base Sepolia escrow write the relay initiates (release/refund/
  dispute payout) is signed by a third, separate relayer key that belongs to neither wallet above.

## Frontend

Next.js 15 (App Router) + Tailwind, built against an "Architectural Trust" design system: Hanken
Grotesk/Inter/JetBrains Mono, an indigo primary, Material Symbols icons, and a custom shield-check
logo/favicon. Every design-system color is a CSS variable that flips under `.dark`, so dark mode
themes correctly everywhere rather than requiring per-page patches. Wallet connection runs through
Reown AppKit (`frontend/src/lib/appkit.ts`); `frontend/src/lib/escrow.ts` handles the direct on-chain
USDC calls (network switching, `approve` + `fundEscrow`). Pages: landing, auth (a single wallet-connect
login page — no register/forgot-password/reset-password/verify-email pages anymore, since there's
nothing to register with besides a wallet), dashboard (contracts list with live escrow/active/completed
stats), the milestone-builder contract wizard, the contract detail page (lifecycle actions, full
submission history, AI verdicts, disputes, on-chain funding), wallet (shows both the connected login
wallet and the custodial GenLayer wallet), and notifications.

## REST API surface

Base path `/api/v1`, JSON only, `Authorization: Bearer <access JWT>` + an httpOnly refresh cookie.
Errors are a uniform `{ "error": { "code", "message", "details?" } }` envelope. Full reference:
[docs/API.md](docs/API.md).

| Area | Endpoints |
|---|---|
| Auth | `GET /auth/nonce?address=` (issues a nonce + SIWE message to sign), `POST /auth/verify` (`{address, signature}`, recovers the signer and issues the session), refresh, logout, me |
| Wallet | view address + GenLayer balance, one-time custodial-key export (gated on signing a fresh message with the login wallet, not a password) |
| Contracts | create (accepts `providerEmail` **or** `providerWalletAddress`), list, detail (chain state Redis-cached), fund (verifies an on-chain `EscrowFunded` event against a client-supplied tx hash), accept, cancel |
| Milestones | submit deliverable, trigger AI verification, manual approve |
| Disputes | raise, add statement, resolve |
| Evaluations | full on-chain evaluation/consensus audit trail per contract |
| Misc | projects CRUD, notifications, reviews, file attachments (Tigris S3) |

There is no more email/password auth surface at all: no `register`, `verify-email`,
`forgot-password`, or `reset-password` endpoints, and no `deposit`/`withdraw` funds endpoints — funding
now happens by the client calling `fundEscrow` on-chain themselves and posting the resulting tx hash to
`fund`.

Rate limits (Upstash Redis, sliding/fixed window): 5 req/15min on auth endpoints, 20 req/60s on
chain-write endpoints per user/IP — chain writes are naturally slow (they block on validator
consensus), so this rarely bites real usage.

## Data model

PostgreSQL via Prisma mirrors on-chain state for fast reads/search; GenLayer remains the source of
truth for *decisions* (verification verdicts, dispute splits) and `DeliveraEscrow.sol` on Base Sepolia
remains the source of truth for *funds*. Tables cover users (identified by wallet address, with email
now optional), custodial GenLayer wallets, sessions, contracts/milestones/deliverables mirrors —
including the `relayTxHash`/`refundRelayTxHash` columns the relay uses for idempotency — AI evaluation +
consensus records, on-chain transaction audit log, disputes, reviews, attachments, notifications, and a
security audit log. The `EmailToken` model and its `TokenPurpose` enum have been removed entirely along
with the email-verification/password-reset flows they backed. Full schema, constraints, and indexes:
[docs/DATABASE.md](docs/DATABASE.md).

## Repository layout

```
contracts/delivera.py         Intelligent contract (GenLayer StudioNet) — adjudication only, moves no value
contracts/base/contracts/     DeliveraEscrow.sol — real USDC custody, Base Sepolia
backend/                      Fastify API, Prisma schema + migrations, tests
  src/lib/                    genlayer.ts (GenLayer chain client), crypto.ts (custodial wallet encryption),
                              email.ts (Brevo, best-effort notify only), redis.ts, s3.ts, audit.ts
  src/services/baseSepolia.ts ethers v6 client for DeliveraEscrow.sol: releaseMilestone, refund,
                              resolveDispute, verifyEscrowFunded
  src/jobs/relay.ts           Polls GenLayer decisions in Postgres, relays them onto Base Sepolia
  src/routes/                 auth (wallet-signature), wallet, contracts, misc (projects/notifications/reviews/attachments)
  src/plugins/                 auth (JWT), rateLimit (Redis)
frontend/                     Next.js 15 App Router + Tailwind
  src/lib/appkit.ts           Reown AppKit wallet-connect config
  src/lib/escrow.ts           Direct client-side calls to DeliveraEscrow.sol (fundEscrowOnChain, ensureBaseSepolia)
docs/                         ARCHITECTURE.md, DATABASE.md, API.md, DEPLOYMENT.md
MEMORY.md                     Project memory: stack decisions, GenLayer gotchas, deployment state
.github/workflows/ci.yml      Backend typecheck+test, frontend build, contract lint
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

1. Deploy the GenLayer adjudication contract to StudioNet with the `genlayer` CLI (gasless — no
   funding needed): `genlayer deploy --contract contracts/delivera.py`.
2. Deploy `contracts/base/contracts/DeliveraEscrow.sol` to Base Sepolia (it needs a funded relayer
   address and the USDC token address at deploy time).
3. `fly deploy` the backend — app `delivera-api-v2` on Fly.io (the original `delivera-api` name is
   stuck on an inaccessible account, so don't be confused if you see references to it) — with all
   secrets set, including `GENLAYER_CONTRACT_ADDRESS` (step 1), the Base Sepolia escrow address, RPC
   URL, and relayer private key (step 2), `DATABASE_URL` (Fly Postgres), `REDIS_URL` (Upstash),
   `BREVO_API_KEY`, `WALLET_MASTER_KEY` (for the custodial GenLayer wallets), and Tigris S3 credentials.
4. `vercel --prod` the frontend (Vercel project `delivera-frontend`) with `NEXT_PUBLIC_API_URL`
   pointing at the Fly backend and `NEXT_PUBLIC_REOWN_PROJECT_ID` set for wallet connect, then update
   `APP_URL`/`CORS_ORIGINS` on the backend once the final Vercel domain is known and redeploy.
5. Whenever either contract is redeployed, update the matching address secret and `fly deploy` again —
   the backend picks it up on the rolling restart.

`fly.toml` sets `min_machines_running = 1` with `auto_start_machines = true`, so one backend machine is
always up and Fly auto-starts the second on demand if it's idled down — the API doesn't go down between
requests. The relay job (`backend/src/jobs/relay.ts`) runs inside that same backend process on a
30-second poll, so it needs no separate deployment.

## Security highlights

Wallet-signature (SIWE-style) login, no passwords to leak · JWT (15 min) + rotating httpOnly refresh
tokens · per-user AES-256-GCM custodial-wallet encryption (scrypt-derived keys) for the GenLayer signing
wallet · one-time, signature-gated, audited custodial-key export · on-chain `EscrowFunded` event
verification before trusting any funding claim · a relayer key kept separate from every user's
custodial wallet, so a compromised user wallet can never authorize a payout · Redis rate limiting · zod
validation on every route · uniform error envelope · audit log for auth/wallet/contract actions ·
secrets only in Fly/Vercel, never committed.

## Known gotchas / lessons from getting this on-chain

A few GenVM/genlayer-js behaviors that aren't obvious from the docs, kept here so they don't get
re-discovered the hard way. Note that the value-transfer specifics below describe the *earlier*
version of this contract, when GenLayer itself moved real native GEN on every payout — that's no
longer how payments work (see [Payments](#payments-base-sepolia-usdc-escrow--relay)), but the
underlying GenVM/genlayer-js behaviors (storage containers, `sender_address`, decoding a write
transaction's result, `ACCEPTED` vs `FINALIZED`) are still true today and still apply to every
GenLayer call this system makes, including the ones that now only decide an outcome instead of paying
it out:

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

## Known limitations

- **No timeout/recovery exit yet.** If a party goes silent mid-milestone (submitted but never
  verified, or disputed but never resolved), there's currently no forced exit that lets the other
  party reclaim escrow after a waiting period — `cancel_contract` only covers the pre-work states.
  GenVM has no deterministic wall-clock time source inside consensus execution, so this needs a
  proxy (e.g. an action-sequence-based window) rather than real time, and hasn't been built yet.
- **A GenLayer decision and its Base Sepolia payout are not atomic.** Between a milestone being marked
  `APPROVED` in Postgres and the relay's next 30-second poll actually calling `releaseMilestone`, the
  decision exists without its payout — no funds are at risk (they're still sitting in
  `DeliveraEscrow.sol` until the relay acts), but a crashed relay process would leave decisions
  un-relayed until it restarts and resumes the poll. There's no separate alerting yet if a row stays
  un-relayed for an unexpectedly long time.
- **The relayer key is a single point of failure for payouts specifically** (not for adjudication,
  which still requires GenLayer validator consensus): if it's compromised, an attacker could call
  `releaseMilestone`/`refund`/`resolveDispute` for arbitrary amounts within a contract's funded
  balance. It is deliberately kept separate from every user's custodial GenLayer wallet so that
  compromising one user's account can't reach it.
