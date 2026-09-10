/**
 * Single source of truth for environment config. Parsed once at boot; the
 * process refuses to start on invalid config (fail fast, not fail obscure).
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Load .env from the app dir first, then fall back to the monorepo root so a
// single root .env works no matter which app/job process is starting.
for (const rel of ['../.env', '../../../.env']) {
  const path = fileURLToPath(new URL(rel, import.meta.url));
  if (existsSync(path)) loadDotenv({ path });
}
loadDotenv(); // also honour process.cwd()/.env if present

const csv = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

const Schema = z
  .object({
    RUNTIME_MODE: z.enum(['mock', 'live']).default('mock'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    API_PORT: z.coerce.number().int().positive().default(3001),
    API_CORS_ORIGIN: z.string().default('http://localhost:5173,http://localhost:5174'),

    PLANT_TZ: z.string().min(1).default('Asia/Tokyo'),
    PLANT_ID: z.string().min(1).default('vina-plant'),

    MACHINE_DATABASE_URL: z.string().default(''),
    MACHINE_DB_POOL_MAX: z.coerce.number().int().positive().default(5),
    MACHINE_DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
    MACHINE_DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),

    APP_DATABASE_URL: z.string().min(1, 'APP_DATABASE_URL is always required'),
    APP_DB_POOL_MAX: z.coerce.number().int().positive().default(10),

    HINDSIGHT_API_URL: z.string().default('http://localhost:8888'),
    HINDSIGHT_LLM_API_KEY: z.string().default(''),
    HINDSIGHT_BANK_SCHEME: z.enum(['per-line', 'per-machine', 'per-plant']).default('per-line'),

    ANTHROPIC_API_KEY: z.string().default(''),
    CHAT_MODEL: z.string().default('claude-sonnet-5'),

    AUTH_JWT_SECRET: z.string().min(16, 'AUTH_JWT_SECRET must be at least 16 chars'),
    AUTH_COOKIE_NAME: z.string().default('irs_session'),
    AUTH_SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),

    OPS_USERNAME: z.string().default('builder'),
    OPS_PASSWORD_HASH: z.string().default(''),
    OPS_COOKIE_NAME: z.string().default('irs_ops_session'),

    SMTP_URL: z.string().default(''),
    REPORT_WEBHOOK_URL: z.string().default(''),
  })
  .superRefine((v, ctx) => {
    if (v.RUNTIME_MODE === 'live') {
      if (!v.MACHINE_DATABASE_URL)
        ctx.addIssue({ code: 'custom', path: ['MACHINE_DATABASE_URL'], message: 'required in live mode' });
      if (!v.ANTHROPIC_API_KEY)
        ctx.addIssue({ code: 'custom', path: ['ANTHROPIC_API_KEY'], message: 'required in live mode' });
      if (!v.HINDSIGHT_LLM_API_KEY)
        ctx.addIssue({ code: 'custom', path: ['HINDSIGHT_LLM_API_KEY'], message: 'required in live mode' });
    }
  });

const parsed = Schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid configuration:\n' + parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}

const env = parsed.data;

export const config = {
  runtimeMode: env.RUNTIME_MODE,
  nodeEnv: env.NODE_ENV,
  logLevel: env.LOG_LEVEL,
  isMock: env.RUNTIME_MODE === 'mock',

  api: {
    port: env.API_PORT,
    corsOrigins: csv(env.API_CORS_ORIGIN),
  },

  plant: {
    tz: env.PLANT_TZ,
    id: env.PLANT_ID,
  },

  machineDb: {
    url: env.MACHINE_DATABASE_URL,
    poolMax: env.MACHINE_DB_POOL_MAX,
    statementTimeoutMs: env.MACHINE_DB_STATEMENT_TIMEOUT_MS,
    connectTimeoutMs: env.MACHINE_DB_CONNECT_TIMEOUT_MS,
  },

  appDb: {
    url: env.APP_DATABASE_URL,
    poolMax: env.APP_DB_POOL_MAX,
  },

  hindsight: {
    apiUrl: env.HINDSIGHT_API_URL,
    llmApiKey: env.HINDSIGHT_LLM_API_KEY,
    bankScheme: env.HINDSIGHT_BANK_SCHEME,
  },

  chat: {
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    model: env.CHAT_MODEL,
  },

  auth: {
    jwtSecret: env.AUTH_JWT_SECRET,
    cookieName: env.AUTH_COOKIE_NAME,
    sessionTtlDays: env.AUTH_SESSION_TTL_DAYS,
  },

  ops: {
    username: env.OPS_USERNAME,
    passwordHash: env.OPS_PASSWORD_HASH,
    cookieName: env.OPS_COOKIE_NAME,
    enabled: env.OPS_PASSWORD_HASH.length > 0,
  },

  delivery: {
    smtpUrl: env.SMTP_URL,
    webhookUrl: env.REPORT_WEBHOOK_URL,
  },
} as const;

export type AppConfig = typeof config;
