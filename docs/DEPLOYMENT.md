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
fly launch --no-deploy --copy-config --name delivera-api
fly postgres create --name delivera-db --region iad --initial-cluster-size 1 \
  --vm-size shared-cpu-1x --volume-size 3
fly postgres attach delivera-db --app delivera-api        # sets DATABASE_URL
fly storage create --name delivera-files --app delivera-api  # Tigris: sets AWS_* / BUCKET_NAME

fly secrets set --app delivera-api \
  JWT_SECRET="$(openssl rand -hex 32)" \
  WALLET_MASTER_KEY="$(openssl rand -hex 32)" \
  REDIS_URL="rediss://default:<password>@<host>.upstash.io:6379" \
  BREVO_API_KEY="<brevo key>" \
  BREVO_SENDER_EMAIL="<verified sender>" \
  APP_URL="https://<your-vercel-domain>" \
  CORS_ORIGINS="https://<your-vercel-domain>" \
  S3_ENDPOINT="https://fly.storage.tigris.dev" \
  S3_BUCKET="delivera-files" \
  GENLAYER_CONTRACT_ADDRESS="<deployed address>" \
  GENLAYER_OWNER_PRIVATE_KEY="<genlayer deployer key>" \
  DELIVERA_ESCROW_ADDRESS="<base escrow v2 address>" \
  BASE_SEPOLIA_RELAYER_PRIVATE_KEY="<transport key>" \
  BASE_SEPOLIA_DECISION_AUTHORITY_PRIVATE_KEY="<attestation key>"

fly deploy   # remote build; release runs prisma migrate deploy
curl https://delivera-api.fly.dev/health
```

⚠️ `JWT_SECRET`/`WALLET_MASTER_KEY`: generate once and back them up. Rotating
`WALLET_MASTER_KEY` makes existing encrypted wallet keys undecryptable.

## 4. Frontend → Vercel

```bash
cd frontend
vercel link
vercel env add NEXT_PUBLIC_API_URL production   # https://delivera-api.fly.dev
vercel --prod
```

Then update `APP_URL`/`CORS_ORIGINS` Fly secrets with the final Vercel domain and `fly deploy` again.

## 5. Current verified deployments

- GenLayer StudioNet adjudication contract: `0xB19331f411618Abb253a01Fa5b457D910c92D8F6`
- Base Sepolia escrow v2: `0xC7A0AC77AE3058D0a1A8E3874C8e394D0E4a7875`
- Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`

These addresses correspond to the funded evidence run in `docs/VERIFICATION.md`.
For any later deployment, replace both application addresses together and
record the source commit and deployment receipts.

Whenever the contract is (re)deployed:

```bash
fly secrets set --app delivera-api \
  GENLAYER_CONTRACT_ADDRESS="0xB19331f411618Abb253a01Fa5b457D910c92D8F6" \
  DELIVERA_ESCROW_ADDRESS="0xC7A0AC77AE3058D0a1A8E3874C8e394D0E4a7875"
```

Fly restarts the app automatically. `/health` shows `chain: configured`.

## Troubleshooting

- `could not load contract schema` on deploy → runner alias not pinned or syntax error;
  run `genvm-lint check contracts/delivera.py`.
- StudioNet 429 / -32429 → per-IP rate limit (60/min); wait for the window to reset.
- Verification tx slow → normal: validators fetch evidence + run LLMs, and confirmation waits for
  `FINALIZED` before the outcome becomes payout-eligible.
- Emails not arriving → sender must be verified in Brevo; check spam; Brevo dashboard → logs.
