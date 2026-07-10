# Delivera — Architecture

## Product Vision

Delivera is a performance-based contracting platform. Clients lock payment in on-chain escrow; freelancers/agencies submit deliverables; a GenLayer Intelligent Contract — not either party — decides whether the agreed acceptance criteria were met, using AI evaluation executed independently by multiple validators under Optimistic Democracy consensus. Funds release only on verified delivery.

Why this needs GenLayer (and not just an AI backend): the settlement decision — "did the work meet the criteria, so should escrow release?" — is a subjective judgment that directly moves funds. A single off-chain LLM answer would let whoever runs the server decide payouts. GenLayer validators each independently fetch the evidence (live website, GitHub repo, API endpoint, document), run their own AI evaluation, and must agree before the state transition (fund release / rejection / dispute resolution) happens. The contract verifies actual outcomes against real evidence via contract-side web access, never user-submitted claims alone.

## Personas

- **Client** — funds escrow, defines milestones + acceptance criteria, can dispute.
- **Provider** (freelancer/agency/DAO contributor) — accepts contract, submits deliverables (URLs to live evidence), can resubmit after rejection.
- **Platform** — never touches funds; provides UX, indexing, notifications.

## System Overview

```
┌──────────────┐     HTTPS      ┌──────────────────┐
│  Next.js app │ ─────────────▶ │  Fastify API      │
│  (Vercel)    │                │  (Fly.io)         │
└──────────────┘                │  ├─ Postgres (Fly)│
                                │  ├─ Redis (Upstash)
                                │  ├─ Tigris S3     │
                                │  └─ Brevo (email) │
                                └───────┬──────────┘
                                        │ genlayer-js (custodial wallets)
                                        ▼
                        ┌────────────────────────────┐
                        │ Delivera Intelligent        │
                        │ Contract (GenLayer          │
                        │ StudioNet)                  │
                        │ escrow · milestones ·       │
                        │ AI verification (web fetch) │
                        │ validator consensus ·       │
                        │ disputes · settlement       │
                        └────────────────────────────┘
```

Boundary (per GenLayer guidance):
- **Frontend/backend own**: auth, profiles, notifications, file attachments, indexing/caching of chain state, previews.
- **Intelligent contract owns**: escrow balances, milestone state machine, evidence-based AI verification, validator comparison rule, dispute resolution, settlement.
- **External sources own**: the deliverable evidence (live URLs) — validators re-fetch them independently; the contract never trusts submitted text alone.

## Wallet Architecture (custodial)

- On signup the backend generates a secp256k1 keypair (ethers.js).
- Private key encrypted with AES-256-GCM; data key derived per-user via scrypt from `WALLET_MASTER_KEY` + per-user random salt.
- Ciphertext + salt + IV stored in Postgres → survives devices, cache clears, reinstalls.
- Export endpoint requires fresh password re-auth; decrypts and returns key once; audit-logged.
- All contract writes are signed server-side with the user's wallet via genlayer-js.

## Escrow Flow

1. Client creates contract on-chain: milestones, atto-scale amounts, acceptance criteria, evidence type.
2. Client funds escrow (StudioNet: simulated GEN via contract-tracked balances funded by `fund_escrow`).
3. Provider accepts → contract ACTIVE.
4. Provider submits deliverable: evidence URL(s) + notes per milestone.
5. Contract runs AI verification (leader + validators independently fetch evidence and evaluate) → APPROVED / REJECTED / NEEDS_REVISION.
6. APPROVED → milestone amount credited to provider balance; provider withdraws.
7. REJECTED/NEEDS_REVISION → provider may resubmit (bounded retries).
8. Either party may dispute; dispute resolution is another validator-consensus AI evaluation over both parties' evidence; split settlement supported.
9. Client can cancel unstarted work; timeouts allow reclaiming stale escrow.

## Consensus / AI Verification Flow

- Leader validator executes the nondeterministic block: fetches evidence with `gl.nondet.web.get`, runs `gl.nondet.exec_prompt` scoring against acceptance criteria, returns structured verdict {verdict, score, criteria_met, reasoning}.
- Each validator re-executes the same block independently (own web fetch + own LLM) and compares **decision fields with tolerances**: verdict gate must match on approve/not-approve; scores within tolerance band; deterministic evidence facts (HTTP status, domain) must match. Formatting/reasoning text may differ — that's allowed, which prevents UNDETERMINED outcomes without being leader-trusting.
- Errors are classified ([EXPECTED]/[EXTERNAL]/[TRANSIENT]/[LLM_ERROR]) so failure paths also reach consensus.
- Optimistic democracy: result is accepted optimistically, appealable; on appeal more validators re-evaluate.

## Security

- Argon2id password hashing; JWT access (15m) + rotating refresh tokens (httpOnly).
- Rate limiting (Upstash Redis, per-IP + per-account), CORS allowlist, helmet headers, zod input validation everywhere, Prisma (parameterized SQL).
- Secrets only via Fly/Vercel secrets; never committed.
- Audit log table for auth events, wallet export, contract actions.
- Brevo transactional email for verification, password reset (single-use, 30-min tokens), and contract notifications.

## Deployment

- Frontend → Vercel (`vercel --prod`), env: `NEXT_PUBLIC_API_URL`.
- Backend → Fly.io (`fly deploy`, no Docker builds locally — Fly builds remotely from Dockerfile), Fly Postgres attach, Tigris via `fly storage create`.
- Contract → GenLayer StudioNet via `genlayer` CLI (gasless). After deploy, set `GENLAYER_CONTRACT_ADDRESS` secret and redeploy backend.

## Scaling & Ops

- Stateless API → `fly scale count N`; Postgres read replicas when needed.
- Redis caching of chain reads (contract state polled + cached, TTL 15s).
- pino structured logs → Fly log shipping; /health + /metrics endpoints.
- Backups: Fly Postgres daily snapshots; S3 versioning on Tigris bucket.
- CI: GitHub Actions — lint, typecheck, tests, contract lint on every push.
