/** Contract routes — mirror + on-chain integration.
 *
 * Every state change happens ON the intelligent contract, signed with the
 * caller's custodial wallet; Postgres only mirrors results for fast listing.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../plugins/auth.js";
import { rateLimit } from "../plugins/rateLimit.js";
import { audit } from "../lib/audit.js";
import { email } from "../lib/email.js";
import { cached, invalidate } from "../lib/redis.js";
import { decryptPrivateKey } from "../lib/crypto.js";
import { contractConfigured, readContract, writeContract } from "../lib/genlayer.js";

const writeLimit = rateLimit({ max: 20, windowSec: 60, keyPrefix: "chain-write" });

const milestoneSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).default(""),
  acceptanceCriteria: z.string().min(10).max(6000),
  evidenceType: z
    .enum(["website", "github_repo", "api_endpoint", "document", "article", "design", "media", "other"])
    .default("other"),
  amountAtto: z.string().regex(/^\d+$/),
});

const createSchema = z.object({
  projectId: z.string().uuid().optional(),
  providerEmail: z.string().email(),
  title: z.string().min(1).max(200),
  description: z.string().max(8000).default(""),
  milestones: z.array(milestoneSchema).min(1).max(20),
});

async function userKey(userId: string): Promise<{ address: string; privateKey: string }> {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  return {
    address: wallet.address,
    privateKey: decryptPrivateKey({
      ciphertext: wallet.encryptedPrivateKey,
      salt: wallet.kdfSalt,
      iv: wallet.iv,
      authTag: wallet.authTag,
    }),
  };
}

function requireChain(reply: FastifyReply): boolean {
  if (!contractConfigured()) {
    reply.code(503).send({
      error: { code: "CHAIN_NOT_CONFIGURED", message: "Intelligent contract address not configured yet" },
    });
    return false;
  }
  return true;
}

async function recordTx(
  req: FastifyRequest,
  contractId: string | null,
  kind: string,
  tx: { txHash: string; status: string },
  payload?: Record<string, unknown>,
) {
  await prisma.transaction.create({
    data: { userId: req.user!.id, contractId, kind, txHash: tx.txHash, status: tx.status, payload: payload as object },
  });
}

async function notify(userId: string, type: string, title: string, body: string, ctaPath?: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;
  await prisma.notification.create({ data: { userId, type, title, body, emailedAt: new Date() } });
  void email.notify(user.email, title, body, ctaPath);
}

async function loadParty(req: FastifyRequest, id: string) {
  const contract = await prisma.contract.findUnique({
    where: { id },
    include: { milestones: { include: { deliverables: { orderBy: { attempt: "asc" } } }, orderBy: { index: "asc" } } },
  });
  if (!contract) return { contract: null, isClient: false, isProvider: false };
  const isClient = contract.clientId === req.user!.id;
  const isProvider = contract.providerId === req.user!.id;
  return { contract, isClient, isProvider };
}

export async function contractRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // ---- create (on-chain + mirror) ----------------------------------
  app.post("/", { preHandler: [writeLimit] }, async (req, reply) => {
    if (!requireChain(reply)) return;
    const body = createSchema.parse(req.body);

    const provider = await prisma.user.findUnique({
      where: { email: body.providerEmail.toLowerCase() },
      include: { wallet: true },
    });
    if (!provider?.wallet) {
      return reply.code(404).send({
        error: { code: "PROVIDER_NOT_FOUND", message: "No Delivera account with that email — ask them to sign up first" },
      });
    }
    if (provider.id === req.user!.id) {
      return reply.code(400).send({ error: { code: "SELF_CONTRACT", message: "Client and provider must differ" } });
    }

    const key = await userKey(req.user!.id);
    const chainMilestones = body.milestones.map((m) => ({
      title: m.title,
      description: m.description,
      acceptance_criteria: m.acceptanceCriteria,
      evidence_type: m.evidenceType,
      amount_atto: m.amountAtto,
    }));
    const tx = await writeContract(key.privateKey, "create_contract", [
      provider.wallet.address,
      body.title,
      body.description,
      JSON.stringify(chainMilestones),
    ]);
    const chainContractId = typeof tx.result === "string" ? tx.result : null;

    const totalAtto = body.milestones.reduce((sum, m) => sum + BigInt(m.amountAtto), 0n);
    const contract = await prisma.contract.create({
      data: {
        chainContractId,
        projectId: body.projectId ?? null,
        clientId: req.user!.id,
        providerId: provider.id,
        providerEmail: provider.email,
        title: body.title,
        description: body.description,
        status: "DRAFT",
        totalAtto: totalAtto.toString(),
        milestones: {
          create: body.milestones.map((m, index) => ({
            index,
            title: m.title,
            description: m.description,
            acceptanceCriteria: m.acceptanceCriteria,
            evidenceType: m.evidenceType,
            amountAtto: m.amountAtto,
          })),
        },
      },
      include: { milestones: true },
    });

    await recordTx(req, contract.id, "create_contract", tx);
    await audit(req, "contract.created", { contractId: contract.id, chainContractId });
    await notify(provider.id, "contract.invited", "New contract offer on Delivera",
      `${req.user!.email} created "${body.title}" naming you as provider.`, `/dashboard/contracts/${contract.id}`);
    return reply.code(201).send({ contract, txHash: tx.txHash });
  });

  // ---- list & detail -------------------------------------------------
  app.get("/", async (req) => {
    const { status } = z.object({ status: z.string().optional() }).parse(req.query);
    return prisma.contract.findMany({
      where: {
        OR: [{ clientId: req.user!.id }, { providerId: req.user!.id }],
        ...(status ? { status: status as never } : {}),
      },
      include: { milestones: { orderBy: { index: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
  });

  app.get("/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { contract, isClient, isProvider } = await loadParty(req, id);
    if (!contract) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Contract not found" } });
    if (!isClient && !isProvider) {
      return reply.code(403).send({ error: { code: "FORBIDDEN", message: "Not a party to this contract" } });
    }
    let chain: unknown = null;
    if (contract.chainContractId && contractConfigured()) {
      chain = await cached(`chain:${contract.chainContractId}`, 15, () =>
        readContract("get_contract", [contract.chainContractId]),
      ).catch(() => null);
    }
    const disputes = await prisma.dispute.findMany({ where: { contractId: id } });
    return { ...contract, disputes, chain };
  });

  // ---- generic chain action helper -----------------------------------
  async function chainAction(
    req: FastifyRequest,
    reply: FastifyReply,
    id: string,
    opts: {
      allow: "client" | "provider" | "both";
      method: string;
      args: (chainId: string) => unknown[];
      kind: string;
      after?: (result: unknown) => Promise<void>;
      waitFor?: "ACCEPTED" | "FINALIZED";
    },
  ) {
    if (!requireChain(reply)) return;
    const { contract, isClient, isProvider } = await loadParty(req, id);
    if (!contract) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Contract not found" } });
    const allowed =
      (opts.allow === "client" && isClient) ||
      (opts.allow === "provider" && isProvider) ||
      (opts.allow === "both" && (isClient || isProvider));
    if (!allowed) return reply.code(403).send({ error: { code: "FORBIDDEN", message: "Not allowed for your role" } });
    if (!contract.chainContractId) {
      return reply.code(409).send({ error: { code: "NOT_ON_CHAIN", message: "Contract has no chain id" } });
    }
    const key = await userKey(req.user!.id);
    const tx = await writeContract(key.privateKey, opts.method, opts.args(contract.chainContractId), {
      waitFor: opts.waitFor,
    });
    await recordTx(req, contract.id, opts.kind, tx);
    await invalidate(`chain:${contract.chainContractId}`);
    if (opts.after) await opts.after(tx.result);
    return { txHash: tx.txHash, status: tx.status, result: tx.result ?? null };
  }

  // ---- lifecycle actions ---------------------------------------------
  app.post("/:id/fund", { preHandler: [writeLimit] }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return chainAction(req, reply, id, {
      allow: "client", method: "fund_escrow", kind: "fund_escrow",
      args: (cid) => [cid],
      after: async () => {
        const c = await prisma.contract.update({ where: { id }, data: { status: "FUNDED", fundedAtto: (await prisma.contract.findUniqueOrThrow({ where: { id } })).totalAtto } });
        if (c.providerId) await notify(c.providerId, "contract.funded", "Escrow funded",
          `Escrow for "${c.title}" is locked. Accept the contract to begin work.`, `/dashboard/contracts/${id}`);
      },
    });
  });

  app.post("/:id/accept", { preHandler: [writeLimit] }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return chainAction(req, reply, id, {
      allow: "provider", method: "accept_contract", kind: "accept_contract",
      args: (cid) => [cid],
      after: async () => {
        const c = await prisma.contract.update({ where: { id }, data: { status: "ACTIVE" } });
        await notify(c.clientId, "contract.accepted", "Contract accepted",
          `The provider accepted "${c.title}". Work is underway.`, `/dashboard/contracts/${id}`);
      },
    });
  });

  app.post("/:id/cancel", { preHandler: [writeLimit] }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return chainAction(req, reply, id, {
      allow: "both", method: "cancel_contract", kind: "cancel_contract",
      args: (cid) => [cid],
      after: async () => {
        await prisma.contract.update({ where: { id }, data: { status: "CANCELLED" } });
      },
    });
  });

  // ---- deliverables ---------------------------------------------------
  app.post("/:id/milestones/:index/submit", { preHandler: [writeLimit] }, async (req, reply) => {
    const { id, index } = z.object({ id: z.string().uuid(), index: z.coerce.number().int().min(0) }).parse(req.params);
    const body = z.object({
      evidenceUrls: z.array(z.string().url().max(2000)).min(1).max(5),
      notes: z.string().max(2000).default(""),
    }).parse(req.body);

    return chainAction(req, reply, id, {
      allow: "provider", method: "submit_deliverable", kind: "submit_deliverable",
      args: (cid) => [cid, index, JSON.stringify(body.evidenceUrls), body.notes],
      after: async () => {
        const milestone = await prisma.milestone.update({
          where: { contractId_index: { contractId: id, index } },
          data: { status: "SUBMITTED", attempts: { increment: 1 } },
        });
        await prisma.deliverable.create({
          data: {
            milestoneId: milestone.id,
            submitterId: req.user!.id,
            evidenceUrls: body.evidenceUrls,
            notes: body.notes,
            attempt: milestone.attempts,
          },
        });
        const c = await prisma.contract.findUniqueOrThrow({ where: { id } });
        await notify(c.clientId, "milestone.submitted", "Deliverable submitted",
          `A deliverable was submitted for "${milestone.title}". Trigger AI verification or approve manually.`,
          `/dashboard/contracts/${id}`);
      },
    });
  });

  app.post("/:id/milestones/:index/verify", { preHandler: [writeLimit] }, async (req, reply) => {
    const { id, index } = z.object({ id: z.string().uuid(), index: z.coerce.number().int().min(0) }).parse(req.params);
    return chainAction(req, reply, id, {
      allow: "both", method: "verify_deliverable", kind: "verify_deliverable",
      args: (cid) => [cid, index],
      after: async (result) => {
        const verdict = typeof result === "string" ? result : "unknown";
        const statusMap: Record<string, string> = {
          approved: "APPROVED", needs_revision: "NEEDS_REVISION", rejected: "REJECTED",
        };
        const milestone = await prisma.milestone.update({
          where: { contractId_index: { contractId: id, index } },
          data: { status: (statusMap[verdict] ?? "SUBMITTED") as never },
        });
        const deliverable = await prisma.deliverable.findFirst({
          where: { milestoneId: milestone.id }, orderBy: { createdAt: "desc" },
        });
        if (deliverable) {
          await prisma.aiEvaluation.create({
            data: { deliverableId: deliverable.id, verdict, score: verdict === "approved" ? 100 : 0, reasoning: "See chain evaluation record" },
          });
        }
        const c = await prisma.contract.findUniqueOrThrow({ where: { id } });
        for (const uid of [c.clientId, c.providerId].filter(Boolean) as string[]) {
          await notify(uid, "milestone.verified", `AI verdict: ${verdict}`,
            `Validator consensus returned "${verdict}" for milestone "${milestone.title}".`,
            `/dashboard/contracts/${id}`);
        }
      },
    });
  });

  app.post("/:id/milestones/:index/approve", { preHandler: [writeLimit] }, async (req, reply) => {
    const { id, index } = z.object({ id: z.string().uuid(), index: z.coerce.number().int().min(0) }).parse(req.params);
    return chainAction(req, reply, id, {
      allow: "client", method: "approve_milestone", kind: "approve_milestone",
      args: (cid) => [cid, index],
      after: async () => {
        const m = await prisma.milestone.update({
          where: { contractId_index: { contractId: id, index } },
          data: { status: "APPROVED" },
        });
        const c = await prisma.contract.findUniqueOrThrow({ where: { id } });
        if (c.providerId) await notify(c.providerId, "milestone.approved", "Milestone approved",
          `"${m.title}" was approved — funds released to your balance.`, `/dashboard/contracts/${id}`);
      },
    });
  });

  // ---- disputes -------------------------------------------------------
  app.post("/:id/disputes", { preHandler: [writeLimit] }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      milestoneIndex: z.number().int().min(0),
      reason: z.string().min(10).max(2000),
    }).parse(req.body);
    return chainAction(req, reply, id, {
      allow: "both", method: "raise_dispute", kind: "raise_dispute",
      args: (cid) => [cid, body.milestoneIndex, body.reason],
      after: async (result) => {
        await prisma.contract.update({ where: { id }, data: { status: "DISPUTED" } });
        await prisma.dispute.create({
          data: {
            contractId: id,
            chainDisputeIndex: typeof result === "number" ? result : Number(result ?? 0),
            milestoneIndex: body.milestoneIndex,
            raisedById: req.user!.id,
            reason: body.reason,
          },
        });
      },
    });
  });

  app.post("/:id/disputes/:disputeIndex/statement", { preHandler: [writeLimit] }, async (req, reply) => {
    const { id, disputeIndex } = z.object({ id: z.string().uuid(), disputeIndex: z.coerce.number().int().min(0) }).parse(req.params);
    const { statement } = z.object({ statement: z.string().min(1).max(2000) }).parse(req.body);
    return chainAction(req, reply, id, {
      allow: "both", method: "add_dispute_statement", kind: "add_dispute_statement",
      args: (cid) => [cid, disputeIndex, statement],
    });
  });

  app.post("/:id/disputes/:disputeIndex/resolve", { preHandler: [writeLimit] }, async (req, reply) => {
    const { id, disputeIndex } = z.object({ id: z.string().uuid(), disputeIndex: z.coerce.number().int().min(0) }).parse(req.params);
    return chainAction(req, reply, id, {
      allow: "both", method: "resolve_dispute", kind: "resolve_dispute",
      args: (cid) => [cid, disputeIndex],
      after: async (result) => {
        let resolution: { provider_bps?: number; summary?: string } = {};
        try { resolution = JSON.parse(String(result)); } catch { /* keep empty */ }
        await prisma.dispute.updateMany({
          where: { contractId: id, chainDisputeIndex: disputeIndex },
          data: {
            status: "RESOLVED",
            providerBps: resolution.provider_bps ?? null,
            resolutionSummary: resolution.summary ?? null,
            resolvedAt: new Date(),
          },
        });
        await prisma.contract.update({ where: { id }, data: { status: "ACTIVE" } });
      },
    });
  });

  // ---- funds ----------------------------------------------------------
  // Both endpoints move real GEN — `deposit` is a payable call (the attached
  // value credits the caller's ledger entry), `withdraw` triggers the
  // contract's emit_transfer back to the caller. Withdraw waits for
  // FINALIZED, not just ACCEPTED, since that's when the transfer actually
  // lands on-chain (see genlayer.ts).
  app.post("/:id/withdraw", { preHandler: [writeLimit] }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { amountAtto } = z.object({ amountAtto: z.string().regex(/^\d+$/) }).parse(req.body);
    return chainAction(req, reply, id, {
      allow: "both", method: "withdraw", kind: "withdraw",
      args: () => [amountAtto],
      waitFor: "FINALIZED",
    });
  });

  app.post("/deposit", { preHandler: [writeLimit] }, async (req, reply) => {
    if (!requireChain(reply)) return;
    const { amountAtto } = z.object({ amountAtto: z.string().regex(/^\d+$/) }).parse(req.body);
    const key = await userKey(req.user!.id);
    const tx = await writeContract(key.privateKey, "deposit", [], { valueAtto: BigInt(amountAtto) });
    await recordTx(req, null, "deposit", tx, { amountAtto });
    return { txHash: tx.txHash, status: tx.status };
  });

  // ---- evaluations audit trail ---------------------------------------
  app.get("/:id/evaluations", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { contract, isClient, isProvider } = await loadParty(req, id);
    if (!contract) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Contract not found" } });
    if (!isClient && !isProvider) {
      return reply.code(403).send({ error: { code: "FORBIDDEN", message: "Not a party to this contract" } });
    }
    if (!contract.chainContractId || !contractConfigured()) return [];
    return cached(`chain:${contract.chainContractId}:evals`, 15, () =>
      readContract("get_evaluations", [contract.chainContractId]),
    ).catch(() => []);
  });
}
