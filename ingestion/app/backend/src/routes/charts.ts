import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getCard,
  getConnection,
  getLine,
  getTemplate,
  listCards,
  listGraphsForCard,
  RESOLUTION_LADDER,
  updateTemplate,
  type Card,
  type CardTemplate,
  type ChartSuggestion,
} from "../db/store.js";
import { assertReadonly, driverFor } from "../drivers/index.js";
import { runCardTest } from "./cards.js";
import { llmChatJson, type LlmFailReason } from "../llm/client.js";
import { chartCandidatesSchema, mergeProposalSchema, toCandidateArray } from "../llm/schemas.js";

// Wide enough for multi-resolution previews (30d hourly ≈ 720 rows of tiny
// JSON); the LLM prompt path separately caps to a handful of rows.
const SAMPLE_ROWS = 500;

/* ---------------- column-shape helpers (shared with the UI contract) ---------------- */

function isTemporalName(c: string): boolean {
  return /time|date|hour|day|shift|_at$|^ts$|window|bucket/i.test(c);
}

function numericRatio(rows: Record<string, unknown>[], c: string): number {
  let seen = 0;
  let ok = 0;
  for (const r of rows) {
    const v = r[c];
    if (v == null || v === "") continue;
    seen++;
    if (typeof v === "number" || !isNaN(Number(v))) ok++;
  }
  return seen === 0 ? 0 : ok / seen;
}

function numericCols(rows: Record<string, unknown>[], columns: string[]): string[] {
  return columns.filter((c) => numericRatio(rows, c) >= 0.8);
}

/**
 * Deterministic fallback (and instant no-LLM answer): temporal X -> one line
 * chart per numeric column; else categorical X -> bar; non-numeric heavy ->
 * table. Same vocabulary the LLM prompt uses, so results stay comparable.
 */
export function heuristicSuggestions(
  columns: string[],
  rows: Record<string, unknown>[],
  unit: string,
  threshold: number | null,
  granularity = "hourly"
): ChartSuggestion[] {
  if (rows.length === 0 || columns.length === 0) return [];
  const nums = numericCols(rows, columns);
  const recipeFor = (x: string, y: string[]) => ({
    resolutions: [...RESOLUTION_LADDER],
    xCondition: { column: x, bucket: granularity },
    yConditions: threshold != null && y.length > 0 ? [{ column: y[0], op: ">=", value: threshold }] : [],
  });
  if (nums.length === 0) {
    return [{
      chartType: "table",
      xColumn: columns[0],
      yColumns: [],
      title: "Data rows",
      rationale: "No numeric columns detected — a table preserves all values without loss.",
      conditions: "Always meaningful; the fallback when nothing plots.",
      ...recipeFor(columns[0], []),
    }];
  }
  const x = columns.find(isTemporalName) ?? columns[0];
  const temporal = isTemporalName(x);
  const cond = threshold != null
    ? `Meaningful when tracking trend vs the warn threshold${unit ? ` (${threshold} ${unit})` : ` (${threshold})`}.`
    : "Meaningful for trend and anomaly inspection.";
  if (temporal) {
    return nums.slice(0, 4).map((y, i) => ({
      chartType: "line" as const,
      xColumn: x,
      yColumns: [y],
      title: `${y} over time`,
      rationale: i === 0
        ? `"${x}" is temporal and "${y}" is numeric — a line shows trend, drift and threshold breaches.`
        : `Additional numeric series "${y}" on the same time axis.`,
      conditions: cond,
      ...recipeFor(x, [y]),
    }));
  }
  return [{
    chartType: "bar",
    xColumn: x,
    yColumns: nums.slice(0, 3),
    title: `${nums.slice(0, 3).join(", ")} by ${x}`,
    rationale: `"${x}" is categorical and ${nums.length} numeric column(s) exist — bars compare magnitudes across ${x}.`,
    conditions: cond,
    ...recipeFor(x, nums.slice(0, 3)),
  }];
}

/* ---------------- shared LLM client (cf. src/llm/client.ts) ---------------- */
// All chat-completions traffic goes through llmChatJson — retry, repair,
// validation and failure reasons live there, never in the routes below.

