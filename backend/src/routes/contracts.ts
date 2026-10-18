/** Contract routes — mirror + on-chain integration.
 *
 * Every state change happens ON the intelligent contract, signed with the
 * caller's OWN connected wallet directly in the browser (via genlayer-js on
 * the frontend) — this backend never holds or uses a private key belonging
 * to a user. These routes only re-read GenLayer state to confirm a write the
 * frontend already submitted actually landed, then mirror the confirmed
 * result into Postgres for fast listing/detail views.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../plugins/auth.js";
import { rateLimit } from "../plugins/rateLimit.js";
import { audit } from "../lib/audit.js";
import { email } from "../lib/email.js";
import { cached, invalidate } from "../lib/redis.js";
import { contractConfigured, readContract, readUntilFound, waitForFinalizedTransaction, writeContract } from "../lib/genlayer.js";
import { config } from "../config.js";
import { activateEscrow, createFundingAuthorization, getFundingRecoveryState, isEscrowConfigured, verifyEscrowFunded } from "../services/baseSepolia.js";

const writeLimit = rateLimit({ max: 20, windowSec: 60, keyPrefix: "chain-write" });
const confirmTxSchema = z.object({ txHash: z.string().min(1) });

const milestoneSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).default(""),
  acceptanceCriteria: z.string().min(10).max(6000),
  evidenceType: z
    .enum(["website", "github_repo", "api_endpoint", "document", "article", "design", "media", "other"])
    .default("other"),
  amountAtto: z.string().regex(/^\d+$/),
});

const createSchema = z
  .object({
    projectId: z.string().uuid().optional(),
    providerEmail: z.string().email().optional(),
    providerWalletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
    title: z.string().min(1).max(200),
    description: z.string().max(8000).default(""),
    txHash: z.string().min(1),
    milestones: z.array(milestoneSchema).min(1).max(20),
  })
  .refine((b) => Boolean(b.providerEmail || b.providerWalletAddress), {
    message: "Provide either providerEmail or providerWalletAddress",
    path: ["providerWalletAddress"],
  });

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
  tx: { txHash?: string | null; status: string },
  payload?: Record<string, unknown>,
) {
  await prisma.transaction.create({
    data: {
      userId: req.user!.id,
      contractId,
      kind,
      txHash: tx.txHash ?? null,
      status: tx.status,
      payload: payload as object,
    },
  });
}

async function notify(userId: string, type: string, title: string, body: string, ctaPath?: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;
  await prisma.notification.create({ data: { userId, type, title, body, emailedAt: user.email ? new Date() : null } });
  // Email is optional now that auth is wallet-only — only wallet-linked
  // accounts that also supplied an email get notified that way.
  if (user.email) void email.notify(user.email, title, body, ctaPath);
}

async function loadParty(req: FastifyRequest, id: string) {
  const contract = await prisma.contract.findUnique({
    where: { id },
    include: {
      milestones: { include: { deliverables: { orderBy: { attempt: "asc" } } }, orderBy: { index: "asc" } },
      provider: { select: { walletAddress: true } },
      client: { select: { walletAddress: true } },
    },
  });
  if (!contract) return { contract: null, isClient: false, isProvider: false };
  const isClient = contract.clientId === req.user!.id;
  const isProvider = contract.providerId === req.user!.id;
  return { contract, isClient, isProvider };
}

type ChainMilestone = {
  index: number;
  title: string;
  description: string;
  acceptance_criteria: string;
  evidence_type: string;
  amount_atto: string;
  status: string;
  attempts: number;
  submission?: { evidence_urls: string[]; notes: string; attempt: number } | null;
  last_evaluation?: { verdict: string; score: number; reasoning: string; attempt: number } | null;
};

type ChainDispute = {
  index: number;
  milestone_index: number;
  raised_by: "client" | "provider";
  reason: string;
  client_statement: string;
  provider_statement: string;
  status: "OPEN" | "RESOLVED";
  resolution?: { provider_bps: number; provider_atto: string; client_atto: string; summary: string } | null;
};

type ChainContract = {
  id: string;
  client: string;
  provider: string;
  title: string;
  status: string;
  total_atto: string;
  funded_atto: string;
  released_atto: string;
  refunded_atto: string;
  milestone_count: number;
  description?: string;
  milestones?: ChainMilestone[];
  disputes?: ChainDispute[];
};

export async function contractRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // ---- resolve provider email -> wallet address -----------------------
  // Used by the frontend before signing create_contract itself: the chain
  // method takes the provider's wallet address, not an email, so an email
  // typed into the create form has to be resolved client-side first.
  app.get("/resolve-provider", async (req, reply) => {
    const { email: providerEmail } = z.object({ email: z.string().email() }).parse(req.query);
    const provider = await prisma.user.findUnique({ where: { email: providerEmail.toLowerCase() } });
    if (!provider?.walletAddress) {
      return reply.code(404).send({
        error: { code: "PROVIDER_NOT_FOUND", message: "No Delivera account with that email has a connected wallet yet" },
      });
    }
    return { walletAddress: provider.walletAddress };
  });

  // ---- confirm-create (frontend already signed create_contract) -------
  // The frontend now signs `create_contract` itself with the client's own
  // connected wallet (see frontend/src/lib/genlayer.ts) instead of this
  // backend signing with a custodial key. Because genlayer-js's
  // waitForTransactionReceipt reliably fails from the browser (CORS), the
  // frontend can't read back the new on-chain contract id itself — so this
  // route re-reads chain state server-side (no CORS here) to find the
  // contract that was just created, then mirrors it into Postgres exactly
  // like the old POST / used to.
  app.post("/confirm-create", { preHandler: [writeLimit] }, async (req, reply) => {
    if (!requireChain(reply)) return;
    const body = createSchema.parse(req.body);

    try {
      await waitForFinalizedTransaction(body.txHash);
    } catch (err) {
      return reply.code(409).send({ error: { code: "NOT_FINALIZED", message: (err as Error).message } });
    }

    const client = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!client.walletAddress) {
      return reply.code(409).send({ error: { code: "NO_WALLET", message: "You have no wallet address on file" } });
    }

    const provider = body.providerWalletAddress
      ? await prisma.user.findUnique({ where: { walletAddress: body.providerWalletAddress.toLowerCase() } })
      : await prisma.user.findUnique({ where: { email: body.providerEmail!.toLowerCase() } });
    if (!provider?.walletAddress) {
      return reply.code(404).send({
        error: {
          code: "PROVIDER_NOT_FOUND",
          message: body.providerWalletAddress
            ? "No Delivera account with that wallet address — ask them to connect their wallet first"
            : "No Delivera account with that email — ask them to sign up first",
        },
      });
    }

    // Find the newest DRAFT contract on-chain between these two parties
    // with this exact title that we haven't mirrored yet — that's the one
    // the wallet-signed create_contract transaction just created.
    const existing = await prisma.contract.findFirst({ where: { clientId: client.id, title: body.title, providerId: provider.id } });
    if (existing) return reply.code(200).send({ contract: existing });

    type PartySummary = { id: string; provider: string; title: string; status: string; created_seq: number };
    const findMatch = (summaries: PartySummary[]) =>
      summaries
        .filter((s) => s.provider?.toLowerCase() === provider.walletAddress!.toLowerCase() && s.title === body.title && s.status === "DRAFT")
        .sort((a, b) => b.created_seq - a.created_seq)[0];

    let match: PartySummary | undefined;
    try {
      // The client's wallet just submitted create_contract itself — reads
      // right after an ACCEPTED write can lag behind actual consensus state,
      // so this has to poll rather than check once.
      const summaries = await readUntilFound<PartySummary[]>(
        "list_contracts_by_party",
        [client.walletAddress, "client"],
        (list) => Boolean(findMatch(list ?? [])),
      );
      match = findMatch(summaries);
    } catch (err) {
      return reply.code(409).send({
        error: {
          code: "CHAIN_CONTRACT_NOT_FOUND",
          message: (err as Error).message || "Could not find the on-chain contract yet — it may still be finalizing. Try again shortly.",
        },
      });
    }
    if (!match) {
      return reply.code(409).send({
        error: {
          code: "CHAIN_CONTRACT_NOT_FOUND",
          message: "Could not find the on-chain contract yet — it may still be finalizing. Try again shortly.",
        },
      });
    }

    const totalAtto = body.milestones.reduce((sum, m) => sum + BigInt(m.amountAtto), 0n);
    const contract = await prisma.contract.create({
      data: {
        chainContractId: match.id,
        projectId: body.projectId ?? null,
        clientId: client.id,
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

    await audit(req, "contract.created", { contractId: contract.id, chainContractId: match.id });
    await notify(provider.id, "contract.invited", "New contract offer on Delivera",
      `${req.user!.email ?? req.user!.walletAddress} created "${body.title}" naming you as provider.`, `/dashboard/contracts/${contract.id}`);
    return reply.code(201).send({ contract });
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
    const fundingRecovery = contract.chainContractId && isEscrowConfigured()
      ? await getFundingRecoveryState(contract.chainContractId).catch(() => null)
      : null;
    return {
      ...contract,
      disputes,
      chain,
      escrow: {
        address: config.DELIVERA_ESCROW_ADDRESS || null,
        usdcAddress: config.BASE_SEPOLIA_USDC_ADDRESS,
        fundingRecovery,
      },
    };
  });

  // ---- generic confirm-then-mirror helper -----------------------------
  // Confirms a write the frontend already submitted with the user's own
  // wallet: polls `opts.method` until `opts.predicate` matches the expected
  // post-write state, then runs `opts.after` to mirror it into Postgres.
  // No signing happens here — this route never touches a private key.
  async function confirmAction<T>(
    req: FastifyRequest,
    reply: FastifyReply,
    id: string,
    opts: {
      allow: "client" | "provider" | "both";
      method: string;
      args: (chainId: string) => unknown[];
      predicate: (value: T) => boolean;
      kind: string;
      after?: (result: T) => Promise<void>;
      retries?: number;
      interval?: number;
      requireFinalized?: boolean;
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

    let txHash: string | undefined;
    if (opts.requireFinalized !== false) {
      const parsed = confirmTxSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: "TX_HASH_REQUIRED", message: "The wallet-signed GenLayer transaction hash is required" } });
      }
      txHash = parsed.data.txHash;
      try {
        await waitForFinalizedTransaction(txHash);
      } catch (err) {
        return reply.code(409).send({ error: { code: "NOT_FINALIZED", message: (err as Error).message } });
      }
    }

    let value: T;
    try {
      value = await readUntilFound<T>(opts.method, opts.args(contract.chainContractId), opts.predicate, {
        retries: opts.retries, interval: opts.interval,
      });
    } catch (err) {
      return reply.code(409).send({
        error: {
          code: "NOT_CONFIRMED",
          message: (err as Error).message || "Could not confirm the on-chain transaction yet — it may still be pending",
        },
      });
    }

    await recordTx(req, contract.id, opts.kind, { txHash, status: "CONFIRMED" });
    await invalidate(`chain:${contract.chainContractId}`);
    if (opts.after) await opts.after(value);
    return { status: "CONFIRMED", result: value };
  }

  // ---- lifecycle actions ---------------------------------------------
  const fundSchema = z.object({ fundTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/) });

  // Produces a short-lived authority signature over the exact immutable
  // GenLayer/DB agreement. The Base contract also binds it to msg.sender,
  // preventing public-id pre-funding and field substitution.
  app.post("/:id/funding-authorization", { preHandler: [writeLimit] }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { contract, isClient } = await loadParty(req, id);
    if (!contract) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Contract not found" } });
    if (!isClient || !req.user!.walletAddress) return reply.code(403).send({ error: { code: "FORBIDDEN", message: "Only the registered client wallet can fund" } });
    if (!contract.chainContractId || !contract.provider?.walletAddress) return reply.code(409).send({ error: { code: "INCOMPLETE_BINDING", message: "Contract parties are not fully bound" } });
    if (contract.status !== "DRAFT") return reply.code(409).send({ error: { code: "BAD_STATUS", message: "Only a draft contract can be funded" } });
    if (!isEscrowConfigured()) return reply.code(503).send({ error: { code: "ESCROW_NOT_CONFIGURED", message: "Base Sepolia escrow is not configured" } });
    const milestoneAtto = contract.milestones.sort((a, b) => a.index - b.index).map((m) => BigInt(m.amountAtto.toString()));
    if (milestoneAtto.some((amount) => amount % 10n ** 12n !== 0n)) {
      return reply.code(409).send({ error: { code: "UNREPRESENTABLE_USDC_AMOUNT", message: "Every milestone must resolve exactly to 6-decimal USDC units" } });
    }
    const allocations = milestoneAtto.map((amount) => amount / 10n ** 12n);
    const authorization = await createFundingAuthorization(
      contract.chainContractId, req.user!.walletAddress, contract.provider.walletAddress, allocations,
    );
    return { ...authorization, allocations: allocations.map(String) };
  });

  app.post("/:id/fund", { preHandler: [writeLimit] }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { fundTxHash } = fundSchema.parse(req.body);
    const { contract, isClient } = await loadParty(req, id);
    if (!contract) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Contract not found" } });
    if (!isClient) return reply.code(403).send({ error: { code: "FORBIDDEN", message: "Only the client can fund" } });
    if (!contract.provider?.walletAddress) {
      return reply.code(409).send({ error: { code: "PROVIDER_NO_WALLET", message: "Provider has no wallet address on file" } });
    }
    if (!isEscrowConfigured()) {
      return reply.code(503).send({ error: { code: "ESCROW_NOT_CONFIGURED", message: "Base Sepolia escrow is not configured yet" } });
    }
    // The client must have already called DeliveraEscrow.fundEscrow() directly
    // with their own connected wallet (real USDC never passes through this
    // backend) — this only verifies that deposit actually landed on-chain
    // before mirroring FUNDED, so a client can't fake funding by just calling
    // this endpoint with a bogus or unrelated tx hash.
    const expectedAllocations = contract.milestones
      .sort((a, b) => a.index - b.index)
      .map((milestone) => BigInt(milestone.amountAtto.toString()) / 10n ** 12n);
    const expectedUsdc = expectedAllocations.reduce((sum, amount) => sum + amount, 0n);
    const verified = await verifyEscrowFunded(
      contract.chainContractId!, fundTxHash, req.user!.walletAddress!,
      contract.provider.walletAddress, expectedUsdc, expectedAllocations,
    )
      .catch((err) => ({ ok: false as const, reason: (err as Error).message }));
    if (!verified.ok) {
      return reply.code(400).send({ error: { code: "FUNDING_NOT_VERIFIED", message: verified.reason ?? "Could not verify on-chain funding" } });
    }

    // Only the verifier/owner key may attest funding on GenLayer. This write
    // happens after the Base receipt has been checked against the complete
    // client/provider/id/amount binding, so a direct client call cannot forge
    // a FUNDED state.
    if (!config.GENLAYER_OWNER_PRIVATE_KEY) {
      return reply.code(503).send({ error: { code: "FUNDING_VERIFIER_NOT_CONFIGURED", message: "GenLayer funding verifier is not configured" } });
    }
    const fundingState = await readContract("get_contract", [contract.chainContractId!]) as ChainContract;
    if (fundingState.status === "DRAFT") {
      await writeContract(config.GENLAYER_OWNER_PRIVATE_KEY, "fund_escrow", [
        contract.chainContractId!, fundTxHash, config.DELIVERA_ESCROW_ADDRESS, contract.chainContractId!,
      ], { waitFor: "FINALIZED" });
    } else if (fundingState.status !== "FUNDED") {
      return reply.code(409).send({ error: { code: "BAD_CHAIN_STATUS", message: `Cannot confirm funding from ${fundingState.status}` } });
    }
    // Base settlement remains disabled until this post-finalization
    // activation lands. If GenLayer confirmation never finalizes, the client
    // can recover the untouched deposit after the on-chain delay instead.
    await activateEscrow(contract.chainContractId!);
    return confirmAction<ChainContract>(req, reply, id, {
      allow: "client", method: "get_contract", kind: "fund_escrow",
      args: (cid) => [cid],
      predicate: (c) => c.status === "FUNDED",
      requireFinalized: false,
      after: async () => {
        const c = await prisma.contract.update({
          where: { id },
          data: { status: "FUNDED", fundedAtto: contract.totalAtto.toString() },
        });
        await prisma.transaction.create({
          data: { userId: req.user!.id, contractId: id, kind: "base_fund_escrow", txHash: fundTxHash, status: "CONFIRMED" },
        });
        if (c.providerId) await notify(c.providerId, "contract.funded", "Escrow funded",
          `Escrow for "${c.title}" is locked. Accept the contract to begin work.`, `/dashboard/contracts/${id}`);
      },
    });
  });

  app.post("/:id/accept", { preHandler: [writeLimit] }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return confirmAction<ChainContract>(req, reply, id, {
      allow: "provider", method: "get_contract", kind: "accept_contract",
      args: (cid) => [cid],
      predicate: (c) => c.status === "ACTIVE",
      after: async () => {
        const c = await prisma.contract.update({ where: { id }, data: { status: "ACTIVE" } });
        await notify(c.clientId, "contract.accepted", "Contract accepted",
          `The provider accepted "${c.title}". Work is underway.`, `/dashboard/contracts/${id}`);
      },
    });
  });

  app.post("/:id/cancel", { preHandler: [writeLimit] }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return confirmAction<ChainContract>(req, reply, id, {
      allow: "both", method: "get_contract", kind: "cancel_contract",
      args: (cid) => [cid],
      predicate: (c) => c.status === "CANCELLED",
      after: async () => {
        await prisma.contract.update({ where: { id }, data: { status: "CANCELLED" } });
      },
    });
  });

  // ---- deliverables ---------------------------------------------------
  app.post("/:id/milestones/:index/submit", { preHandler: [writeLimit] }, async (req, reply) => {
    const { id, index } = z.object({ id: z.string().uuid(), index: z.coerce.number().int().min(0) }).parse(req.params);
    const priorAttempts = await prisma.milestone
      .findUnique({ where: { contractId_index: { contractId: id, index } } })
      .then((m) => m?.attempts ?? 0);

    return confirmAction<ChainContract>(req, reply, id, {
      allow: "provider", method: "get_contract", kind: "submit_deliverable",
      args: (cid) => [cid],
      predicate: (c) => {
        const m = c.milestones?.[index];
        return !!m && m.status === "SUBMITTED" && m.attempts > priorAttempts;
      },
      after: async (c) => {
        const chainMilestone = c.milestones![index];
        const submission = chainMilestone.submission ?? { evidence_urls: [], notes: "", attempt: chainMilestone.attempts };
        const milestone = await prisma.milestone.update({
          where: { contractId_index: { contractId: id, index } },
          data: { status: "SUBMITTED", attempts: chainMilestone.attempts },
        });
        await prisma.deliverable.create({
          data: {
            milestoneId: milestone.id,
            submitterId: req.user!.id,
            evidenceUrls: submission.evidence_urls,
            notes: submission.notes,
            attempt: chainMilestone.attempts,
          },
        });
        const c2 = await prisma.contract.findUniqueOrThrow({ where: { id } });
        await notify(c2.clientId, "milestone.submitted", "Deliverable submitted",
          `A deliverable was submitted for "${milestone.title}". Trigger AI verification or approve manually.`,
          `/dashboard/contracts/${id}`);
      },
    });
  });

  app.post("/:id/milestones/:index/verify", { preHandler: [writeLimit] }, async (req, reply) => {
    const { id, index } = z.object({ id: z.string().uuid(), index: z.coerce.number().int().min(0) }).parse(req.params);
    const attemptsAtSubmit = await prisma.milestone
      .findUnique({ where: { contractId_index: { contractId: id, index } } })
      .then((m) => m?.attempts ?? 0);

    return confirmAction<ChainContract>(req, reply, id, {
      allow: "both", method: "get_contract", kind: "verify_deliverable",
      args: (cid) => [cid],
      // verify_deliverable never changes `attempts`; a fresh evaluation for
      // this exact submission attempt, with the milestone moved out of
      // SUBMITTED, is the signal the verdict was just recorded.
      predicate: (c) => {
        const m = c.milestones?.[index];
        return !!m && m.status !== "SUBMITTED" && m.last_evaluation?.attempt === attemptsAtSubmit;
      },
      // Verification can take a while (LLM calls under validator consensus).
      retries: 40,
      after: async (c) => {
        const chainMilestone = c.milestones![index];
        const verdict = chainMilestone.last_evaluation?.verdict ?? "unknown";
        const statusMap: Record<string, string> = {
          approved: "APPROVED", needs_revision: "NEEDS_REVISION", rejected: "REJECTED",
        };
        const milestone = await prisma.milestone.update({
          where: { contractId_index: { contractId: id, index } },
          data: { status: (statusMap[verdict] ?? chainMilestone.status) as never },
        });
        const deliverable = await prisma.deliverable.findFirst({
          where: { milestoneId: milestone.id }, orderBy: { createdAt: "desc" },
        });
        if (deliverable) {
          await prisma.aiEvaluation.create({
            data: { deliverableId: deliverable.id, verdict, score: chainMilestone.last_evaluation?.score ?? 0, reasoning: chainMilestone.last_evaluation?.reasoning ?? "See chain evaluation record" },
          });
        }
        const contractRow = await prisma.contract.findUniqueOrThrow({ where: { id } });
        for (const uid of [contractRow.clientId, contractRow.providerId].filter(Boolean) as string[]) {
          await notify(uid, "milestone.verified", `AI verdict: ${verdict}`,
            `Validator consensus returned "${verdict}" for milestone "${milestone.title}".`,
            `/dashboard/contracts/${id}`);
        }
      },
    });
  });

  app.post("/:id/milestones/:index/approve", { preHandler: [writeLimit] }, async (req, reply) => {
    const { id, index } = z.object({ id: z.string().uuid(), index: z.coerce.number().int().min(0) }).parse(req.params);
    return confirmAction<ChainContract>(req, reply, id, {
      allow: "client", method: "get_contract", kind: "approve_milestone",
      args: (cid) => [cid],
      predicate: (c) => c.milestones?.[index]?.status === "APPROVED",
      after: async () => {
        const m = await prisma.milestone.update({
          where: { contractId_index: { contractId: id, index } },
          data: { status: "APPROVED" },
        });
        const c = await prisma.contract.findUniqueOrThrow({ where: { id } });
        if (c.providerId) await notify(c.providerId, "milestone.approved", "Milestone approved",
          `"${m.title}" was approved — funds will be released to your wallet shortly.`, `/dashboard/contracts/${id}`);
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
    const priorDisputeCount = await prisma.dispute.count({ where: { contractId: id } });

    return confirmAction<ChainContract>(req, reply, id, {
      allow: "both", method: "get_contract", kind: "raise_dispute",
      args: (cid) => [cid],
      predicate: (c) => (c.disputes?.length ?? 0) > priorDisputeCount,
      after: async (c) => {
        const chainDispute = c.disputes![c.disputes!.length - 1];
        await prisma.contract.update({ where: { id }, data: { status: "DISPUTED" } });
        await prisma.dispute.create({
          data: {
            contractId: id,
            chainDisputeIndex: chainDispute.index,
            milestoneIndex: chainDispute.milestone_index,
            raisedById: req.user!.id,
            reason: chainDispute.reason,
            clientStatement: chainDispute.client_statement,
            providerStatement: chainDispute.provider_statement,
          },
        });
      },
    });
  });

  app.post("/:id/disputes/:disputeIndex/statement", { preHandler: [writeLimit] }, async (req, reply) => {
    const { id, disputeIndex } = z.object({ id: z.string().uuid(), disputeIndex: z.coerce.number().int().min(0) }).parse(req.params);
    const { statement } = z.object({ statement: z.string().min(1).max(2000) }).parse(req.body);
    const { isClient } = await loadParty(req, id);

    return confirmAction<ChainContract>(req, reply, id, {
      allow: "both", method: "get_contract", kind: "add_dispute_statement",
      args: (cid) => [cid],
      predicate: (c) => {
        const d = c.disputes?.[disputeIndex];
        if (!d) return false;
        return isClient ? d.client_statement === statement : d.provider_statement === statement;
      },
      after: async (c) => {
        const chainDispute = c.disputes![disputeIndex];
        await prisma.dispute.updateMany({
          where: { contractId: id, chainDisputeIndex: disputeIndex },
          data: { clientStatement: chainDispute.client_statement, providerStatement: chainDispute.provider_statement },
        });
      },
    });
  });

  app.post("/:id/disputes/:disputeIndex/resolve", { preHandler: [writeLimit] }, async (req, reply) => {
    const { id, disputeIndex } = z.object({ id: z.string().uuid(), disputeIndex: z.coerce.number().int().min(0) }).parse(req.params);
    return confirmAction<ChainContract>(req, reply, id, {
      allow: "both", method: "get_contract", kind: "resolve_dispute",
      args: (cid) => [cid],
      predicate: (c) => c.disputes?.[disputeIndex]?.status === "RESOLVED",
      // Resolution runs an LLM arbitration under validator consensus too.
      retries: 40,
      after: async (c) => {
        const chainDispute = c.disputes![disputeIndex];
        const resolution = chainDispute.resolution ?? undefined;
        await prisma.dispute.updateMany({
          where: { contractId: id, chainDisputeIndex: disputeIndex },
          data: {
            status: "RESOLVED",
            providerBps: resolution?.provider_bps ?? null,
            resolutionSummary: resolution?.summary ?? null,
            resolvedAt: new Date(),
          },
        });
        const milestone = c.milestones?.[chainDispute.milestone_index];
        if (milestone) {
          await prisma.milestone.update({
            where: { contractId_index: { contractId: id, index: chainDispute.milestone_index } },
            data: { status: milestone.status as never },
          });
        }
        await prisma.contract.update({ where: { id }, data: { status: c.status as never } });
      },
    });
  });

  // NOTE: the old /deposit and /withdraw endpoints have been removed — they
  // moved native GEN in/out of a GenLayer-held ledger, which is superseded
  // by USDC escrow on Base Sepolia. Funding now happens by the client
  // sending USDC to the escrow contract directly from their own wallet
  // (see contracts/base/DeliveraEscrow.sol — fundEscrow); payouts are
  // relayed by jobs/relay.ts once GenLayer records an approval/resolution.

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
