# Delivera v1 Milestone: Wallet-Native, Dual-Chain Escrow

This document records the architecture migration and bug-fix work completed in this
milestone: moving Delivera from custodial, email/password-based accounts on a
single native-GEN chain to a wallet-native system where users sign every
transaction themselves, with real payment secured in USDC on Base Sepolia and
adjudication (AI verification, dispute arbitration) remaining on GenLayer
StudioNet.

## 1. Authentication: wallet-signature (SIWE) login, no email/password

- Removed email/password registration and login entirely, including the
  `forgot-password`, `reset-password`, and `verify-email` pages and the
  backend's `EmailToken` table (`TokenPurpose` enum) that supported them.
- Login is now: `GET /api/v1/auth/nonce?address=0x...` issues a nonce and a
  full SIWE-style message; the frontend has the connected wallet sign that
  exact message (`ethers` `signer.signMessage`); `POST /api/v1/auth/verify`
  recovers the signer via `ethers.verifyMessage` and issues the existing
  JWT/refresh-cookie session. A wallet address seen for the first time
  auto-creates the account.
- Email is now optional and unused for authentication — an account only gets
  emailed at all if it happens to have one on file, purely for notifications.

## 2. Wallet connection: Reown AppKit

- Added `@reown/appkit` + `@reown/appkit-adapter-ethers`, configured with
  project ID `c899692e49883030daba3ad14aa97388`.
- Registered **two** networks in the AppKit config: Base Sepolia (chain
  84532) and GenLayer StudioNet (chain 61999, pulled from `genlayer-js/chains`
  so the RPC/name/currency stay authoritative). AppKit only offers networks it
  has been told about for its own "Switch Network" dialog — StudioNet had to
  be explicitly registered for that dialog to ever show it.
- Disabled Coinbase Wallet and "Base Account" (Coinbase's passkey-based
  ERC-4337 smart wallet), which are enabled by default in the ethers adapter.
  Delivera needs a plain externally-owned account signing directly, not a
  smart-contract wallet.

## 3. Payment layer moved off GenLayer, onto Base Sepolia in USDC

GenLayer's intelligent contract (`contracts/delivera.py`) no longer custodies
or moves any value:
- `_send_gen` (the single native-GEN payout function) is now a documented
  no-op.
- `deposit()` and `withdraw()` are disabled outright (they used to move real
  GEN into/out of an internal ledger; leaving them live would have let GEN
  get permanently trapped once `_send_gen` stopped moving it).
- `fund_escrow` no longer debits a GEN balance — it's now purely a status
  flag the relay flips once it has confirmed the client actually deposited
  USDC on Base.
- All milestone-verification and dispute-arbitration logic (AI consensus,
  scoring, arbitration) is unchanged — GenLayer still decides every outcome,
  it just no longer moves money.

A new Solidity contract, **`DeliveraEscrow.sol`**, deployed on Base Sepolia at
**`0x604919F0AB7d0DEdc74102d36C83bB5078714383`**, holds the real USDC (token
at **`0x036CbD53842c5426634e7929541eC2318f3dCF7e`**):
- `fundEscrow(contractId, freelancer, amount)` — called directly by the
  client's own wallet (approve + fund, two wallet-signed transactions).
- `releaseMilestone(contractId, amount)`, `refund(contractId, reason)`,
  `resolveDispute(contractId, disputedAmount, providerBps)` — relayer-only,
  mirror GenLayer's decisions.
- The `bytes32` contract id is `ethers.id(chainContractId)`, computed
  identically on both backend and frontend.
- 8 Hardhat tests cover fund/release/refund/dispute-split/double-release
  protection; all passing.

A backend relay job (`backend/src/jobs/relay.ts`) polls every 30 seconds for
GenLayer decisions not yet relayed (approved milestones, cancelled contracts,
resolved disputes) and executes the matching call on `DeliveraEscrow.sol`,
signed by a dedicated relayer key (**`0xd07E3D1bAF59F1c09e2F8842786D89B716915f3E`**)
— a different key from any user's wallet and from the contract deployer
(**`0x7401c129EDfc26E68FE19309fE461eb3Db1058Eb`**). Idempotency is a stored
`relayTxHash` / `refundRelayTxHash` column per row.