const CHART_VOCAB = `Chart vocabulary (pick only from these):
- line: comparative trend over a temporal X; one or more numeric Y.
- bar: magnitude comparison across a categorical X; numeric Y.
- area: time-series volume/trend emphasis; numeric Y over temporal X.
- table: many columns, non-numeric data, or exact values matter.
Rules: X must be a real column; Y columns must be numeric (count-like strings coerce). Never invent columns. Prefer fewer, more meaningful charts.`;

/**
 * Shared recommend prompt (feature + card). Worded to not invite echo
 * loops: one object, explicit stop, no repeated example lines.
 */
const CHART_SYSTEM = `You recommend visualizations for plant sensor data. ${CHART_VOCAB} Output exactly one JSON object and stop: {"candidates":[{"chartType":"line|bar|area|table","xColumn":"...","yColumns":["..."],"title":"...","rationale":"why this chart fits this data","conditions":"when it is meaningful"}]}. Rank best first, at most 4. Never repeat a key or a line. No prose before or after the object.`;

function samplePreview(columns: string[], rows: Record<string, unknown>[]): string {
  const head = rows.slice(0, 6).map((r) => {
    const o: Record<string, unknown> = {};
    for (const c of columns) o[c] = r[c];
    return o;
  });
  return JSON.stringify({ columns, sample_rows: head }, null, 1).slice(0, 4000);
}

export interface RecommendReason {
  /** Null on an LLM-backed result; otherwise why the heuristic was stored. */
  reason: LlmFailReason | "no-valid-candidates" | null;
}

type LlmCandidate = Partial<ChartSuggestion> & { rank?: number };

function sanitizeCandidates(
  raw: unknown,
  columns: string[],
  rows: Record<string, unknown>[],
  granularity: string,
  threshold: number | null
): ChartSuggestion[] {
  const cols = new Set(columns);
  const arr = Array.isArray(raw) ? raw : (raw as { candidates?: unknown })?.candidates;
  if (!Array.isArray(arr)) return [];
  const out: ChartSuggestion[] = [];
  for (const c of arr.slice(0, 6)) {
    const cand = c as LlmCandidate;
    if (!cand || !["table", "line", "bar", "area"].includes(cand.chartType ?? "")) continue;
    if (typeof cand.xColumn !== "string" || !cols.has(cand.xColumn)) continue;
    const y = Array.isArray(cand.yColumns) ? cand.yColumns.filter((y): y is string => typeof y === "string" && cols.has(y)) : [];
    const nums = numericCols(rows, columns);
    const yOk = y.filter((col) => nums.includes(col));
    if (cand.chartType !== "table" && yOk.length === 0) continue;
    // Fallback-only: a table beside plottable charts is noise. It survives
    // only when nothing numeric plots (handled by the heuristic path).
    if (cand.chartType === "table" && nums.length > 0) continue;
    const yCols = cand.chartType === "table" ? [] : yOk.slice(0, 4);
    out.push({
      chartType: cand.chartType as ChartSuggestion["chartType"],
      xColumn: cand.xColumn,
      yColumns: yCols,
      title: typeof cand.title === "string" ? cand.title.slice(0, 120) : `${cand.xColumn} chart`,
      rationale: typeof cand.rationale === "string" ? cand.rationale.slice(0, 500) : "",
      conditions: typeof cand.conditions === "string" ? cand.conditions.slice(0, 300) : "",
      enabled: true,
      resolutions: [...RESOLUTION_LADDER],
      xCondition: { column: cand.xColumn, bucket: granularity },
      yConditions: threshold != null && yCols.length > 0 ? [{ column: yCols[0], op: ">=", value: threshold }] : [],
    });
  }
  return out;
}

/** Run a template's SQL against its reference line for a small sample. */
async function sampleForTemplate(tpl: CardTemplate, from?: string, to?: string): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> {
  if (!tpl.referenceLineId) throw new Error("template has no reference line — set one first");
  const line = getLine(tpl.referenceLineId);
  if (!line) throw new Error("reference line not found");
  const conn = getConnection(line.connectionId);
  if (!conn) throw new Error("connection not found");
  const end = to ?? new Date().toISOString();
  const start = from ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const sql = tpl.sqlTemplate.replaceAll("{{from}}", start).replaceAll("{{to}}", end);
  assertReadonly(sql);
  const rows = await driverFor(conn).queryReadonly<Record<string, unknown>>(conn, sql);
  return { columns: rows.length > 0 ? Object.keys(rows[0]) : [], rows: rows.slice(0, SAMPLE_ROWS) };
}

