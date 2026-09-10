import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { verifyPassword } from '../auth/password.js';
import { cookieOptions, issueSession, readSession } from '../auth/session.js';
import { logger } from '../logger.js';
import { createLine, deleteLine, listLines, updateLine } from '../lines/store.js';
import {
  getAllJobStatus,
  getSchedulerOverview,
  recentRuns,
} from './queries.js';

const OpsLogin = z.object({ username: z.string(), password: z.string() });
const LineCreate = z.object({
  name: z.string().min(1).max(64),
  displayName: z.string().max(128).optional(),
  sortOrder: z.number().int().optional(),
});
const LinePatch = z.object({
  displayName: z.string().max(128).nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export async function opsRoutes(app: FastifyInstance) {
  app.post('/ops/login', async (req, reply) => {
    if (!config.ops.enabled) return reply.code(503).send({ error: 'ops UI disabled (no OPS_PASSWORD_HASH)' });
    const parsed = OpsLogin.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body' });
    const { username, password } = parsed.data;
    const ok =
      username === config.ops.username && (await verifyPassword(config.ops.passwordHash, password));
    if (!ok) return reply.code(401).send({ error: 'invalid credentials' });
    const token = await issueSession({ sub: username, username, aud: 'ops' });
    reply.setCookie(config.ops.cookieName, token, cookieOptions());
    return { username };
  });

  app.post('/ops/logout', async (_req, reply) => {
    reply.clearCookie(config.ops.cookieName, { path: '/' });
    return { ok: true };
  });

  app.get('/ops/me', async (req, reply) => {
    const token = req.cookies[config.ops.cookieName];
    const claims = token ? await readSession(token, 'ops') : null;
    if (!claims) return reply.code(401).send({ error: 'unauthorized' });
    return { username: claims.username };
  });

  app.get('/ops/jobs', { preHandler: app.requireOps }, async () => {
    return { jobs: await getAllJobStatus() };
  });

  app.get('/ops/jobs/:name/runs', { preHandler: app.requireOps }, async (req, reply) => {
    const name = (req.params as { name: string }).name;
    if (name !== 'ingest' && name !== 'scheduler')
      return reply.code(400).send({ error: 'unknown job' });
    return { runs: await recentRuns(name) };
  });

  app.get('/ops/schedules', { preHandler: app.requireOps }, async () => {
    return { schedules: await getSchedulerOverview() };
  });

  // Lines registry (ops-managed; users read active lines via GET /lines).
  app.get('/ops/lines', { preHandler: app.requireOps }, async () => {
    return { lines: await listLines(false) };
  });

  app.post('/ops/lines', { preHandler: app.requireOps }, async (req, reply) => {
    const parsed = LineCreate.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body' });
    try {
      return { line: await createLine(parsed.data) };
    } catch {
      return reply.code(409).send({ error: 'line name already exists' });
    }
  });

  app.patch('/ops/lines/:id', { preHandler: app.requireOps }, async (req, reply) => {
    const parsed = LinePatch.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body' });
    const line = await updateLine((req.params as { id: string }).id, parsed.data);
    if (!line) return reply.code(404).send({ error: 'not found' });
    return { line };
  });

  app.delete('/ops/lines/:id', { preHandler: app.requireOps }, async (req, reply) => {
    const ok = await deleteLine((req.params as { id: string }).id);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  });

  // "retry failed batch" — kick off a one-shot ingestion run as a detached child.
  app.post('/ops/ingest/run', { preHandler: app.requireOps }, async (_req, reply) => {
    const entry = fileURLToPath(new URL('../../../ingest/src/index.ts', import.meta.url));
    try {
      const child = spawn(process.execPath, ['--import', 'tsx', entry], {
        cwd: fileURLToPath(new URL('../../..', import.meta.url)),
        detached: true,
        stdio: 'ignore',
        env: process.env,
      });
      child.unref();
      logger.info({ pid: child.pid }, 'ops triggered ingestion run');
      return { started: true, pid: child.pid };
    } catch (err) {
      logger.error({ err }, 'failed to spawn ingestion');
      return reply.code(500).send({ error: 'failed to start ingestion' });
    }
  });
}