Funding is verified, not trusted: `POST /api/v1/contracts/:id/fund` requires
the client to have already called `fundEscrow` themselves and pass the
resulting tx hash; the backend verifies a matching `EscrowFunded` event
(contract id, freelancer address, amount) before mirroring the contract as
FUNDED.

## 4. Users sign every GenLayer transaction themselves

The custodial GenLayer signing wallet (auto-generated and encrypted per user
on signup) has been removed entirely, along with its `Wallet` Prisma model,
`backend/src/lib/crypto.ts`, and the `WALLET_MASTER_KEY` config. The same
wallet a user connects for login and Base Sepolia funding is now also their
GenLayer identity — one wallet, not two.

- `frontend/src/lib/genlayer.ts` signs `create_contract`, `fund_escrow`,
  `accept_contract`, `cancel_contract`, `submit_deliverable`,
  `verify_deliverable`, `approve_milestone`, `raise_dispute`,
  `add_dispute_statement`, and `resolve_dispute` directly with the connected
  wallet via `genlayer-js`, switching the wallet to GenLayer StudioNet first.
- The backend no longer signs anything. Every route that used to write on a
  user's behalf now re-reads GenLayer's actual on-chain state (polling with
  retry, since a read immediately after a write can lag behind consensus)
  to confirm the expected transition happened, then mirrors it into
  Postgres. No route holds or uses a user's private key.
- Contract creation needed one extra step: a browser can't decode a GenLayer
  write receipt (Studio's API blocks that from a browser via CORS), so the
  new contract's id is discovered by polling `list_contracts_by_party` for
  the newest matching draft between the two parties, rather than reading it
  back directly.
- Provider invites now accept a wallet address as an alternative to email
  (`POST /api/v1/contracts/confirm-create` takes `providerWalletAddress` or
  `providerEmail`; a new `GET /api/v1/contracts/resolve-provider?email=`
  resolves an email to a wallet address client-side before signing).

## 5. Backend redeployment

The original Fly.io app and account hosting Delivera's backend became
inaccessible. A new backend was stood up from scratch on the current Fly.io
account:
- App: **`delivera-api-v2`** (the original `delivera-api` name is
  permanently held by the inaccessible account).
- Fresh Postgres (`delivera-db-v2`), Tigris S3 storage, and the user's own
  Upstash Redis instance, all wired via `fly secrets`.
- `frontend/.env.example` / the deployed Vercel `NEXT_PUBLIC_API_URL` point
  at the new backend.

## 6. Bugs found and fixed during this migration

Several of these were only discoverable by exercising the real, deployed
system end-to-end — not from code review alone.

- **SIWE signature mismatch**: the frontend was signing the bare nonce
  string instead of the full SIWE message the backend expected signed,
  so every login failed. Fixed to sign the actual `message` field.
- **Non-deterministic SIWE message reconstruction**: the backend's
  `siweMessage()` embeds a live "Issued At" timestamp, but was being
  recomputed with a *new* timestamp at verify time instead of reusing the
  one actually issued — so the reconstructed message could never match what
  was signed. Fixed by persisting the exact issued message in Redis and
  reusing it verbatim at verify time.
- **Cross-origin session refresh silently broken**: the frontend
  (`vercel.app`) and backend (`fly.dev`) are different origins, but the
  refresh-token cookie was `SameSite=Lax`, which browsers never send on
  cross-site fetch/XHR requests. The app's silent-refresh-on-401 logic could
  therefore never actually refresh a session in production; once the
  15-minute access token expired, every request failed with "Invalid or
  expired token" and no recovery. Fixed to `SameSite=None; Secure` in
  production.
- **Duplicate route registration crash**: two independently-written
  `POST /confirm-create` handlers ended up in the same file, crashing the
  server on boot (`FST_ERR_DUPLICATED_ROUTE`). Removed the redundant one.
- **No-retry read in contract-creation confirmation**: `confirm-create`
  did a single, immediate on-chain read right after the client's wallet
  submitted `create_contract`, which almost always ran before GenLayer
  reached consensus on the new contract, failing with "could not find the
  on-chain contract." Fixed to poll with retries (same pattern used
  elsewhere in the confirm flow).
