import { Redis } from "ioredis";
import { config } from "../config.js";
import { logger } from "./logger.js";

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 2,
  lazyConnect: false,
  tls: config.REDIS_URL.startsWith("rediss://") ? {} : undefined,
});

redis.on("error", (err) => logger.warn({ err: err.message }, "redis error"));

/** Cache helper: JSON get-or-compute with TTL. Fails open on Redis errors. */
export async function cached<T>(key: string, ttlSec: number, compute: () => Promise<T>): Promise<T> {
  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    /* fail open */
  }
  const value = await compute();
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSec);
  } catch {
    /* fail open */
  }
  return value;
}

export async function invalidate(prefix: string): Promise<void> {
  try {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length) await redis.del(...keys);
  } catch {
    /* fail open */
  }
}
