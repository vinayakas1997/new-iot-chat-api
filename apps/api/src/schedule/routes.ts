import type { FastifyInstance } from 'fastify';
import cronstrue from 'cronstrue';
import { z } from 'zod';
import { config } from '../config.js';
import { parseScheduleRequest } from './parse.js';
import { toCronExpr } from './cron.js';
import {
  createSchedule,
  deleteSchedule,
  listSchedules,
  setScheduleActive,
} from './store.js';

const PreviewBody = z.object({
  message: z.string().min(1),
  timezone: z.string().optional(),
  lineId: z.string().min(1).optional(),
});
const CreateBody = z.union([
  z.object({ message: z.string().min(1), timezone: z.string().optional(), lineId: z.string().min(1).optional() }),
  z.object({
    heading: z.string().min(1).max(120).optional(),
    queryText: z.string().min(1),
    lineId: z.string().min(1).optional(),
    timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timezone: z.string().min(1).optional(),
    recurrence: z.enum(['daily', 'weekdays', 'weekly', 'once', 'hourly']),
    weekday: z.number().int().min(0).max(6).optional(),
    onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
]);
const ActiveBody = z.object({ active: z.boolean() });

export async function scheduleRoutes(app: FastifyInstance) {
    // Parse-only: UI shows the interpreted schedule for confirmation before saving.
  app.post('/schedules/preview', { preHandler: app.requireUser }, async (req, reply) => {
    const body = req.body as any;
    // Advanced create panel can preview with structured fields directly (no LLM)
    if (body?.queryText && body?.timeOfDay && body?.recurrence) {
      const { ParsedSchedule } = await import('@app/shared');
      const v = ParsedSchedule.safeParse({ timezone: config.plant.tz, ...body, heading: body.heading });
      if (v.success) {
        const cronExpr = toCronExpr(v.data);
        return { parsed: v.data, cronExpr, humanCron: safeCronText({ ...v.data, cronExpr }) };
      }
    }
    const parsed = PreviewBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'message required' });
    const p = await parseScheduleRequest(parsed.data.message, parsed.data.timezone, parsed.data.lineId);
    const cronExpr = toCronExpr(p);
    return { parsed: p, cronExpr, humanCron: safeCronText({ ...p, cronExpr }) };
  });

  app.get('/schedules', { preHandler: app.requireUser }, async (req) => {
    return { schedules: await listSchedules(req.user!.userId) };
  });

  app.post('/schedules', { preHandler: app.requireUser }, async (req, reply) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'message or structured schedule required', details: parsed.error.issues });
    let p;
    if ('message' in parsed.data) {
      p = await parseScheduleRequest(parsed.data.message, parsed.data.timezone, parsed.data.lineId);
    } else {
      // structured picker — validate via ParsedSchedule directly
      const { ParsedSchedule } = await import('@app/shared');
      const v = ParsedSchedule.safeParse({ timezone: config.plant.tz, ...parsed.data });
      if (!v.success) return reply.code(400).send({ error: 'invalid schedule', details: v.error.issues });
      p = v.data;
    }
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
