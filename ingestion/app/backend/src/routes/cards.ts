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
import { getConnection, listLineColumnMeta } from "../db/store.js";
import { llmChatJson } from "../llm/client.js";
import { fetchDetectionRows, scanQuirks, type QuirkScan } from "../quirks.js";

const gran = z.enum(["hourly", "shift", "daily"]);
// Production-day time settings: HH:MM shift anchor + shift length in hours.
// Defaults reproduce the old midnight behavior exactly.
const shiftStart = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "shiftStart must be HH:MM").default("00:00");
const shiftHours = z.number().int().min(1).max(24).default(8);
// Ingest streams: finest checked = base sampler, coarser checked = scheduled
// readers. Non-empty after sanitize; unknown values rejected.
const streamRes = z.enum(["5min", "hourly", "daily", "weekly", "monthly"]);
const resolutions = z.array(streamRes).min(1).max(5).default(["5min", "hourly", "daily", "weekly", "monthly"] as const);
// Weekly skip schedule: per-day running windows. Absent day = full 24h
// running. End "24:00" allowed; from must precede to (parse drops the rest).
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const skipSchedule = z.record(
  z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
  z.array(z.object({ from: hhmm, to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/) }).refine((w) => w.to === "24:00" || w.to > w.from, { message: "skip window end must be after start" })).max(3).default([]),
).default({});

const suggestionSchema = z.object({
  chartType: z.enum(["table", "line", "bar", "area", "histogram"]),
  xColumn: z.string(),
  yColumns: z.array(z.string()),
  title: z.string().max(200).default(""),
  rationale: z.string().max(1000).default(""),
  conditions: z.string().max(500).default(""),
  series: z.array(z.object({
    column: z.string(),
    label: z.string().max(120),
    unit: z.string().max(20),
    color: z.string().max(20),
  })).optional(),
  xTitle: z.string().max(120).optional(),
  yTitle: z.string().max(200).optional(),
  summary: z.string().max(1000).optional(),
  provenance: z.object({
    rows: z.number(),
    from: z.string().nullable(),
    to: z.string().nullable(),
  }).optional(),
  enabled: z.boolean().default(true),
  resolutions: z.array(z.string()).default([]),
  xCondition: z.object({ column: z.string(), bucket: z.string() }).nullable().default(null),
  // label/comment ride from the template threshold rows (display in preview
  // chips). Optional so pre-extension suggestions validate unchanged.
  yConditions: z.array(z.object({ column: z.string(), op: z.string(), value: z.number(), label: z.string().max(120).default(""), comment: z.string().max(500).default("") })).default([]),
});

// Threshold definition row (§8): breach condition on a SQL output column.
// Max 2 per template — third regime → new template.
const thresholdSchema = z.object({
  name: z.string().max(120).default(""),
  column: z.string().min(1).max(120),
  direction: z.enum(["above", "below"]).default("above"),
  value: z.number(),
  comment: z.string().max(500).default(""),
});

const tplSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(""),
  referenceLineId: z.string().min(1).nullable().default(null),
  sqlTemplate: z.string().default(""),
  granularity: gran.default("hourly"),
  shiftStart: shiftStart,
  shiftHours: shiftHours,
  resolutions: resolutions,
  skipSchedule: skipSchedule,
  unit: z.string().max(20).default(""),
  extractHint: z.string().max(2000).default(""),
  context: z.string().max(2000).default(""),
  thresholds: z.array(thresholdSchema).max(2).default([]),
  chartSuggestions: z.array(suggestionSchema).default([]),
});

