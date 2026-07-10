/** Wallet routes: view address/balance, one-time private key export. */
import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { decryptPrivateKey } from "../lib/crypto.js";
import { requireAuth } from "../plugins/auth.js";
import { rateLimit } from "../plugins/rateLimit.js";
import { audit } from "../lib/audit.js";
import { contractConfigured, readContract } from "../lib/genlayer.js";

export async function walletRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/", async (req) => {
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: req.user!.id } });
    let onchainBalanceAtto: string | null = null;
    if (contractConfigured()) {
      try {
        onchainBalanceAtto = String(await readContract("get_balance", [wallet.address]));
      } catch {
        onchainBalanceAtto = null;
      }
    }
    return { address: wallet.address, onchainBalanceAtto, exportedAt: wallet.exportedAt };
  });

  // Secure private-key export: fresh password re-auth, heavy rate limit, audit.
  app.post(
    "/export",
    { preHandler: [rateLimit({ max: 3, windowSec: 3600, keyPrefix: "wallet-export" })] },
    async (req, reply) => {
      const { password } = z.object({ password: z.string() }).parse(req.body);
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: req.user!.id },
        include: { wallet: true },
      });
      const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
      if (!ok) {
        await audit(req, "wallet.export_denied");
        return reply.code(401).send({ error: { code: "BAD_CREDENTIALS", message: "Password incorrect" } });
      }
      const wallet = user.wallet!;
      const privateKey = decryptPrivateKey({
        ciphertext: wallet.encryptedPrivateKey,
        salt: wallet.kdfSalt,
        iv: wallet.iv,
        authTag: wallet.authTag,
      });
      await prisma.wallet.update({ where: { id: wallet.id }, data: { exportedAt: new Date() } });
      await audit(req, "wallet.exported");
      return { address: wallet.address, privateKey };
    },
  );
}