- **Missing GenLayer `fund_escrow` call**: after the custodial-signing
  removal, nothing was calling GenLayer's own `fund_escrow` (a status-only
  mirror) before hitting the backend's `/fund` confirm route, which polls
  for exactly that GenLayer status change — it would have polled forever.
  Added the missing call to the funding flow.
- **False-positive "wrong destination" transaction check**: after an
  earlier funding report where a transaction appeared to go to an unrelated
  address, a strict check was added comparing a transaction's outer `to`
  field against the exact contract address requested. This produced false
  positives for wallets that route transactions through their own relay
  infrastructure (e.g. MetaMask's transaction-relay feature) — the outer
  `to` is the relay, not the target, even though the real effect (verified
  directly against Base Sepolia's RPC: the correct `Transfer` and
  `EscrowFunded` events firing with the correct parties and amount) happens
  correctly. Removed the outer-`to` check on both frontend and backend;
  verification now relies on the actual emitted event, which is what the
  code already used as the authoritative check.
- **Relay refund/dispute amounts computed from Postgres instead of
  on-chain state**: the relay computed how much to refund or split from
  Postgres's `fundedAtto - releasedAtto - refundedAtto` bookkeeping. When a
  `/fund` confirmation failed for an unrelated reason (e.g. the session-
  refresh bug above) after the real on-chain deposit had already succeeded,
  Postgres never learned the contract was funded — so a later cancellation
  computed "nothing to refund" while real USDC sat locked in escrow.
  Verified directly on-chain: two test contracts had 1 USDC each genuinely
  stuck after cancellation, and two more were marked DRAFT despite being
  genuinely FUNDED on-chain. Fixed the relay to read the escrow contract's
  own `remainingEscrow` as the source of truth instead of trusting the
  Postgres mirror; corrected the drifted rows; the relayer then
  successfully refunded both stuck contracts (verified on-chain,
  `remainingEscrow` back to 0 for both).
- **Relayer wallet had no gas**: separately from the above, the relayer's
  Base Sepolia wallet had never been funded with ETH, so it could not have
  executed *any* payout regardless of bookkeeping correctness. Funded with
  0.02 test ETH from the contract deployer wallet.
- **Stale UI/copy**: removed leftover references to the old email/password
  flow and native-GEN amounts across the landing page, dashboard, and
  contract-creation form (e.g. "Sign up with email and password," "Amount
  (GEN)," a permanently-stuck "verify your email" banner left over from a
  field the backend no longer returns).

## 7. New / completed UI

- **Payout and refund status**: every milestone, contract cancellation, and
  dispute resolution now shows whether its on-chain payout is still
  processing, has completed (with a direct Basescan link), or had nothing to
  pay out — the relay's payouts are automatic (no "claim" step by design),
  but were previously invisible to users.
- **Review / rating**: the backend already had a complete review endpoint
  (`POST /api/v1/reviews`, `GET /api/v1/reviews/user/:userId`) with no
  frontend for it. Added a star-rating and comment form shown once a
  contract reaches COMPLETED or CANCELLED.
- Amount formatting was split into two distinct functions
  (`formatUsdc` for real 6-decimal on-chain balances, `formatContractAmount`
  for the 18-decimal-scaled ledger values used internally) after finding
  they had been conflated, which would have displayed ledger amounts roughly
  10^12 times too large.

## 8. Known limitations

- The relay sweep runs on a fixed 30-second interval; a payout or refund is
  never instant, though the frontend now reflects "processing" while it
  waits.
- Milestone/contract amounts are stored as an 18-decimal dollar-equivalent
  value (`*Atto` columns, inherited from the original native-GEN accounting
  convention) and rescaled to 6-decimal USDC only when relayed on-chain —
  this unit convention is easy to get wrong if extended without care.
- A wallet whose *active* connected account differs from a contract's
  registered client/provider address (e.g. switched accounts mid-session)
  will have its GenLayer/Base Sepolia writes rejected by the contracts'
  own sender checks; there is no separate application-level guard for this
  today.
