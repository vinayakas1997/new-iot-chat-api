import { Theme } from '@app/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getAppDb } from '../db/app/client.js';
import { themes } from '../db/app/schema.js';

export async function settingsRoutes(app: FastifyInstance) {
  const db = getAppDb();

  app.get('/settings/theme', { preHandler: app.requireUser }, async (req) => {
    const [row] = await db
      .select({ theme: themes.theme })
      .from(themes)
      .where(eq(themes.userId, req.user!.userId))
      .limit(1);
    return { theme: row?.theme ?? 'system' };
  });

  app.put('/settings/theme', { preHandler: app.requireUser }, async (req, reply) => {
    const parsed = z.object({ theme: Theme }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'theme must be system|light|dark' });
    await db
      .insert(themes)
      .values({ userId: req.user!.userId, theme: parsed.data.theme })
      .onConflictDoUpdate({
        target: themes.userId,
        set: { theme: parsed.data.theme, updatedAt: new Date() },
      });
    return { theme: parsed.data.theme };
  });
}
