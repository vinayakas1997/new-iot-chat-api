import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createColumnTemplate, deleteColumnTemplate, listColumnTemplates } from "../db/store.js";

export async function columnTemplateRoutes(app: FastifyInstance) {
  app.get("/api/ingest/column-templates", async () => listColumnTemplates());

  app.post("/api/ingest/column-templates", async (req, reply) => {
    const parsed = z.object({
      name: z.string().min(1).max(80),
      columns: z.array(z.object({ name: z.string().min(1), meaning: z.string().max(500), datatype: z.string().default("") })).min(1),
    }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      return reply.code(201).send(createColumnTemplate(parsed.data.name, parsed.data.columns));
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message });
    }
  });

  app.delete("/api/ingest/column-templates/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deleteColumnTemplate(id)) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });
}
