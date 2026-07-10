import type { FastifyRequest } from "fastify";
import { prisma } from "./prisma.js";
import { logger } from "./logger.js";

export async function audit(
  req: FastifyRequest,
  action: string,
  detail?: Record<string, unknown>,
  userId?: string,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: userId ?? req.user?.id ?? null,
        action,
        ip: req.ip,
        userAgent: String(req.headers["user-agent"] ?? ""),
        detail: detail as object | undefined,
      },
    });
  } catch (err) {
    logger.warn({ err, action }, "audit log write failed");
  }
}