/* ---------------- merge optimizer ---------------- */

export interface MergeProposal {
  primaryCardId: string;
  cardIds: string[];
  chartType: "line" | "bar" | "area";
  xColumn: string;
  /** y series with their home card, so no information is lost. */
  series: { cardId: string; cardName: string; column: string }[];
  title: string;
  rationale: string;
}

function groupKey(card: Card, spec: { xColumn: string; chartType: string }): string | null {
  if (spec.chartType === "table") return null;
  return `${card.granularity}|${isTemporalName(spec.xColumn) ? "t" : "c"}`;
}

export async function chartRoutes(app: FastifyInstance) {
  /**
   * Generic read-only sample on a line's connection. Powers line-level
   * previews (template SQL remapped to the line's tables under the hood).
   * Never writes; row-capped like test runs.
   */
  app.post("/api/ingest/lines/:lineId/query-sample", async (req, reply) => {
    const { lineId } = req.params as { lineId: string };
    const p = z.object({
      sql: z.string().min(1).max(20000),
      // Explicit window for multi-resolution previews (daily/weekly/...).
      // Defaults to last 24h like test runs.
      from: z.string().optional(),
      to: z.string().optional(),
    }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    const line = getLine(lineId);
    if (!line) return reply.code(404).send({ error: "line not found" });
    const conn = getConnection(line.connectionId);
    if (!conn) return reply.code(404).send({ error: "connection not found" });
    const end = p.data.to ?? new Date().toISOString();
    const start = p.data.from ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const sql = p.data.sql.replaceAll("{{from}}", start).replaceAll("{{to}}", end);
    try {
      assertReadonly(sql);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
    try {
      const rows = await driverFor(conn).queryReadonly<Record<string, unknown>>(conn, sql);
      return {
        columns: rows.length > 0 ? Object.keys(rows[0]) : [],
        rows: rows.slice(0, SAMPLE_ROWS),
        rowCount: rows.length,
      };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  /**
   * Small sample of a template's SQL against its reference line — powers the
   * template-level chart previews. Read-only, never writes.
   */
  app.post("/api/ingest/templates/:id/sample", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = z.object({ from: z.string().optional(), to: z.string().optional() }).safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    const tpl = getTemplate(id);
    if (!tpl) return reply.code(404).send({ error: "template not found" });
    try {
      const s = await sampleForTemplate(tpl, p.data.from, p.data.to);
      return { columns: s.columns, rows: s.rows.slice(0, SAMPLE_ROWS), rowCount: s.rows.length };
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message });
    }
  });

  /** Toggle which suggestions are enabled (inherited by future cards). */
  app.patch("/api/ingest/templates/:id/suggestions", async (req, reply) => {
    const { id } = req.params as { id: string };
    const tpl = getTemplate(id);
    if (!tpl) return reply.code(404).send({ error: "template not found" });
    const p = z.object({ enabled: z.array(z.boolean()) }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    const next = tpl.chartSuggestions.map((s, i) => ({
      ...s,
      enabled: p.data.enabled[i] ?? s.enabled ?? true,
    }));
    return updateTemplate(id, { chartSuggestions: next });
  });
  /**
   * Recommend charts for a feature (template): runs once at feature
   * registration against the reference line. Stores ranked suggestions on
   * the template; cards inherit them at instantiate time. Re-calling
   * re-recommends (replaces stored suggestions, never touches cards).
   */
  app.post("/api/ingest/templates/:id/recommend-charts", async (req, reply) => {
    const { id } = req.params as { id: string };
    const tpl = getTemplate(id);
    if (!tpl) return reply.code(404).send({ error: "template not found" });
    let sample: { columns: string[]; rows: Record<string, unknown>[] };
    try {
      sample = await sampleForTemplate(tpl);
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message });
    }
    if (sample.rows.length === 0) return reply.code(409).send({ error: "reference query returned no rows — nothing to recommend from" });
    const fallback = heuristicSuggestions(sample.columns, sample.rows, tpl.unit, null, tpl.granularity);
    const r = await llmChatJson({
      system: CHART_SYSTEM,
      user: `Feature: ${tpl.name} (granularity ${tpl.granularity}, unit "${tpl.unit || "none"}").\nData:\n${samplePreview(sample.columns, sample.rows)}`,
      schema: chartCandidatesSchema,
      context: { route: "recommend-template", templateId: id },
      log: app.log,
    });
    const llm = r.parsed ? sanitizeCandidates(toCandidateArray(r.parsed), sample.columns, sample.rows, tpl.granularity, null) : [];
    const suggestions = llm.length > 0 ? llm : fallback;
    updateTemplate(id, { chartSuggestions: suggestions });
    const reason: LlmFailReason | "no-valid-candidates" | null =
      llm.length > 0 ? null : (r.reason ?? "no-valid-candidates");
    return { suggestions, stored: true, model: r.model || null, heuristic: llm.length === 0, reason };
  });

  /**
   * Recommend charts for a single card (scratch cards, or re-recommend).
   * Never stores — the UI saves accepted candidates as graph specs.
   */
  app.post("/api/ingest/cards/:id/recommend-charts", async (req, reply) => {
    const { id } = req.params as { id: string };
    const card = getCard(id);
    if (!card) return reply.code(404).send({ error: "card not found" });
    let t: { columns: string[]; rows: Record<string, unknown>[] };
    try {
      t = await runCardTest(id);
    } catch (e) {
      return reply.code(502).send({ error: `test run failed: ${(e as Error).message}` });
    }
    if (t.rows.length === 0) return reply.code(409).send({ error: "test run returned no rows — nothing to recommend from" });
    const fallback = heuristicSuggestions(t.columns, t.rows, card.unit, card.threshold, card.granularity);
    const r = await llmChatJson({
      system: CHART_SYSTEM,
      user: `Card: ${card.name} (granularity ${card.granularity}, unit "${card.unit || "none"}", threshold ${card.threshold ?? "none"}).\nData:\n${samplePreview(t.columns, t.rows)}`,
      schema: chartCandidatesSchema,
      context: { route: "recommend-card", cardId: id },
      log: app.log,
    });
    const llm = r.parsed ? sanitizeCandidates(toCandidateArray(r.parsed), t.columns, t.rows, card.granularity, card.threshold) : [];
    const suggestions = llm.length > 0 ? llm : fallback;
    const reason: LlmFailReason | "no-valid-candidates" | null =
      llm.length > 0 ? null : (r.reason ?? "no-valid-candidates");
    return { suggestions, stored: false, model: r.model || null, heuristic: llm.length === 0, reason };
  });

  /**
   * One-time merge optimizer at card registration: compare the line's
   * features' chart recipes and propose combinations that lose no
   * information. Same-granularity + same X-shape groups only (deterministic
   * pre-group, LLM only proposes within a group). Never stores — the UI
   * saves accepted proposals as a merged graph spec on the primary card
   * (recipe lists all cardIds).
   */
  app.post("/api/ingest/lines/:lineId/optimize-charts", async (req, reply) => {
    const { lineId } = req.params as { lineId: string };
    const line = getLine(lineId);
    if (!line) return reply.code(404).send({ error: "line not found" });
    const cards = listCards(lineId);
    if (cards.length < 2) return reply.code(409).send({ error: "need at least 2 features on the line to optimize" });
    // Collect specs per card (only selected-for-RAG or all when none flagged).
    const perCard: { card: Card; specs: { xColumn: string; chartType: string; yColumns: string[] }[] }[] = [];
    for (const c of cards) {
      const specs = listGraphsForCard(c.id);
      if (specs.length === 0) continue;
      const flagged = specs.filter((s) => (s.config as Record<string, unknown>)?.selected_for_rag === true);
      const use = (flagged.length > 0 ? flagged : specs).filter((s) => s.chartType !== "table" && s.xColumn);
      if (use.length > 0) perCard.push({ card: c, specs: use.map((s) => ({ xColumn: s.xColumn, chartType: s.chartType, yColumns: s.yColumns })) });
    }
    // Deterministic pre-group: same granularity + same X shape + same X name.
    const groups = new Map<string, typeof perCard>();
    for (const pc of perCard) {
      for (const s of pc.specs) {
        const k = groupKey(pc.card, s);
        if (!k) continue;
        const gk = `${k}::${s.xColumn}`;
        const g = groups.get(gk) ?? [];
        if (!g.some((x) => x.card.id === pc.card.id)) g.push(pc);
        groups.set(gk, g);
      }
    }
    const candidates = [...groups.values()].filter((g) => {
      const ids = new Set(g.map((x) => x.card.id));
      return ids.size >= 2;
    });
    if (candidates.length === 0) {
      return { proposals: [], note: "no compatible groups: charts differ in granularity or X axis, keeping separate charts loses nothing" };
    }
    // Groups run concurrently under a total budget (settled, never throwing):
    // a slow or failing group is reported in `skipped`, never silent.
    const budgetMs = (() => {
      const v = Number(process.env.LLM_MERGE_BUDGET_MS);
      return Number.isFinite(v) && v > 0 ? v : 240000;
    })();
    const deadline = Date.now() + budgetMs;
    type GroupOf = (typeof candidates)[number];
    const tasks = candidates.slice(0, 4).map(async (g: GroupOf) => {
      const label = g.map((x) => x.card.name).join(" + ");
      if (Date.now() > deadline) {
        app.log.warn({ route: "optimize-charts", lineId, group: label }, "merge group skipped: budget exhausted");
        return { proposal: null as MergeProposal | null, skipped: `${label} (budget exhausted)` as string | null };
      }
      const desc = g.map((x) => {
        const cols = x.specs.flatMap((s) => s.yColumns.map((y) => `${s.xColumn}→${y} (${s.chartType})`)).join(", ");
        return `- ${x.card.name} [${x.card.id}] granularity=${x.card.granularity} unit="${x.card.unit || "none"}" series: ${cols}`;
      }).join("\n");
      const r = await llmChatJson({
        system: `You combine plant charts without losing information. Reply with JSON only: {"merge":true|false,"chartType":"line|bar|area","title":"...","rationale":"why the merge keeps every series readable (or why not)"}. Merge only if all series share one X axis and stay readable; units may differ but then say so.`,
        user: `Candidate group (same granularity, same X shape):\n${desc}`,
        schema: mergeProposalSchema,
        context: { route: "optimize-charts", lineId, group: label },
        log: app.log,
      });
      const answer = r.parsed;
      if (!answer) return { proposal: null as MergeProposal | null, skipped: `${label} (${r.reason})` as string | null };
      if (answer.merge !== true) return { proposal: null as MergeProposal | null, skipped: null as string | null };
      const primary = g[0].card;
      const seen = new Set<string>();
      const series: { cardId: string; cardName: string; column: string }[] = [];
      for (const x of g) {
        for (const s of x.specs) {
          for (const y of s.yColumns.slice(0, 3)) {
            const k = `${x.card.id}::${y}`;
            if (seen.has(k)) continue;
            seen.add(k);
            series.push({ cardId: x.card.id, cardName: x.card.name, column: y });
          }
        }
        if (series.length >= 6) break;
      }
      return {
        proposal: {
          primaryCardId: primary.id,
          cardIds: [...new Set(g.map((x) => x.card.id))],
          chartType: (answer.chartType ?? "line") as MergeProposal["chartType"],
          xColumn: g[0].specs[0].xColumn,
          series,
          title: answer.title ?? `${primary.name} +${g.length - 1} combined`,
          rationale: answer.rationale ?? "",
        } as MergeProposal,
        skipped: null as string | null,
      };
    });
    const settled = await Promise.allSettled(tasks);
    const proposals: MergeProposal[] = [];
    const skipped: string[] = [];
    for (const s of settled) {
      if (s.status === "fulfilled") {
        if (s.value.proposal) proposals.push(s.value.proposal);
        if (s.value.skipped) skipped.push(s.value.skipped);
      } else {
        skipped.push(`group error: ${(s.reason as Error)?.message ?? String(s.reason)}`);
      }
    }
    return { proposals, ...(skipped.length > 0 ? { skipped } : {}) };
  });
}
