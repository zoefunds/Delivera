# Delivera REST API (v1)

Base path: `/api/v1`. Authentication uses a wallet-signed nonce, a short-lived
bearer JWT, and a rotating httpOnly refresh cookie. Errors use
`{ "error": { "code", "message" } }`.

## Authentication and wallet

| Method | Path | Purpose |
|---|---|---|
| GET | `/auth/nonce?address=0x…` | Obtain a one-time login challenge |
| POST | `/auth/verify` | Verify the wallet signature and create/login the account |
| POST | `/auth/refresh` | Rotate the refresh session |
| POST | `/auth/logout` | Revoke the session |
| GET | `/auth/me` | Current wallet-backed identity |
| GET | `/wallet` | Connected address and live Base Sepolia USDC balance |

There is no email/password registration, password reset, custodial user key,
or wallet-export endpoint in the current architecture.

## Contracts

| Method | Path | Purpose |
|---|---|---|
| GET | `/contracts/resolve-provider` | Resolve an optional provider email to a wallet |
| POST | `/contracts/confirm-create` | Mirror a wallet-signed GenLayer creation |
| GET | `/contracts` | List agreements for the authenticated party |
| GET | `/contracts/:id` | Agreement, milestones, disputes, chain and escrow metadata |
| POST | `/contracts/:id/funding-authorization` | Sign the exact deployment/client/provider/allocation binding and return its escrow key; draft client only |
| POST | `/contracts/:id/fund` | Verify the Base receipt, finalize GenLayer funding, activate Base adjudication, and mirror it |
| POST | `/contracts/:id/accept` | Confirm a provider-signed GenLayer acceptance |
| POST | `/contracts/:id/cancel` | Confirm cancellation; relay later submits the signed exact refund |
| POST | `/contracts/:id/milestones/:index/submit` | Confirm provider evidence submission |
| POST | `/contracts/:id/milestones/:index/verify` | Confirm consensus verification |
| POST | `/contracts/:id/milestones/:index/approve` | Confirm client manual approval |
| POST | `/contracts/:id/disputes` | Confirm an unpaid-milestone dispute |
| POST | `/contracts/:id/disputes/:index/statement` | Confirm a party statement |
| POST | `/contracts/:id/disputes/:index/resolve` | Confirm finalized arbitration |
| GET | `/contracts/:id/evaluations` | GenLayer evaluation/audit history |

Except for the funding-verifier step, lifecycle writes are signed by the
user's connected wallet before these endpoints confirm and mirror them.
Post-payment disputes are intentionally rejected; a paid allocation cannot be
reversed using another milestone's funds.

## Projects, notifications, reviews, and attachments

All routes below require wallet authentication.

| Method | Path | Purpose |
|---|---|---|
| GET | `/projects` | List projects owned by the authenticated user |
| POST | `/projects` | Create a project |
| PATCH | `/projects/:id` | Update an owned project |
| DELETE | `/projects/:id` | Delete an owned project |
| GET | `/notifications` | Return the latest 50 notifications |
| POST | `/notifications/:id/read` | Mark an owned notification read |
| POST | `/reviews` | Create or update a 1–5 rating after completion/cancellation |
| GET | `/reviews/user/:userId` | Read a user's aggregate and individual reviews |
| POST | `/attachments` | Upload an allowed file, when optional object storage is configured |
| GET | `/attachments/:id/url` | Request a signed download URL |

Production currently returns `503 STORAGE_NOT_CONFIGURED` for uploads because
optional S3-compatible attachment storage has not been enabled. Evidence may be
submitted as URLs without this service.

## Service health

`GET /health` is outside `/api/v1` and reports server, PostgreSQL, Redis, and
chain-configuration readiness. It does not require authentication.

## Relay guarantees

The relay derives deterministic settlement ids from the deployment-aware
escrow key, action, and milestone/dispute index. Before retrying a row with no saved tx
hash it checks `processedSettlements` on Base, reconciles an already-executed
instruction, and updates the row plus accounting atomically. Solidity remains
the authoritative replay and allocation boundary.

The escrow key is the ABI-encoded hash of `DELIVERA_AGREEMENT_V1`, GenLayer
chain ID, Intelligent Contract address, and local agreement ID. It is not the
hash of `delivera-N` alone. If a verified Base deposit never reaches finalized
GenLayer confirmation and activation, the client wallet may call
`recoverUnconfirmedFunding` directly after seven days. This method is rejected
forever once activation occurs or any entitlement is consumed.
