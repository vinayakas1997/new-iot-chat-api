import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { closeTicket, getTicket, listTickets, openTicket } from "../db/store.js";

/**
 * Line 360° sidebar backend (P3 routes, UI later): manual open from a
 * reading/run row, close with a human note, list per line + status.
 * Auto-open on breach readings stays a P4 job; the dedupe guard in
 * openTicket already makes it idempotent for that future.
 */
export async function ticketRoutes(app: FastifyInstance) {
  app.post("/api/ingest/tickets/open", async (req, reply) => {
    const p = z
      .object({
        lineId: z.string().min(1).max(128),
        cardId: z.string().max(128).optional(),
        readingId: z.number().int().positive().optional(),
        runId: z.number().int().positive().optional(),
        title: z.string().max(200).optional(),
      })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    if (p.data.readingId == null && p.data.runId == null) {
      return reply.code(400).send({ error: "readingId or runId required — tickets anchor to evidence" });
    }
    const r = openTicket(p.data);
    return { id: r.id, deduped: r.deduped, ticket: getTicket(r.id) };
  });

  app.post("/api/ingest/tickets/:id/close", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = z.object({ note: z.string().max(1000).default("") }).safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    const ok = closeTicket(Number(id), p.data.note);
    if (!ok) return reply.code(404).send({ error: "ticket not found or already closed" });
    return { id: Number(id), ticket: getTicket(Number(id)) };
  });

  app.get("/api/ingest/tickets", async (req) => {
    const p = z
      .object({
        line: z.string().max(128).optional(),
        status: z.enum(["open", "closed", "all"]).default("open"),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .safeParse(req.query);
    if (!p.success) return { rows: [], total: 0, open: 0, error: p.error.message };
    return listTickets({ lineId: p.data.line, status: p.data.status, limit: p.data.limit, offset: p.data.offset });
  });

  app.get("/api/ingest/tickets/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = getTicket(Number(id));
    if (!t) return reply.code(404).send({ error: "ticket not found" });
    return t;
  });
}
