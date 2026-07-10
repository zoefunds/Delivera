# Delivera — Project Memory

Living log of key decisions, gotchas and state. Update as the project evolves.

## Stack decisions (2026-07-10)
- Backend: Node 22 + Fastify + Prisma + PostgreSQL on Fly.io; Upstash Redis for cache/rate limits.
- Auth: email + password (Argon2id) with auto-generated **custodial GenLayer wallet** per user —
  private key AES-256-GCM encrypted (scrypt from `WALLET_MASTER_KEY` + per-user salt), stored in
  Postgres, exportable once per reveal with password re-auth + audit log.
- Email: Brevo (verification, password reset, contract notifications). Sender: preciousmofeoluwa@gmail.com.
- Storage: Fly Tigris (S3-compatible) for attachments.
- Frontend: Next.js 15 App Router + Tailwind, dark mode, deployed to Vercel.
- Contract: single 1,200+ line `DeliveraEscrow` in `contracts/delivera.py`, StudioNet (gasless).

## GenLayer gotchas learned the hard way
- **Pin the runner hash** — `py-genlayer:test`/`latest` are rejected by all networks. Current pin:
  `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` (a newer runner exists:
  `1zr6nqk597d97kg0dyxg0shhrykx5v02zjgnyrajapy4wlqvfvwh`).
- **`gl.message.sender_address`**, NOT `sender_account` — the latter crashed the constructor on
  StudioNet (AttributeError) even though some docs show it. Fixed 2026-07-10.
- Storage fields are class-level annotations; `dict`/`list` are not storable — use
  `TreeMap`/`DynArray`, JSON-string blobs for nested records; money is atto-scale `u256`.
- Linter requires all contract methods to take `self` (no `@staticmethod`).
- Validators must verify substance (re-fetch evidence + re-run LLM + compare decision fields with
  tolerance), never just check the leader's output format — reviewer requirement and consensus
  requirement. Tolerances: score ±20, borderline band ±12 around threshold 70, evidence
  reachability must match exactly. Splits: ±1500 bps + same side of 50/50.
- StudioNet: gasless (0 GEN fine), rate-limited 60 req/min per IP, max 32 pending txs per sender.
- genlayer-js: must be **v1.x** (`^1.1.8`) for `studionet` chain export; v0.7 only had
  localnet/simulator.
- No wall-clock time in deterministic code — contract uses a monotonic `action_seq` counter;
  cancellation/dispute rules are state-based, not deadline-based.

## Review-team constraints (grant submission)
- One serious project; no thin demos. No "AI app with GenLayer attached" — consensus must gate a
  real settlement (here: escrow release). Validators must check real outcomes via contract-side web
  fetch, not output format or user-submitted claims. Full repo must be submitted. Avoid
  UNDETERMINED consensus (hence tolerance-band validator design).

## Deployment state
- GitHub: https://github.com/zoefunds/Delivera (no Claude attribution in commits — user requirement).
- Contract: first deploy attempt errored (sender_account bug), fixed; awaiting user's redeploy +
  contract address → set `GENLAYER_CONTRACT_ADDRESS` on Fly and redeploy backend.
- Fly app: `delivera-api` (fly.toml) · Frontend: Vercel project in `frontend/`.
- Secrets (Brevo key, Upstash Redis URL, JWT/WALLET keys) go in Fly secrets only — never in git.
  Brevo key was shared in plaintext during setup; rotate it after launch.

## Open items
- [x] Contract redeployed to StudioNet after the `sender_address` fix:
      `GENLAYER_CONTRACT_ADDRESS=0xa6f7F1d08D319AC62aD45222B5B324cAC9cDf1dA`
- [ ] Rotate Brevo API key after launch.
- [ ] Consider upgrading pinned runner hash after testing on the newer GenVM.
