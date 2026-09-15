import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getLlmCall, listLlmCalls, llmCallStats } from "../db/store.js";

/**
 * F6 AI Logs: every llmChatJson call (success or failure) lands in
 * llm_calls with its tries timeline, prompt, response and reason.
 * Read-only; recording happens inside the shared client, never here.
 */
export async function llmCallRoutes(app: FastifyInstance) {
  app.get("/api/ingest/llm/calls/stats", async () => llmCallStats());

  app.get("/api/ingest/llm/calls", async (req) => {
    const p = z
      .object({
        route: z.string().max(64).optional(),
        line: z.string().max(128).optional(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        ok: z.enum(["true", "false", "all"]).default("all"),
        q: z.string().max(100).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .safeParse(req.query);
    if (!p.success) return { rows: [], total: 0, error: p.error.message };
    const { rows, total } = listLlmCalls({
      route: p.data.route || undefined,
      lineId: p.data.line || undefined,
      date: p.data.date,
      ok: p.data.ok === "all" ? undefined : p.data.ok === "true",
      q: p.data.q || undefined,
      limit: p.data.limit,
      offset: p.data.offset,
    });
    return { rows, total };
  });

  app.get("/api/ingest/llm/calls/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = getLlmCall(Number(id));
    if (!row) return reply.code(404).send({ error: "log entry not found" });
    return row;
  });
}
