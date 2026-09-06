import type { FastifyInstance } from 'fastify';
import cronstrue from 'cronstrue';
import { z } from 'zod';
import { parseScheduleRequest } from './parse.js';
import { toCronExpr } from './cron.js';
import {
  createSchedule,
  deleteSchedule,
  listSchedules,
  setScheduleActive,
} from './store.js';

const PreviewBody = z.object({ message: z.string().min(1), timezone: z.string().optional() });
const CreateBody = z.object({ message: z.string().min(1), timezone: z.string().optional() });
const ActiveBody = z.object({ active: z.boolean() });

export async function scheduleRoutes(app: FastifyInstance) {
  // Parse-only: UI shows the interpreted schedule for confirmation before saving.
  app.post('/schedules/preview', { preHandler: app.requireUser }, async (req, reply) => {
    const parsed = PreviewBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'message required' });
    const p = await parseScheduleRequest(parsed.data.message, parsed.data.timezone);
    const cronExpr = toCronExpr(p);
    return { parsed: p, cronExpr, humanCron: safeCronText({ ...p, cronExpr }) };
  });

  app.get('/schedules', { preHandler: app.requireUser }, async (req) => {
    return { schedules: await listSchedules(req.user!.userId) };
  });

  app.post('/schedules', { preHandler: app.requireUser }, async (req, reply) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'message required' });
    const p = await parseScheduleRequest(parsed.data.message, parsed.data.timezone);
    return { schedule: await createSchedule(req.user!.userId, p) };
  });

  app.patch('/schedules/:id', { preHandler: app.requireUser }, async (req, reply) => {
    const parsed = ActiveBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'active:boolean required' });
    const s = await setScheduleActive(
      req.user!.userId,
      (req.params as { id: string }).id,
      parsed.data.active,
    );
    if (!s) return reply.code(404).send({ error: 'not found' });
    return { schedule: s };
  });

  app.delete('/schedules/:id', { preHandler: app.requireUser }, async (req, reply) => {
    const ok = await deleteSchedule(req.user!.userId, (req.params as { id: string }).id);
    if (!ok) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  });
}

function safeCronText(p: { cronExpr?: string; timeOfDay: string; recurrence: string }) {
  try {
    return cronstrue.toString(
      p.cronExpr ?? `${p.timeOfDay.split(':')[1]} ${p.timeOfDay.split(':')[0]} * * *`,
    );
  } catch {
    return `${p.recurrence} at ${p.timeOfDay}`;
  }
}
