/** Sliding-window rate limiting on Upstash Redis. Fails open if Redis is down. */
import type { FastifyReply, FastifyRequest } from "fastify";
import { redis } from "../lib/redis.js";

export function rateLimit(opts: { max: number; windowSec: number; keyPrefix: string }) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const identity = req.user?.id ?? req.ip;
    const key = `rl:${opts.keyPrefix}:${identity}`;
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, opts.windowSec);
      if (count > opts.max) {
        return reply.code(429).send({
          error: { code: "RATE_LIMITED", message: "Too many requests, slow down." },
        });
      }
    } catch {
      /* fail open */
    }
  };
}
