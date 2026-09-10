import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { historyDays, historyForRange } from './store.js';

const RangeQuery = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

export async function historyRoutes(app: FastifyInstance) {
  app.get('/history', { preHandler: app.requireUser }, async (req, reply) => {
    const parsed = RangeQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'from/to ISO datetimes required' });
    const rows = await historyForRange(req.user!.userId, parsed.data.from, parsed.data.to);
    return rows.map((r) => ({
      id: r.id,
      source: r.source,
      question: r.question,
      answer: r.answer,
      scheduleId: r.scheduleId,
      createdAt: r.createdAt.toISOString(),
    }));
  });

  app.get('/history/days', { preHandler: app.requireUser }, async (req) => {
    return { days: await historyDays(req.user!.userId) };
  });
}
