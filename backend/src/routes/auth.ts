/** Auth routes: register (with custodial wallet), verify email, login, refresh,
 *  logout, forgot/reset password via Brevo. */
import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { Wallet as EthersWallet } from "ethers";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { email } from "../lib/email.js";
import { encryptPrivateKey, randomToken, sha256 } from "../lib/crypto.js";
import { signAccessToken, requireAuth } from "../plugins/auth.js";
import { rateLimit } from "../plugins/rateLimit.js";
import { audit } from "../lib/audit.js";
import { config, isProd } from "../config.js";

const authLimit = rateLimit({ max: 5, windowSec: 900, keyPrefix: "auth" });

const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(10).max(200),
  name: z.string().min(1).max(120),
  role: z.enum(["CLIENT", "PROVIDER", "BOTH"]).default("BOTH"),
});

const REFRESH_COOKIE = "delivera_refresh";

function refreshCookieOpts() {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax" as const,
    path: "/api/v1/auth",
    maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86400,
  };
}

async function issueSession(app: FastifyInstance, userId: string, ip: string, userAgent: string) {
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

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/register", { preHandler: [authLimit] }, async (req, reply) => {
    const body = registerSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (existing) {
      return reply.code(409).send({ error: { code: "EMAIL_TAKEN", message: "Email already registered" } });
    }

    // Custodial GenLayer wallet — generated once, encrypted at rest, tied to
    // the account forever (survives devices, cache clears, reinstalls).
    const wallet = EthersWallet.createRandom();
    const enc = encryptPrivateKey(wallet.privateKey);

    const user = await prisma.user.create({
      data: {
        email: body.email.toLowerCase(),
        passwordHash: await argon2.hash(body.password, { type: argon2.argon2id }),
        name: body.name,
        role: body.role,
        wallet: {
          create: {
            address: wallet.address,
            encryptedPrivateKey: enc.ciphertext,
            kdfSalt: enc.salt,
            iv: enc.iv,
            authTag: enc.authTag,
          },
        },
      },
    });

    const verifyToken = randomToken();
    await prisma.emailToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(verifyToken),
        purpose: "EMAIL_VERIFY",
        expiresAt: new Date(Date.now() + 24 * 3600_000),
      },
    });
    void email.verification(user.email, verifyToken);
    await audit(req, "auth.register", { email: user.email }, user.id);

    const accessToken = signAccessToken({ id: user.id, email: user.email, role: user.role });
    const refresh = await issueSession(app, user.id, req.ip, String(req.headers["user-agent"] ?? ""));
    reply.setCookie(REFRESH_COOKIE, refresh, refreshCookieOpts());
    return reply.code(201).send({
      user: { id: user.id, email: user.email, name: user.name, role: user.role, walletAddress: wallet.address },
      accessToken,
    });
  });

  app.post("/verify-email", async (req, reply) => {
    const { token } = z.object({ token: z.string().min(10) }).parse(req.body);
    const record = await prisma.emailToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!record || record.purpose !== "EMAIL_VERIFY" || record.usedAt || record.expiresAt < new Date()) {
      return reply.code(400).send({ error: { code: "INVALID_TOKEN", message: "Invalid or expired token" } });
    }
    await prisma.$transaction([
      prisma.emailToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
    ]);
    return { ok: true };
  });

  app.post("/login", { preHandler: [authLimit] }, async (req, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string() }).parse(req.body);
    const user = await prisma.user.findUnique({
      where: { email: body.email.toLowerCase() },
      include: { wallet: true },
    });
    const valid = user && (await argon2.verify(user.passwordHash, body.password).catch(() => false));
    if (!valid || !user) {
      await audit(req, "auth.login_failed", { email: body.email });
      return reply.code(401).send({ error: { code: "BAD_CREDENTIALS", message: "Invalid email or password" } });
    }
    await audit(req, "auth.login", undefined, user.id);
    const accessToken = signAccessToken({ id: user.id, email: user.email, role: user.role });
    const refresh = await issueSession(app, user.id, req.ip, String(req.headers["user-agent"] ?? ""));
    reply.setCookie(REFRESH_COOKIE, refresh, refreshCookieOpts());
    return {
      user: {
        id: user.id, email: user.email, name: user.name, role: user.role,
        emailVerified: Boolean(user.emailVerifiedAt),
        walletAddress: user.wallet?.address ?? null,
      },
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
    const refresh = await issueSession(app, session.userId, req.ip, String(req.headers["user-agent"] ?? ""));
    reply.setCookie(REFRESH_COOKIE, refresh, refreshCookieOpts());
    const accessToken = signAccessToken({
      id: session.user.id, email: session.user.email, role: session.user.role,
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

  app.post("/forgot-password", { preHandler: [authLimit] }, async (req) => {
    const { email: rawEmail } = z.object({ email: z.string().email() }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: rawEmail.toLowerCase() } });
    if (user) {
      const token = randomToken();
      await prisma.emailToken.create({
        data: {
          userId: user.id,
          tokenHash: sha256(token),
          purpose: "PASSWORD_RESET",
          expiresAt: new Date(Date.now() + 30 * 60_000),
        },
      });
      void email.passwordReset(user.email, token);
      await audit(req, "auth.forgot_password", undefined, user.id);
    }
    // Always 200 — never reveal whether the email exists.
    return { ok: true };
  });

  app.post("/reset-password", { preHandler: [authLimit] }, async (req, reply) => {
    const body = z.object({ token: z.string().min(10), newPassword: z.string().min(10).max(200) }).parse(req.body);
    const record = await prisma.emailToken.findUnique({ where: { tokenHash: sha256(body.token) } });
    if (!record || record.purpose !== "PASSWORD_RESET" || record.usedAt || record.expiresAt < new Date()) {
      return reply.code(400).send({ error: { code: "INVALID_TOKEN", message: "Invalid or expired token" } });
    }
    await prisma.$transaction([
      prisma.emailToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash: await argon2.hash(body.newPassword, { type: argon2.argon2id }) },
      }),
      prisma.session.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await audit(req, "auth.password_reset", undefined, record.userId);
    return { ok: true };
  });

  app.get("/me", { preHandler: [requireAuth] }, async (req) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      include: { wallet: { select: { address: true } } },
    });
    return {
      id: user.id, email: user.email, name: user.name, role: user.role,
      emailVerified: Boolean(user.emailVerifiedAt),
      walletAddress: user.wallet?.address ?? null,
    };
  });
}
