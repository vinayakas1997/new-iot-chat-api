import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createSchedule, deleteSchedule, getSchedule, listSchedules, updateSchedule } from "../db/store.js";

const scheduleInput = z.object({
  name: z.string().min(1).max(120),
  lineId: z.string().min(1).max(80),
  questions: z.array(z.string().min(1).max(500)).min(1).max(10),
  format: z.enum(["headline", "kpi", "table"]).default("headline"),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(), // "08:30" daily
  cron: z.string().max(100).optional(),
  timezone: z.string().max(80).default("Asia/Kolkata"),
  enabled: z.boolean().optional(),
});

function timeToCron(time: string): string {
  const [hh, mm] = time.split(":").map(Number);
  return `${mm} ${hh} * * *`;
}

export async function scheduleRoutes(app: FastifyInstance) {
  app.get("/api/rag/schedules", async () => listSchedules());

  app.post("/api/rag/schedules", async (req, reply) => {
    const p = scheduleInput.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    const cron = p.data.cron ?? (p.data.time ? timeToCron(p.data.time) : "30 8 * * *");
    return reply.code(201).send(createSchedule({ ...p.data, cron }));
  });

  app.patch("/api/rag/schedules/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = scheduleInput.partial().safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    const patch: Record<string, unknown> = { ...p.data };
    if (p.data.time && !p.data.cron) patch.cron = timeToCron(p.data.time);
    delete patch.time;
    const s = updateSchedule(id, patch as Parameters<typeof updateSchedule>[1]);
    if (!s) return reply.code(404).send({ error: "not found" });
    return s;
  });

  app.delete("/api/rag/schedules/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deleteSchedule(id)) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });

  app.post("/api/rag/schedules/:id/run", async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = getSchedule(id);
    if (!s) return reply.code(404).send({ error: "not found" });
    const { runScheduleNow } = await import("../scheduler.js");
    try {
      const report = await runScheduleNow(id);
      return report;
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });
}
