import pino from "pino";
import { isProd } from "../config.js";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? "info" : "debug"),
  redact: ["req.headers.authorization", "*.password", "*.privateKey", "*.token"],
});
