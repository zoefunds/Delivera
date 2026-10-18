# Delivera — Project Memory

Current operational notes; authoritative evidence is in `docs/VERIFICATION.md`.

## Architecture

- Wallet-native SIWE-style authentication; no email/password or user-key custody.
- User wallets sign ordinary GenLayer StudioNet lifecycle actions and fund Base Sepolia escrow directly in USDC.
- GenLayer performs milestone state transitions, independent evidence retrieval, AI verification, consensus comparison, and dispute arbitration; it holds no real funds.
- `DeliveraEscrow.sol` holds USDC. Funding binds the GenLayer chain, adjudicator address, local agreement id, client, provider, amount, and allocation vector. Settlement requires activation, distinct relayer and decision-authority roles, exact expiring signatures, allocation checks, deterministic settlement ids, and per-milestone replay protection.
- PostgreSQL is a query/recovery mirror, never the authoritative payment idempotency boundary.

## Current deployments — 2026-10-18

- Frontend: `https://delivera-frontend.vercel.app`
- Production API: `https://delivera-api-gideon.fly.dev`
- Fly Postgres: `delivera-db-gideon`; Upstash Redis: `delivera-redis-gideon`
- GenLayer StudioNet: `0xDa4B86C86010329dbf484a1ccD1BD64396B25cBa`
- GenLayer deployment tx: `0x1690d4f69ee49e842b6f4eeab5fc04a5a8cebfce48401f3cc29354f5615a8190`
- Base Sepolia escrow: `0x2bA36CD29993cf4250adfb48F367E1893dcd43B5`
- Base deployment tx: `0x8af24446291a0efc4fe9641cafdde37cd54e65660e53c0ee4a053c13d9f8b212`
- Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Current application source baseline: `187b5864970c4061a8722fdb0cae92be3df4b21a`
- Current Base relayer: `0x0EaD3C2e53Bf4c47B8875DcC1669E69Deee19d2D`
- Current production frontend deployment: `dpl_G3uwJ844wgzGoEuovn2BFQf15gGt`

The prior StudioNet address `0xB193…D8F6` remains relevant only for the funded historical cross-chain evidence run documented in `docs/VERIFICATION.md`.

## Current operational status

- GitHub Actions is blocked before job startup by an account billing lock. Local CI-equivalent commands pass; the failed run link is in the verification file.
- The canonical Fly API is deployed on the currently authenticated account, reports server/database/Redis healthy, and has both chain integrations configured. The retired `delivera-api` and `delivera-api-v2` apps are not used by the frontend.
- Transactional email is disabled until a valid Brevo API key and verified sender are supplied; in-app notifications work.
- Production intentionally runs one always-on API machine so only one in-process relay scheduler executes.

## Consensus and lifecycle rules

- Approval/non-approval must match exactly between leader and validator.
- Arbitration is quantized to 500-bps buckets and validators must agree on the exact payable bucket.
- Post-payment disputes are unsupported. `raise_dispute` rejects `APPROVED` and every milestone whose `settled_atto` is non-zero, preventing repeat arbitration from freezing or spending another milestone.
- Every wallet-submitted GenLayer transition must be `FINALIZED` before its database mirror or Base settlement becomes eligible.

## Tooling notes

- Runner pin: `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`.
- Use `gl.message.sender_address`; `sender_account` fails on StudioNet.
- Nested contract records are JSON strings in `DynArray[str]`; storage indexes use `TreeMap`.
- StudioNet is gasless but rate-limited. `genlayer-js` v1.x is required.
- Temporary deployment account `delivera-throwaway` was removed after deployment; `anchor-deploy` is restored as the active CLI alias.
- The New Contract page has a production-tested detailed autofill using a registered test provider, a unique title, and three objective milestones. It creates a real StudioNet draft; funding remains separate.
- Current-pair funded evidence: `delivera-4` used scoped Base key `0xe916b54ef77d1b1a19b964ace4b09f091d0345c53dbf84480e4fc5cebb33a308`, settled 0.24 USDC to the provider and returned 0.12 USDC to the client, with zero remaining escrow. Exact receipts are in `docs/VERIFICATION.md`.
