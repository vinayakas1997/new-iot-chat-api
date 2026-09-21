import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createGraphSpec, deleteGraph, getCard, getGraph, listGraphsForCard, updateGraphSpec, type ChartType } from "../db/store.js";

const chartTypes = z.enum(["table", "line", "bar", "area", "histogram"]);

const graphInput = z.object({
  name: z.string().max(120).default(""),
  chartType: chartTypes.default("table"),
  xColumn: z.string().default(""),
  yColumns: z.array(z.string()).default([]),
  title: z.string().max(200).default(""),
  config: z.record(z.unknown()).default({}),
});

export async function graphRoutes(app: FastifyInstance) {
  /** List graph specs for a card. */
  app.get("/api/ingest/cards/:cardId/graphs", async (req, reply) => {
    const { cardId } = req.params as { cardId: string };
    const card = getCard(cardId);
    if (!card) return reply.code(404).send({ error: "card not found" });
    return listGraphsForCard(cardId);
  });

  /** Create a graph spec for a card. */
  app.post("/api/ingest/cards/:cardId/graphs", async (req, reply) => {
    const { cardId } = req.params as { cardId: string };
    const card = getCard(cardId);
    if (!card) return reply.code(404).send({ error: "card not found" });
    const p = graphInput.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    return reply.code(201).send(createGraphSpec({ cardId, ...p.data }));
  });

  /** Update a graph spec. */
  app.patch("/api/ingest/graphs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = graphInput.partial().safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    const g = updateGraphSpec(id, p.data);
    if (!g) return reply.code(404).send({ error: "not found" });
    return g;
  });

  /** Delete a graph spec. */
  app.delete("/api/ingest/graphs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deleteGraph(id)) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });
}
