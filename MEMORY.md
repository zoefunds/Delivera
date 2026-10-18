# Delivera — Project Memory

Current operational notes; authoritative evidence is in `docs/VERIFICATION.md`.

## Architecture

- Wallet-native SIWE-style authentication; no email/password or user-key custody.
- User wallets sign ordinary GenLayer StudioNet lifecycle actions and fund Base Sepolia escrow directly in USDC.
- GenLayer performs milestone state transitions, independent evidence retrieval, AI verification, consensus comparison, and dispute arbitration; it holds no real funds.
- `DeliveraEscrow.sol` v2 holds USDC. Funding binds agreement id, client, provider, amount, and allocation vector. Settlement requires distinct relayer and decision-authority roles plus exact expiring signatures, allocation checks, deterministic settlement ids, and per-milestone replay protection.
- PostgreSQL is a query/recovery mirror, never the authoritative payment idempotency boundary.

## Current deployments — 2026-10-18

- Frontend: `https://delivera-frontend.vercel.app`
- Production API documented by the frontend: `https://delivera-api-v2.fly.dev`
- GenLayer StudioNet: `0xDa4B86C86010329dbf484a1ccD1BD64396B25cBa`
- GenLayer deployment tx: `0x1690d4f69ee49e842b6f4eeab5fc04a5a8cebfce48401f3cc29354f5615a8190`
- Base Sepolia escrow v2: `0xC7A0AC77AE3058D0a1A8E3874C8e394D0E4a7875`
- Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Remediated source baseline: `6cffd60`

The prior StudioNet address `0xB193…D8F6` remains relevant only for the funded historical cross-chain evidence run documented in `docs/VERIFICATION.md`.

## Current operational blockers

- GitHub Actions is blocked before job startup by an account billing lock. Local CI-equivalent commands pass; the failed run link is in the verification file.
- The live Fly apps are owned by a different Fly account from the locally authenticated CLI account. Their GenLayer and escrow secrets remain stale; update them to the addresses above and redeploy before using the new agreement through the public application.

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
