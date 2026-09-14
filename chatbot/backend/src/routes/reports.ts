import type { FastifyInstance } from "fastify";
import { getReport, listReports } from "../db/store.js";

export async function reportRoutes(app: FastifyInstance) {
  app.get("/api/rag/reports", async (req) => {
    const q = req.query as { scheduleId?: string; date?: string; limit?: string };
    return listReports(q.scheduleId, q.date, q.limit ? Number(q.limit) : 60);
  });
  app.get("/api/rag/reports/:id", async (req, reply) => {
    const r = getReport(Number((req.params as { id: string }).id));
    if (!r) return reply.code(404).send({ error: "not found" });
    return r;
  });
}
