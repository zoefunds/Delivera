# Delivera — Deployment Guide

## 1. Intelligent contract → GenLayer StudioNet (gasless, no Docker)

```bash
npm install -g genlayer          # already installed
genlayer network set studionet
genlayer account create --name delivera   # or reuse an existing account
genlayer deploy --contract contracts/delivera.py
```

Constructor takes no arguments. Note the deployed address; verify with:

```bash
genlayer call <ADDRESS> get_platform_stats
```

The deploying GenLayer account is the funding verifier. Store its private
key as `GENLAYER_OWNER_PRIVATE_KEY`; `fund_escrow` rejects direct client calls
and is invoked only after the backend verifies the Base receipt binding.

## 2. Escrow v2 → Base Sepolia

Use separate relayer and decision-authority accounts. The authority signs
finalized instructions but does not submit transactions; the relayer submits
but cannot alter them.

```bash
cd contracts/base
cp .env.example .env
# Set PRIVATE_KEY, BASE_SEPOLIA_RELAYER_ADDRESS, and
# BASE_SEPOLIA_DECISION_AUTHORITY_ADDRESS.
npm ci
npm test
npm run deploy:sepolia
```

Record the printed address together with `git rev-parse HEAD`. Do not reuse
the old v1 escrow address: its ABI and authorization model are incompatible.
Set `DELIVERA_ESCROW_ADDRESS`, `BASE_SEPOLIA_RELAYER_PRIVATE_KEY`, and
`BASE_SEPOLIA_DECISION_AUTHORITY_PRIVATE_KEY` in backend secrets. Confirm the
configured authority address equals the address derived from the authority
private key before accepting funds.

## 3. Backend → Fly.io

```bash
cd backend
fly launch --no-deploy --copy-config --name delivera-api-gideon
fly postgres create --name delivera-db-gideon --region iad --initial-cluster-size 1 \
  --vm-size shared-cpu-1x --volume-size 3
fly postgres attach delivera-db-gideon --app delivera-api-gideon # sets DATABASE_URL
fly redis create --name delivera-redis-gideon --region iad       # record REDIS_URL
# Object storage is optional; configure S3_* only if enabling file uploads.

fly secrets set --app delivera-api-gideon \
  JWT_SECRET="$(openssl rand -hex 32)" \
  REDIS_URL="redis://default:<password>@<host>.upstash.io:6379" \
  BREVO_API_KEY="disabled-no-production-mail-provider" \
  BREVO_SENDER_EMAIL="noreply@delivera.app" \
  APP_URL="https://<your-vercel-domain>" \
  CORS_ORIGINS="https://<your-vercel-domain>" \
  GENLAYER_CONTRACT_ADDRESS="<deployed address>" \
  GENLAYER_OWNER_PRIVATE_KEY="<genlayer deployer key>" \
  DELIVERA_ESCROW_ADDRESS="<current base escrow address>" \
  BASE_SEPOLIA_RELAYER_PRIVATE_KEY="<transport key>" \
  BASE_SEPOLIA_DECISION_AUTHORITY_PRIVATE_KEY="<attestation key>"

fly deploy   # remote build; startup runs prisma migrate deploy
curl https://delivera-api-gideon.fly.dev/health
```

Generate `JWT_SECRET` once and back it up; rotating it invalidates active JWTs.
Delivera does not store user wallet private keys.
Replace the disabled Brevo value with a real API key and verified sender only
when transactional email is required. In-app notifications do not depend on it.
If file uploads are enabled, separately set `S3_ENDPOINT`, `S3_BUCKET`,
`AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY`.

## 4. Frontend → Vercel

```bash
cd frontend
vercel link
vercel env add NEXT_PUBLIC_API_URL production   # https://delivera-api-gideon.fly.dev
vercel --prod
```

Then update `APP_URL`/`CORS_ORIGINS` Fly secrets with the final Vercel domain and `fly deploy` again.

## 5. Current verified deployments

- GenLayer StudioNet adjudication contract: `0xDa4B86C86010329dbf484a1ccD1BD64396B25cBa`
- Base Sepolia escrow: `0x2bA36CD29993cf4250adfb48F367E1893dcd43B5`
- Base deployment transaction: `0x8af24446291a0efc4fe9641cafdde37cd54e65660e53c0ee4a053c13d9f8b212` (block 48,259,013)
- Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Backend: `https://delivera-api-gideon.fly.dev` (Fly app `delivera-api-gideon`)
- Postgres: Fly app `delivera-db-gideon`; Redis: Upstash `delivera-redis-gideon`
- Current Base relayer: `0x0EaD3C2e53Bf4c47B8875DcC1669E69Deee19d2D`
- Current production frontend deployment: `dpl_G3uwJ844wgzGoEuovn2BFQf15gGt`

The prior escrow `0xC7A0…7875` preserves the historical funded evidence. New
agreements use the address above with deployment-aware keys and unconfirmed-
deposit recovery. For any later deployment, replace both application addresses together and
record the source commit and deployment receipts.

Whenever the contract is (re)deployed:

```bash
fly secrets set --app delivera-api-gideon \
  GENLAYER_CONTRACT_ADDRESS="0xDa4B86C86010329dbf484a1ccD1BD64396B25cBa" \
  GENLAYER_CHAIN_ID=61999 \
  DELIVERA_ESCROW_ADDRESS="0x2bA36CD29993cf4250adfb48F367E1893dcd43B5"
```

Fly restarts the app automatically. `/health` shows `chain: configured`.

## Troubleshooting

- `could not load contract schema` on deploy → runner alias not pinned or syntax error;
  run `genvm-lint check contracts/delivera.py`.
- StudioNet 429 / -32429 → per-IP rate limit (60/min); wait for the window to reset.
- Verification tx slow → normal: validators fetch evidence + run LLMs, and confirmation waits for
  `FINALIZED` before the outcome becomes payout-eligible.
- Emails not arriving → sender must be verified in Brevo; check spam; Brevo dashboard → logs.
