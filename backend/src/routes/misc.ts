/** Projects, notifications, reviews, attachments. */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../plugins/auth.js";
import { storageConfigured, uploadObject, signedDownloadUrl } from "../lib/s3.js";

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/", async (req) =>
    prisma.project.findMany({ where: { ownerId: req.user!.id }, orderBy: { createdAt: "desc" } }));

  app.post("/", async (req, reply) => {
    const body = z.object({ title: z.string().min(1).max(200), description: z.string().max(4000).default("") }).parse(req.body);
    const project = await prisma.project.create({ data: { ...body, ownerId: req.user!.id } });
    return reply.code(201).send(project);
  });

  app.patch("/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(4000).optional(),
      status: z.enum(["OPEN", "CLOSED"]).optional(),
    }).parse(req.body);
    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing || existing.ownerId !== req.user!.id) {
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Project not found" } });
    }
    return prisma.project.update({ where: { id }, data: body });
  });

  app.delete("/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing || existing.ownerId !== req.user!.id) {
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Project not found" } });
    }
    await prisma.project.delete({ where: { id } });
    return { ok: true };
  });
}

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/", async (req) =>
    prisma.notification.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }));

  app.post("/:id/read", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await prisma.notification.updateMany({
      where: { id, userId: req.user!.id },
      data: { readAt: new Date() },
    });
    return { ok: true };
  });
}

export async function reviewRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.post("/", async (req, reply) => {
    const body = z.object({
      contractId: z.string().uuid(),
      rating: z.number().int().min(1).max(5),
      comment: z.string().max(2000).default(""),
    }).parse(req.body);
    const contract = await prisma.contract.findUnique({ where: { id: body.contractId } });
    if (!contract || (contract.clientId !== req.user!.id && contract.providerId !== req.user!.id)) {
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Contract not found" } });
    }
    if (contract.status !== "COMPLETED" && contract.status !== "CANCELLED") {
      return reply.code(409).send({ error: { code: "NOT_FINISHED", message: "Reviews open after completion" } });
    }
    const revieweeId = contract.clientId === req.user!.id ? contract.providerId : contract.clientId;
    if (!revieweeId) return reply.code(409).send({ error: { code: "NO_COUNTERPARTY", message: "No counterparty" } });
    const review = await prisma.review.upsert({
      where: { contractId_reviewerId: { contractId: body.contractId, reviewerId: req.user!.id } },
      create: { ...body, reviewerId: req.user!.id, revieweeId },
      update: { rating: body.rating, comment: body.comment },
    });
    return reply.code(201).send(review);
  });

  app.get("/user/:userId", async (req) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(req.params);
    const reviews = await prisma.review.findMany({ where: { revieweeId: userId }, orderBy: { createdAt: "desc" } });
    const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : null;
    return { average: avg, count: reviews.length, reviews };
  });
}

const MAX_UPLOAD = 25 * 1024 * 1024;
const ALLOWED_MIME = /^(image\/|application\/pdf|text\/|application\/zip|video\/mp4)/;

export async function attachmentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.post("/", async (req, reply) => {
    if (!storageConfigured()) {
      return reply.code(503).send({ error: { code: "STORAGE_NOT_CONFIGURED", message: "File storage not configured" } });
    }
    const file = await req.file({ limits: { fileSize: MAX_UPLOAD } });
    if (!file) return reply.code(400).send({ error: { code: "NO_FILE", message: "No file provided" } });
    if (!ALLOWED_MIME.test(file.mimetype)) {
      return reply.code(415).send({ error: { code: "BAD_TYPE", message: `Unsupported type ${file.mimetype}` } });
    }
    const buffer = await file.toBuffer();
    const key = `attachments/${req.user!.id}/${crypto.randomUUID()}-${file.filename.replace(/[^\w.\-]/g, "_")}`;
    await uploadObject(key, buffer, file.mimetype);
    const attachment = await prisma.attachment.create({
      data: { ownerId: req.user!.id, s3Key: key, filename: file.filename, mime: file.mimetype, size: buffer.length },
    });
    return reply.code(201).send({ ...attachment, url: await signedDownloadUrl(key) });
  });

  app.get("/:id/url", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const attachment = await prisma.attachment.findUnique({ where: { id } });
    if (!attachment) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Attachment not found" } });
    return { url: await signedDownloadUrl(attachment.s3Key) };
  });
}
