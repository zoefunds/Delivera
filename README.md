# Delivera — Performance-Based Contracting on GenLayer

Payments locked in on-chain escrow, released only when **GenLayer validator consensus** verifies —
against live evidence — that the agreed work was actually delivered.

Clients define milestones with concrete acceptance criteria and fund escrow. Providers submit
URL-addressable evidence (live sites, GitHub repos, APIs, documents). During consensus, **every
validator independently fetches the evidence with contract-side web access and runs its own AI
evaluation**; funds move only when they agree. Disagreements go to AI arbitration with basis-point
split settlement. No party — including the platform — can decide payouts alone.

## Why this needs GenLayer

"Did this deliverable meet the criteria, so should escrow release?" is a subjective judgment that
directly moves funds. A single off-chain LLM would make whoever runs the server the judge. Here the
judgment is a consensus state transition: leader proposes, validators re-fetch evidence and re-run
the evaluation independently, and tolerance-banded comparison (approve gate + score band + evidence
reachability) makes honest subjectivity converge while catching a dishonest leader. The contract
never resolves anything from user-submitted text alone — evidence is always re-fetched on-chain.

## Architecture

| Layer | Tech | Where |
|---|---|---|
| Intelligent Contract | Python (genlayer-py-std), 1,200+ lines, single contract | GenLayer StudioNet |
| Backend API | Node 22, Fastify, Prisma, PostgreSQL, Upstash Redis, Brevo, Tigris S3 | Fly.io |
| Frontend | Next.js 15 (App Router), Tailwind, dark mode | Vercel |
| Wallets | Custodial secp256k1, AES-256-GCM encrypted at rest, exportable | Postgres |

```
Next.js (Vercel) → Fastify API (Fly.io) → DeliveraEscrow contract (StudioNet)
                    ├ PostgreSQL (Fly)      escrow · milestones · AI verification
                    ├ Redis (Upstash)       validator consensus · disputes · settlement
                    ├ Brevo (email)
                    └ Tigris (S3 files)
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DATABASE.md](docs/DATABASE.md),
[docs/API.md](docs/API.md), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Live deployment

| Component | URL / Address |
|---|---|
| Frontend | https://delivera-frontend.vercel.app |
| Backend API | https://delivera-api.fly.dev (`/health` for status) |
| Intelligent contract | `0x43a9a6a1Aaf96e2F5845919704ce034f789A19c4` on GenLayer StudioNet |

Verified end-to-end with 100+ real on-chain transactions (contract creation, escrow funding,
deliverable submission, AI verification with live web-fetch evidence, and dispute resolution) — both
AI-approved and AI-rejected-then-disputed outcomes occurred as genuine validator-consensus decisions,
not scripted results.

## The intelligent contract (`contracts/delivera.py`)

One production contract, `DeliveraEscrow` — 23 public methods (9 view / 14 write):

- **Escrow ledger**: atto-scale `u256` internal balances; `deposit`, `fund_escrow`, `withdraw`.
- **Lifecycle**: `create_contract` (milestones + criteria + evidence type), `accept_contract`,
  `cancel_contract` with strict state-machine guards.
- **Verification**: `submit_deliverable` (URLs only), `verify_deliverable` — leader and validators
  each web-fetch the evidence and LLM-score it against the criteria; a custom validator function
  compares approve-gate, score tolerance (±20), borderline band (±12 around threshold 70) and
  evidence reachability, so results settle instead of going UNDETERMINED without ever trusting the
  leader's output alone.
- **Disputes**: `raise_dispute`, `add_dispute_statement`, `resolve_dispute` — consensus AI
  arbitration awarding a basis-point split, settled immediately.
- **Resilience**: classified errors (`[EXPECTED]/[EXTERNAL]/[TRANSIENT]/[LLM_ERROR]`), defensive
  LLM JSON parsing with key aliasing, bounded resubmissions, O(1) stat indexes.

Lint: `genvm-lint check contracts/delivera.py` → passes (pinned runner hash).

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

Full guide in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Summary: deploy the contract to StudioNet
with the `genlayer` CLI (gasless), `fly deploy` the backend with secrets set, `vercel --prod` the
frontend, then set `GENLAYER_CONTRACT_ADDRESS` and redeploy the backend.

## Security highlights

Argon2id passwords · JWT (15 min) + rotating httpOnly refresh tokens · per-user AES-256-GCM wallet
encryption (scrypt-derived keys) · one-time audited key export · Redis rate limiting · zod
validation on every route · uniform error envelope · audit log · secrets only in Fly/Vercel.
