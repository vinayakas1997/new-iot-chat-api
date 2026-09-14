import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  activateCard,
  cardEvents,
  copiesOfTemplate,
  createCard,
  createTemplate,
  deleteCard,
  deleteTemplate,
  dormCard,
  getCard,
  getLine,
  getTemplate,
  instantiateTemplate,
  listCards,
  listTemplates,
  recordCardTest,
  recordRun,
  sqlHash,
  updateCard,
  updateTemplate,
  type Granularity,
} from "../db/store.js";
import { assertReadonly, driverFor } from "../drivers/index.js";
import { getConnection } from "../db/store.js";

const gran = z.enum(["hourly", "shift", "daily"]);

const tplSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(""),
  referenceLineId: z.string().min(1).nullable().default(null),
  sqlTemplate: z.string().default(""),
  granularity: gran.default("hourly"),
  unit: z.string().max(20).default(""),
  extractHint: z.string().max(2000).default(""),
});

const cardSchema = z.object({
  lineId: z.string().min(1),
  name: z.string().min(1).max(120),
  tables: z.array(z.string().min(1)).default([]),
  sql: z.string().default(""),
  granularity: gran.default("hourly"),
  unit: z.string().max(20).default(""),
  extractHint: z.string().max(2000).default(""),
  threshold: z.number().nullable().default(null),
  templateId: z.string().nullable().default(null),
});

/**
 * Windowed test-run (F3 lock): {{from}}/{{to}} placeholders in the SQL are
 * substituted (ISO timestamps, default = last 24h), then executed read-only.
 * Never writes to any bank.
 */
export async function runCardTest(
  cardId: string,
  from?: string,
  to?: string
): Promise<{ columns: string[]; rows: Record<string, unknown>[]; rowCount: number; sql: string }> {
  const card = getCard(cardId);
  if (!card) throw new Error("card not found");
  const line = getLine(card.lineId);
  if (!line) throw new Error("line not found");
  const conn = getConnection(line.connectionId);
  if (!conn) throw new Error("connection not found");
  const end = to ?? new Date().toISOString();
  const start = from ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const sql = card.sql.replaceAll("{{from}}", start).replaceAll("{{to}}", end);
  assertReadonly(sql);
  const rows = await driverFor(conn).queryReadonly<Record<string, unknown>>(conn, sql);
  return { columns: rows.length > 0 ? Object.keys(rows[0]) : [], rows: rows.slice(0, 50), rowCount: rows.length, sql };
}

