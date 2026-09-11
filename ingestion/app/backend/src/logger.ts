import pino from "pino";

/** Minimal surface the app needs; satisfied by both pino and Fastify loggers. */
export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export function createLogger(): Logger {
  return pino({ level: process.env.LOG_LEVEL ?? "info" });
}
