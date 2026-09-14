-- Drop EmailToken: dead schema left over from the email/password auth flow,
-- which was fully replaced by wallet-signature (SIWE) auth. Nothing in the
-- codebase writes to or reads from this table anymore.
DROP TABLE IF EXISTS "EmailToken";
DROP TYPE IF EXISTS "TokenPurpose";
