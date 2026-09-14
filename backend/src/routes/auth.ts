/** Auth routes: wallet-signature (SIWE-style) auth.
 *
 * Identity is the user's connected wallet address, not an email/password.
 * Flow: GET /nonce?address=0x... issues a one-time nonce + message to sign,
 * POST /verify checks the signature recovers that address and issues the
 * same JWT/refresh-cookie session the app has always used. This same wallet
 * address is also the user's GenLayer identity — every GenLayer write is
 * signed by the user themselves in the browser, so a brand-new address just
 * gets a plain User row on first sign-in (no custodial key is generated).
 */
import type { FastifyInstance } from "fastify";
import { verifyMessage, getAddress, isAddress } from "ethers";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { randomToken, sha256 } from "../lib/tokens.js";
import { signAccessToken, requireAuth } from "../plugins/auth.js";
import { rateLimit } from "../plugins/rateLimit.js";
import { audit } from "../lib/audit.js";
import { config, isProd } from "../config.js";

const authLimit = rateLimit({ max: 10, windowSec: 900, keyPrefix: "auth" });

const REFRESH_COOKIE = "delivera_refresh";
const NONCE_TTL_SEC = 5 * 60;

function nonceKey(address: string): string {
  return `siwe:nonce:${address}`;
}

function messageKey(address: string): string {
  return `siwe:message:${address}`;
}

/** Builds the SIWE message a client is asked to sign. Includes a live
 * "Issued At" timestamp, so the exact string built here MUST be persisted
 * (see messageKey) and reused verbatim at verify time — recomputing it
 * there would embed a different timestamp and the signature would never
 * recover to the right address no matter what the client actually signed. */
function siweMessage(address: string, nonce: string): string {
  const domain = new URL(config.APP_URL).host;
  return (
    `${domain} wants you to sign in with your Ethereum account:\n${address}\n\n` +
    `Sign in to Delivera.\n\n` +
    `URI: ${config.APP_URL}\nVersion: 1\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`
  );
}

function refreshCookieOpts() {
  return {
    httpOnly: true,
    // Frontend (vercel.app) and backend (fly.dev) are different origins, so
    // this cookie is sent on a cross-site fetch — SameSite=Lax is NEVER
    // included on cross-site XHR/fetch (only top-level GET navigation), so
    // the silent-refresh-on-401 flow in frontend/src/lib/api.ts would always
    // fail. SameSite=None requires Secure, which is already true in prod
    // (https) — falls back to Lax only for same-origin local dev.
    secure: isProd,
    sameSite: (isProd ? "none" : "lax") as "none" | "lax",
    path: "/api/v1/auth",
    maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86400,
  };
}

async function issueSession(userId: string, ip: string, userAgent: string) {
  const token = randomToken(48);
  await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86400_000),
      ip,
      userAgent,
    },
  });
  return token;
}

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // ---- step 1: get a nonce to sign ------------------------------------
  app.get("/nonce", { preHandler: [authLimit] }, async (req, reply) => {
    const { address } = z.object({ address: z.string() }).parse(req.query);
    if (!isAddress(address)) {
      return reply.code(400).send({ error: { code: "BAD_ADDRESS", message: "Not a valid wallet address" } });
    }
    const checksummed = getAddress(address);
    const nonce = randomToken(16);
    const message = siweMessage(checksummed, nonce);
    await redis.set(nonceKey(checksummed), nonce, "EX", NONCE_TTL_SEC);
    await redis.set(messageKey(checksummed), message, "EX", NONCE_TTL_SEC);
    return { nonce, message };
  });

  // ---- step 2: verify the signed message, issue a session -------------
  app.post("/verify", { preHandler: [authLimit] }, async (req, reply) => {
    const body = z.object({ address: z.string(), signature: z.string().min(1) }).parse(req.body);
    if (!isAddress(body.address)) {
      return reply.code(400).send({ error: { code: "BAD_ADDRESS", message: "Not a valid wallet address" } });
    }
    const address = getAddress(body.address);
    const message = await redis.get(messageKey(address));
    if (!message) {
      return reply.code(400).send({ error: { code: "NONCE_EXPIRED", message: "Request a fresh nonce and try again" } });
    }

    let recovered: string;
    try {
      recovered = verifyMessage(message, body.signature);
    } catch {
      return reply.code(401).send({ error: { code: "BAD_SIGNATURE", message: "Could not verify signature" } });
    }
    if (getAddress(recovered) !== address) {
      await audit(req, "auth.verify_failed", { address });
      return reply.code(401).send({ error: { code: "BAD_SIGNATURE", message: "Signature does not match address" } });
    }
    await redis.del(nonceKey(address), messageKey(address)); // one-time use

    const walletAddress = address.toLowerCase();
    let user = await prisma.user.findUnique({ where: { walletAddress } });
    if (!user) {
      // Same wallet address is now the GenLayer identity too — no custodial
      // signing wallet to provision anymore.
      user = await prisma.user.create({
        data: { walletAddress, name: short(address), role: "BOTH" },
      });
      await audit(req, "auth.register", { walletAddress }, user.id);
    }

    await audit(req, "auth.login", undefined, user.id);
    const accessToken = signAccessToken({
      id: user.id, walletAddress, email: user.email, role: user.role,
    });
    const refresh = await issueSession(user.id, req.ip, String(req.headers["user-agent"] ?? ""));
    reply.setCookie(REFRESH_COOKIE, refresh, refreshCookieOpts());
    return {
      user: { id: user.id, walletAddress, name: user.name, role: user.role, email: user.email },
      accessToken,
    };
  });

  app.post("/refresh", async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (!token) return reply.code(401).send({ error: { code: "NO_REFRESH", message: "No refresh token" } });
    const session = await prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      return reply.code(401).send({ error: { code: "INVALID_REFRESH", message: "Session expired" } });
    }
    // Rotate: revoke old, issue new.
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    const refresh = await issueSession(session.userId, req.ip, String(req.headers["user-agent"] ?? ""));
    reply.setCookie(REFRESH_COOKIE, refresh, refreshCookieOpts());
    const accessToken = signAccessToken({
      id: session.user.id,
      walletAddress: session.user.walletAddress ?? "",
      email: session.user.email,
      role: session.user.role,
    });
    return { accessToken };
  });

  app.post("/logout", async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (token) {
      await prisma.session.updateMany({
        where: { tokenHash: sha256(token), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    reply.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
    return { ok: true };
  });

  app.get("/me", { preHandler: [requireAuth] }, async (req) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    return {
      id: user.id,
      walletAddress: user.walletAddress,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  });
}
