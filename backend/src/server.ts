import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { ZodError } from "zod";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";
import { authRoutes } from "./routes/auth.js";
import { walletRoutes } from "./routes/wallet.js";
import { contractRoutes } from "./routes/contracts.js";
import { projectRoutes, notificationRoutes, reviewRoutes, attachmentRoutes } from "./routes/misc.js";
import { contractConfigured } from "./lib/genlayer.js";
import { isEscrowConfigured } from "./services/baseSepolia.js";
import { startRelayJobs } from "./jobs/relay.js";

export async function buildServer() {
  const app = Fastify({ loggerInstance: logger, trustProxy: true, bodyLimit: 1024 * 1024 });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.CORS_ORIGINS.split(",").map((o) => o.trim()),
    credentials: true,
  });
  await app.register(cookie);
  await app.register(multipart);

  // Uniform error envelope; zod -> 400, unexpected -> 500 (no internals leaked).
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: { code: "VALIDATION", message: "Invalid request", details: err.flatten().fieldErrors },
      });
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (typeof e.statusCode === "number" && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: { code: e.code ?? "REQUEST_ERROR", message: e.message ?? "Request error" } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Internal server error" } });
  });

  app.get("/health", async () => {
    const checks: Record<string, string> = { server: "ok" };
    try { await prisma.$queryRaw`SELECT 1`; checks.database = "ok"; } catch { checks.database = "down"; }
    try { await redis.ping(); checks.redis = "ok"; } catch { checks.redis = "down"; }
    checks.chain = contractConfigured() ? "configured" : "unconfigured";
    checks.escrow = isEscrowConfigured() ? "configured" : "unconfigured";
    return { status: checks.database === "ok" ? "healthy" : "degraded", checks };
  });

  await app.register(authRoutes, { prefix: "/api/v1/auth" });
  await app.register(walletRoutes, { prefix: "/api/v1/wallet" });
  await app.register(contractRoutes, { prefix: "/api/v1/contracts" });
  await app.register(projectRoutes, { prefix: "/api/v1/projects" });
  await app.register(notificationRoutes, { prefix: "/api/v1/notifications" });
  await app.register(reviewRoutes, { prefix: "/api/v1/reviews" });
  await app.register(attachmentRoutes, { prefix: "/api/v1/attachments" });

  return app;
}

const isMain = process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js");
if (isMain) {
  buildServer()
    .then((app) => app.listen({ port: config.PORT, host: "0.0.0.0" }))
    .then((address) => {
      logger.info({ address }, "Delivera API listening");
      startRelayJobs();
    })
    .catch((err) => {
      logger.error({ err }, "failed to start");
      process.exit(1);
    });
}
