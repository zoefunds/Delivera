/** Wallet routes: read-only GenLayer GEN balance for the caller's own
 * connected wallet.
 *
 * There is no custodial wallet anymore — the same wallet address used for
 * login (see routes/auth.ts) and Base Sepolia funding is now also the
 * GenLayer identity, and every GenLayer write is signed by the user
 * themselves in the browser. This backend never holds or exports a private
 * key belonging to a user.
 */
import type { FastifyInstance } from "fastify";
import { requireAuth } from "../plugins/auth.js";
import { contractConfigured, readContract } from "../lib/genlayer.js";

export async function walletRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/", async (req) => {
    const address = req.user!.walletAddress;
    let onchainBalanceAtto: string | null = null;
    if (address && contractConfigured()) {
      try {
        onchainBalanceAtto = String(await readContract("get_balance", [address]));
      } catch {
        onchainBalanceAtto = null;
      }
    }
    return { address, onchainBalanceAtto };
  });
}
