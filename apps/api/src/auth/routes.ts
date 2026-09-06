import { Credentials } from '@app/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { getAppDb } from '../db/app/client.js';
import { themes, users } from '../db/app/schema.js';
import { verifyPassword } from './password.js';
import { cookieOptions, issueSession, readSession } from './session.js';

export async function authRoutes(app: FastifyInstance) {
  const db = getAppDb();

  app.post('/auth/login', async (req, reply) => {
    const parsed = Credentials.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body' });

    const { username, password } = parsed.data;
    const [row] = await db.select().from(users).where(eq(users.username, username)).limit(1);
    // Verify even when the user is missing to keep timing roughly constant.
    const ok = row
      ? await verifyPassword(row.passwordHash, password)
      : await verifyPassword('$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAA', password);
    if (!row || !ok) return reply.code(401).send({ error: 'invalid credentials' });

    const token = await issueSession({ sub: row.id, username: row.username, aud: 'user' });
    reply.setCookie(config.auth.cookieName, token, cookieOptions());
    return { userId: row.id, username: row.username };
  });

  app.post('/auth/logout', async (_req, reply) => {
    reply.clearCookie(config.auth.cookieName, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', async (req, reply) => {
    const token = req.cookies[config.auth.cookieName];
    const claims = token ? await readSession(token, 'user') : null;
    if (!claims) return reply.code(401).send({ error: 'unauthorized' });

    const [theme] = await db
      .select({ theme: themes.theme })
      .from(themes)
      .where(eq(themes.userId, claims.sub))
      .limit(1);
    return { userId: claims.sub, username: claims.username, theme: theme?.theme ?? 'system' };
  });
}