const cardSchema = z.object({
  lineId: z.string().min(1),
  name: z.string().min(1).max(120),
  tables: z.array(z.string().min(1)).default([]),
  sql: z.string().default(""),
  granularity: gran.default("hourly"),
  shiftStart: shiftStart,
  shiftHours: shiftHours,
  resolutions: resolutions,
  skipSchedule: skipSchedule,
  unit: z.string().max(20).default(""),
  extractHint: z.string().max(2000).default(""),
  context: z.string().max(2000).default(""),
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
  /**
   * AI-drafted ingest tuning for the template form: extraction hint + retain
   * context from name/description/SQL + the reference line's column meanings,
   * optionally steered by setter notes. Drafts only — never saved.
   */
  app.post("/api/ingest/templates/suggest-hints", async (req, reply) => {
    const p = z.object({
      name: z.string().max(120).default(""),
      description: z.string().max(2000).default(""),
      sqlTemplate: z.string().max(20000).default(""),
      unit: z.string().max(20).default(""),
      threshold: z.number().nullable().default(null),
      granularity: z.string().max(20).default("hourly"),
      referenceLineId: z.string().min(1).nullable().default(null),
      steer: z.string().max(2000).default(""),
    }).safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    const b = p.data;
    const line = b.referenceLineId ? getLine(b.referenceLineId) : null;
    if (!line) return reply.code(409).send({ error: "pick a reference line first — hints ground on its tables and column meanings" });
    const meanings = listLineColumnMeta(line.id);
    const byTable = new Map<string, string[]>();
    for (const m of meanings) {
      const cols = byTable.get(m.tableName) ?? [];
      cols.push(`${m.columnName}${m.datatype ? ` (${m.datatype})` : ""}${m.meaning.trim() ? `: ${m.meaning.trim()}` : ""}`);
      byTable.set(m.tableName, cols);
    }
    const colText = [...byTable.entries()].map(([t, cs]) => `${t}: ${cs.join("; ") || "(no columns recorded)"}`).join("\n") || "(no column meanings stored for this line yet)";
    const steer = b.steer.trim();
    // Quirk discovery: counted findings over a detection sample (zero LLM).
    // <5 production days → gate: no quirk claims, honest notice instead.
    const conn = getConnection(line.connectionId);
    let scan: QuirkScan = { daysAvailable: 0, status: "insufficient-data", xColumn: null, candidates: [] };
    if (conn && b.sqlTemplate.trim()) {
      try {
        const detRows = await fetchDetectionRows(conn, b.sqlTemplate);
        scan = scanQuirks(detRows);
      } catch {
        scan = { daysAvailable: 0, status: "insufficient-data", xColumn: null, candidates: [] };
      }
    }
    // Cap listed quirks: each listed quirk invites one answer point, and an
    // overlong answer gets truncated before the context key (schema-reject).
    const quirkLines = scan.candidates.slice(0, 6).map((q) => `- [${q.kind}] ${q.column}${q.at ? ` at ${q.at}` : ""}: ${q.detail} → clause: "${q.proposedClause}"`);
    const r = await llmChatJson({
      system: "You write ingest tuning for plant sensor data pipelines. Reply with JSON only, no prose, no fences.",
      user: [
        `Template: ${b.name || "(unnamed)"}${b.description ? ` — ${b.description}` : ""}`,
        `SQL: ${b.sqlTemplate || "(empty)"}`,
        `Unit: ${b.unit || "none"} · Threshold: ${b.threshold ?? "none"} · Granularity: ${b.granularity}`,
        `Line tables + column meanings:\n${colText}`,
        steer ? `Setter notes (ground truth from the plant — obey over inference): ${steer}` : "",
        scan.status === "ok"
          ? `Measured quirks (counted from ${scan.daysAvailable} days of samples — propose clauses ONLY for these, never invent others):\n${quirkLines.join("\n") || "(none detected)"}`
          : `Sample covers only ${scan.daysAvailable} production day(s) (<5) — do NOT invent recurring quirks; write only measure/unit/threshold rules.`,
        `Write JSON: {"extractHint":"…","context":"…"}.`,
        `extractHint as SEPARATE POINTS, one sentence each, joined by " | ", AT MOST 6 points total: first the measure/unit/threshold/value-hour rules, then one point per measured quirk above (each citing its evidence), then setter-note rules if any. Concrete to these columns, never generic. Never state the source sampling rate (minute/second-wise) — it is not visible in the sample.`,
        `context (12 words max): the permanent label stored alongside every fact from this template — "{granularity} {measure-phrase} rollup" style, e.g. "hourly temperature rollup". Must identify the rollup, not the plant.`,
      ].filter(Boolean).join("\n"),
      schema: z.object({ extractHint: z.string().max(800), context: z.string().max(120) }),
      context: { route: "template-hints", lineId: line.id },
      log: app.log,
    });
    if (r.reason === "no-provider") {
      return reply.code(409).send({ error: "no active LLM — connect one in AI Services", reason: r.reason });
    }
    if (!r.parsed) {
      return reply.code(502).send({ error: `hint draft failed: ${r.reason}`, reason: r.reason });
    }
    // Points: split hint sentences, source-tagged for the point editor.
    const points = r.parsed.extractHint.split(/\s*\|\s*|\.\s+(?=[A-Z0-9])/).map((s) => s.trim().replace(/\.*$/, "")).filter(Boolean).map((text) => ({ text, source: "ai" as const }));
    return {
      extractHint: r.parsed.extractHint,
      context: r.parsed.context,
      points,
      candidateQuirks: scan.candidates,
      quirkStatus: scan.status,
      daysAvailable: scan.daysAvailable,
      model: r.model || null,
      latencyMs: r.latencyMs,
      attempts: r.attempts,
    };
  });
  /**
   * AI-drafted SQL template for the template form: from name/description +
   * the reference line's tables/columns/meanings, optionally steered. SELECT-
   * only (assertReadonly before return). Drafts only — execution happens on
   * Test/Preview, never here.
   */
  app.post("/api/ingest/templates/suggest-sql", async (req, reply) => {
    const p = z.object({
      name: z.string().max(120).default(""),
      description: z.string().max(2000).default(""),
      granularity: z.string().max(20).default("hourly"),
      resolutions: z.array(z.string()).default([]),
      unit: z.string().max(20).default(""),
      referenceLineId: z.string().min(1).nullable().default(null),
      steer: z.string().max(2000).default(""),
    }).safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    const b = p.data;
    const line = b.referenceLineId ? getLine(b.referenceLineId) : null;
    if (!line) return reply.code(409).send({ error: "pick a reference line first — SQL grounds on its tables" });
    const meanings = listLineColumnMeta(line.id);
    const byTable = new Map<string, string[]>();
    for (const m of meanings) {
      const cols = byTable.get(m.tableName) ?? [];
      cols.push(`${m.columnName}${m.datatype ? ` (${m.datatype})` : ""}${m.meaning.trim() ? `: ${m.meaning.trim()}` : ""}`);
      byTable.set(m.tableName, cols);
    }
    const colText = [...byTable.entries()].map(([t, cs]) => `${t}: ${cs.join("; ") || "(no columns recorded)"}`).join("\n") || "(no column meanings stored for this line yet)";
    const steer = b.steer.trim();
    const streams = b.resolutions.length > 0 ? b.resolutions.join(", ") : "hourly";
    const r = await llmChatJson({
      system: "You write read-only plant analytics SQL (Postgres and SQLite compatible). Reply with JSON only: {\"sql\":\"…\"}, no prose, no fences.",
      user: [
        `Feature: ${b.name || "(unnamed)"}${b.description ? ` — ${b.description}` : ""}`,
        `Cadence: ${b.granularity} (streams: ${streams}) · Unit: ${b.unit || "none"}`,
        `Line tables + columns + meanings:\n${colText}`,
        steer ? `Setter notes (ground truth — obey over inference): ${steer}` : "",
        `Rules: SELECT-only single statement; MUST filter ts with '{{from}}' AND '{{to}}' placeholders (literal, quoted, upper bound EXCLUSIVE: ts < '{{to}}'); GROUP BY the time bucket for the cadence (hourly → date_trunc('hour', ts)); alias every output column (no bare ts/value); AVG for gauges, SUM for counters; one row per time bucket out.`,
        `Cross-table rule: if the requested measures live in different tables, JOIN them — never silently drop a measure. Join on the time bucket (date_trunc('hour', a.ts) = date_trunc('hour', b.ts)), LEFT JOIN from the primary measure table so missing secondary rows give NULLs, never dropped hours. JOINs only within the listed tables.`,
        `Also explain the draft as short summary points: "thinking": 3-6 points, one per decision — why this table set/JOIN, why these aggregates, how each rule above is met, and what could still be wrong (fan-out risk, grain doubts). Short clauses, no prose.`,
      ].filter(Boolean).join("\n"),
      schema: z.object({ sql: z.string().min(10).max(20000), thinking: z.array(z.string().max(300)).min(1).max(8) }),
      context: { route: "template-sql", lineId: line.id },
      log: app.log,
    });
    if (r.reason === "no-provider") {
      return reply.code(409).send({ error: "no active LLM — connect one in AI Services", reason: r.reason });
    }
    if (!r.parsed) {
      return reply.code(502).send({ error: `SQL draft failed: ${r.reason}`, reason: r.reason });
    }
    try {
      assertReadonly(r.parsed.sql);
    } catch (e) {
      return reply.code(502).send({ error: `draft rejected (not read-only): ${(e as Error).message}` });
    }
    return { sql: r.parsed.sql, thinking: r.parsed.thinking, model: r.model || null, latencyMs: r.latencyMs, attempts: r.attempts };
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
