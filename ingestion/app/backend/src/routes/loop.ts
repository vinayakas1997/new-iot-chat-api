import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { proposeQuestions } from "../loop/propose.js";

/**
 * Autonomous loop routes (Step 1: generator).
 * The user never asks — the loop proposes its own questions from bank state.
 * Solver = playground ask; validator = Gate-2 verdicts; filing = tickets API.
 */
export async function loopRoutes(app: FastifyInstance) {
  app.post("/api/ingest/loop/propose", async (req, reply) => {
    const p = z.object({
      lineId: z.string().min(1).max(128),
      max: z.number().int().min(1).max(20).default(5),
    }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    try {
      return { ...proposeQuestions(p.data.lineId, { max: p.data.max }), generator: "rules-v1" };
    } catch (e) {
      return reply.code(404).send({ error: (e as Error).message });
    }
  });
}
