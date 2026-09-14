import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(8080),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  BREVO_API_KEY: z.string().min(1),
  BREVO_SENDER_EMAIL: z.string().email(),
  BREVO_SENDER_NAME: z.string().default("Delivera"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  GENLAYER_RPC_URL: z.string().url().default("https://studio.genlayer.com/api"),
  GENLAYER_CONTRACT_ADDRESS: z.string().default(""),
  // Base Sepolia payment layer (contracts/base/DeliveraEscrow.sol, deployed
  // separately). GenLayer only decides milestone/dispute outcomes now; real
  // USDC escrow and payout live here. See src/services/baseSepolia.ts.
  BASE_SEPOLIA_RPC_URL: z.string().url().default("https://sepolia.base.org"),
  BASE_SEPOLIA_USDC_ADDRESS: z.string().default("0x036CbD53842c5426634e7929541eC2318f3dCF7e"),
  DELIVERA_ESCROW_ADDRESS: z.string().default(""),
  BASE_SEPOLIA_RELAYER_PRIVATE_KEY: z.string().default(""),
  S3_ENDPOINT: z.string().default(""),
  S3_BUCKET: z.string().default(""),
  AWS_ACCESS_KEY_ID: z.string().default(""),
  AWS_SECRET_ACCESS_KEY: z.string().default(""),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export const isProd = config.NODE_ENV === "production";
