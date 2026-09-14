/** JWT auth: access token verification + preHandler guard. */
import jwt from "jsonwebtoken";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";

export interface AuthUser {
  id: string;
  walletAddress: string;
  email: string | null;
  role: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export function signAccessToken(user: AuthUser): string {
  return jwt.sign(
    { sub: user.id, walletAddress: user.walletAddress, email: user.email, role: user.role },
    config.JWT_SECRET,
    { expiresIn: config.ACCESS_TOKEN_TTL_SEC, issuer: "delivera" },
  );
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Missing bearer token" } });
  }
  try {
    const payload = jwt.verify(header.slice(7), config.JWT_SECRET, { issuer: "delivera" }) as jwt.JwtPayload;
    req.user = {
      id: String(payload.sub),
      walletAddress: String(payload.walletAddress),
      email: payload.email ? String(payload.email) : null,
      role: String(payload.role),
    };
  } catch {
    return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Invalid or expired token" } });
  }
}
