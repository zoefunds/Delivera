# Delivera — REST API (v1)

Base: `/api/v1`. JSON only. Auth: `Authorization: Bearer <access JWT>`; refresh token in httpOnly cookie. Errors: `{ "error": { "code", "message", "details?" } }`. Rate limits (Redis): 100 req/min authed, 20 req/min anon, 5 req/15min for auth endpoints.

## Auth
| Method | Path | Description |
|---|---|---|
| POST | /auth/register | email, password, name, role → creates user + custodial wallet, sends Brevo verification email |
| POST | /auth/verify-email | token → marks verified |
| POST | /auth/login | email, password → access token + refresh cookie |
| POST | /auth/refresh | rotate refresh token |
| POST | /auth/logout | revoke session |
| POST | /auth/forgot-password | email → Brevo reset link (always 200) |
| POST | /auth/reset-password | token, newPassword → revokes all sessions |
| GET | /auth/me | current user + wallet address |

## Wallet
| POST | /wallet/export | password re-auth → one-time private key reveal (audit-logged) |
| GET | /wallet | address + on-chain balances |

## Projects & Contracts
| GET/POST | /projects | list/create |
| GET/PATCH/DELETE | /projects/:id | manage (owner only) |
| POST | /contracts | create on-chain contract (milestones[], provider email or address, criteria) → tx |
| GET | /contracts | list mine (client or provider), filter by status |
| GET | /contracts/:id | full detail incl. chain state (Redis-cached) |
| POST | /contracts/:id/fund | fund escrow |
| POST | /contracts/:id/accept | provider accepts |
| POST | /contracts/:id/cancel | cancel per contract rules |
| POST | /contracts/:id/milestones/:index/submit | evidence_urls[], notes → on-chain submission |
| POST | /contracts/:id/milestones/:index/verify | trigger AI verification tx |
| POST | /contracts/:id/milestones/:index/approve | client manual approve (skips AI) |
| POST | /contracts/:id/disputes | raise dispute with evidence |
| POST | /contracts/:id/disputes/resolve | trigger on-chain AI dispute resolution |
| POST | /contracts/:id/withdraw | provider withdraws released funds |
| GET | /contracts/:id/evaluations | AI evaluation + consensus history |

## Misc
| POST | /attachments (multipart) → Tigris S3, returns signed URL |
| GET/PATCH | /notifications, /notifications/:id/read |
| POST | /reviews | rate counterparty after completion |
| GET | /health, /metrics |

Versioning: URI (`/v1`). Breaking changes → `/v2`. All writes idempotent via optional `Idempotency-Key` header (Redis, 24h).
