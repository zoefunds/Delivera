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

## 2. Backend → Fly.io

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
  GENLAYER_CONTRACT_ADDRESS="<deployed address>"

fly deploy   # remote build; release runs prisma migrate deploy
curl https://delivera-api.fly.dev/health
```

⚠️ `JWT_SECRET`/`WALLET_MASTER_KEY`: generate once and back them up. Rotating
`WALLET_MASTER_KEY` makes existing encrypted wallet keys undecryptable.

## 3. Frontend → Vercel

```bash
cd frontend
vercel link
vercel env add NEXT_PUBLIC_API_URL production   # https://delivera-api.fly.dev
vercel --prod
```

Then update `APP_URL`/`CORS_ORIGINS` Fly secrets with the final Vercel domain and `fly deploy` again.

## 4. Wire the contract address

Deployed contract on StudioNet: `0xed80FF974287075c8dd4E9524598D7940dceBb5F`

Whenever the contract is (re)deployed:

```bash
fly secrets set --app delivera-api GENLAYER_CONTRACT_ADDRESS="0xed80FF974287075c8dd4E9524598D7940dceBb5F"
```

Fly restarts the app automatically. `/health` shows `chain: configured`.

## Troubleshooting

- `could not load contract schema` on deploy → runner alias not pinned or syntax error;
  run `genvm-lint check contracts/delivera.py`.
- StudioNet 429 / -32429 → per-IP rate limit (60/min); wait for the window to reset.
- Verification tx slow → normal: validators fetch evidence + run LLMs; the backend waits for
  ACCEPTED with 40 × 3 s polling.
- Emails not arriving → sender must be verified in Brevo; check spam; Brevo dashboard → logs.
