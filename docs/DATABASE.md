# Delivera — Database Design (PostgreSQL via Prisma)

Chain state (escrow balances, milestone verdicts, consensus records) lives on the intelligent contract; Postgres stores identity, off-chain metadata, and an indexed mirror of chain events for fast UX.

## Entities

| Table | Purpose | Key columns |
|---|---|---|
| users | Accounts | id (uuid), email (unique, citext), password_hash (argon2id), name, role (CLIENT/PROVIDER/BOTH/ADMIN), email_verified_at |
| wallets | Custodial wallets, 1:1 users | address (unique), encrypted_private_key, kdf_salt, iv, exported_at |
| sessions | Refresh tokens | token_hash (unique), user_id, expires_at, revoked_at, ip, user_agent |
| email_tokens | Verification + password reset | token_hash, purpose, expires_at, used_at |
| projects | Grouping container | owner_id, title, description, status |
| contracts | Mirror of on-chain contracts | chain_contract_id (unique), project_id, client_id, provider_id, title, total_atto (numeric(78,0)), status, dispute fields, tx hashes |
| milestones | Mirror | contract_id, index, title, acceptance_criteria, evidence_type, amount_atto, status, attempts |
| deliverables | Submission records | milestone_id, submitter_id, evidence_urls (jsonb), notes, attempt |
| ai_evaluations | Verdict mirror | deliverable_id, verdict, score, criteria_met (jsonb), reasoning, consensus_round |
| validator_decisions | Per-validator info surfaced by chain | evaluation_id, validator_label, agreed, detail (jsonb) |
| consensus_records | Final consensus outcome per evaluation | evaluation_id, outcome, appealed, finalized_at |
| transactions | On-chain tx audit | user_id, contract_id, kind, tx_hash, status, payload (jsonb) |
| escrows | Funding mirror | contract_id, funded_atto, released_atto, refunded_atto |
| disputes | Dispute mirror | contract_id, raised_by, reason, client_evidence, provider_evidence, resolution, split_bps |
| reviews | Post-completion ratings | contract_id, reviewer_id, reviewee_id, rating (1-5), comment |
| attachments | Tigris S3 files | owner_id, milestone_id?, s3_key, filename, mime, size |
| notifications | In-app + email log | user_id, type, title, body, read_at, emailed_at |
| audit_logs | Security audit trail | user_id?, action, ip, user_agent, detail (jsonb) |
| api_keys | Programmatic access | user_id, key_hash, label, last_used_at, revoked_at |

## Constraints & Indexes

- FKs on every relation with `onDelete` rules (cascade for owned data, restrict for financial mirrors).
- `numeric(78,0)` for all atto amounts (u256-safe).
- Unique: users.email, wallets.address, wallets.user_id, contracts.chain_contract_id, (milestones.contract_id, index), sessions.token_hash, api_keys.key_hash.
- Indexes: contracts(client_id), contracts(provider_id), contracts(status), milestones(contract_id), deliverables(milestone_id), notifications(user_id, read_at), audit_logs(user_id, created_at), transactions(tx_hash), email_tokens(token_hash).
- created_at/updated_at on all tables.

## Migration strategy

Prisma Migrate: `prisma migrate dev` locally, `prisma migrate deploy` on Fly release command. Schema is the single source of truth; never edit the DB by hand.