export async function cardRoutes(app: FastifyInstance) {
  // ---- templates ----
  app.get("/api/ingest/templates", async () => listTemplates());
  app.post("/api/ingest/templates", async (req, reply) => {
    const p = tplSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    return reply.code(201).send(createTemplate(p.data));
  });
  app.patch("/api/ingest/templates/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = tplSchema.partial().safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    const t = updateTemplate(id, p.data);
    if (!t) return reply.code(404).send({ error: "not found" });
    return t;
  });
  app.delete("/api/ingest/templates/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deleteTemplate(id)) return reply.code(404).send({ error: "not found" });
    return { ok: true };
  });
  app.post("/api/ingest/templates/:id/instantiate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = z.object({
      lineId: z.string().min(1),
      name: z.string().min(1).max(120).optional(),
      tables: z.array(z.string().min(1)).optional(),
      sql: z.string().optional(),
    }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    try {
      return reply.code(201).send(instantiateTemplate(id, p.data.lineId, p.data));
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message });
    }
  });

  /**
   * Bulk re-apply (F3 lock): push SQL (explicit or the template's current) to
   * all copies, test each line individually. Greens can flip live at once;
   * reds block only themselves; live copies are skipped, never touched.
   */
  app.post("/api/ingest/templates/:id/reapply", async (req, reply) => {
    const { id } = req.params as { id: string };
    const tpl = getTemplate(id);
    if (!tpl) return reply.code(404).send({ error: "not found" });
    const p = z.object({
      sql: z.string().optional(),
      activate: z.boolean().default(false),
      changeMode: z.enum(["forward", "reingest"]).default("forward"),
      reingestFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      cardIds: z.array(z.string().min(1)).optional(),
      lineId: z.string().min(1).optional(),
    }).safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    const sql = p.data.sql ?? tpl.sqlTemplate;
    const onlyIds = p.data.cardIds ? new Set(p.data.cardIds) : null;
    const results = [];
    for (const copy of copiesOfTemplate(id)) {
      if (onlyIds && !onlyIds.has(copy.id)) continue;
      if (p.data.lineId && copy.lineId !== p.data.lineId) continue;
      if (copy.status === "live") {
        results.push({ cardId: copy.id, lineId: copy.lineId, status: "skipped-live" as const });
        continue;
      }
      try {
        updateCard(copy.id, { sql }, { mode: p.data.changeMode, reingestFrom: p.data.reingestFrom });
        const t = await runCardTest(copy.id);
        recordCardTest(copy.id, true, getCard(copy.id)?.sql ?? "", null);
        if (p.data.activate) activateCard(copy.id);
        results.push({ cardId: copy.id, lineId: copy.lineId, status: "green" as const, rowCount: t.rowCount });
      } catch (e) {
        recordCardTest(copy.id, false, sql, (e as Error).message);
        results.push({ cardId: copy.id, lineId: copy.lineId, status: "red" as const, error: (e as Error).message });
      }
    }
    return { templateId: id, templateVersion: tpl.version, sqlHash: sqlHash(sql), results };
  });

  // ---- cards ----
  app.get("/api/ingest/cards", async (req) => {
    const { lineId } = req.query as { lineId?: string };
    return listCards(lineId);
  });
  app.post("/api/ingest/cards", async (req, reply) => {
    const p = cardSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    try {
      return reply.code(201).send(createCard({ ...p.data, granularity: p.data.granularity as Granularity }));
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message });
    }
  });
  app.get("/api/ingest/cards/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = getCard(id);
    if (!c) return reply.code(404).send({ error: "not found" });
    return { ...c, events: cardEvents(id) };
  });
  app.patch("/api/ingest/cards/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = cardSchema.partial().extend({
      changeMode: z.enum(["forward", "reingest"]).default("forward"),
      reingestFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    try {
      const { changeMode, reingestFrom, ...patch } = p.data;
      const c = updateCard(id, patch, { mode: changeMode, reingestFrom });
      if (!c) return reply.code(404).send({ error: "not found" });
      return c;
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message });
    }
  });
  app.delete("/api/ingest/cards/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      if (!deleteCard(id)) return reply.code(404).send({ error: "not found" });
      return { ok: true };
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message });
    }
  });
  app.post("/api/ingest/cards/:id/test", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = z.object({ from: z.string().optional(), to: z.string().optional() }).safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    const started = Date.now();
    try {
      const t = await runCardTest(id, p.data.from, p.data.to);
      const card = getCard(id)!;
      // Hash the RAW card SQL (with {{from}}/{{to}} intact): the substituted
      // window changes every run, but the definition is what the guard checks.
      recordCardTest(id, true, card.sql, null);
      // F4: every test-run is footprinted in the run log (kind=test).
      recordRun({
        at: new Date().toISOString(), lineId: card.lineId, cardId: id,
        cardVersion: card.version, kind: "test", ok: true,
        rowsPulled: t.rowCount, unitsBuilt: t.rowCount, factsStored: 0,
        durationMs: Date.now() - started, error: null,
      });
      return t;
    } catch (e) {
      const card = getCard(id);
      recordCardTest(id, false, card?.sql ?? "", (e as Error).message);
      if (card) {
        recordRun({
          at: new Date().toISOString(), lineId: card.lineId, cardId: id,
          cardVersion: card.version, kind: "test", ok: false,
          rowsPulled: 0, unitsBuilt: 0, factsStored: 0,
          durationMs: Date.now() - started, error: (e as Error).message,
        });
      }
      return reply.code(502).send({ error: (e as Error).message });
    }
  });
  app.post("/api/ingest/cards/:id/activate", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return activateCard(id);
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message });
    }
  });
  app.post("/api/ingest/cards/:id/dormant", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return dormCard(id);
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message });
    }
  });
}
