import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getCard,
  getConnection,
  getLine,
  getTemplate,
  listCards,
  listGraphsForCard,
  listLineColumnMeta,
  parseThresholds,
  RESOLUTION_LADDER,
  updateTemplate,
  type Card,
  type CardTemplate,
  type ChartSuggestion,
  type ConnectionRecord,
  type ThresholdCondition,
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
/**
 * Warn lines for a chart's plotted columns: one condition per threshold row
 * whose column is actually on the chart, op from the row direction. Falls
 * back to the legacy single-threshold stamp (row-1 value on the first Y)
 * when no row matches — e.g. cards, which carry one bare number.
 */
export function yConditionsFor(
  cols: string[],
  rows: ThresholdCondition[],
  legacy: number | null,
): { column: string; op: string; value: number; label?: string; comment?: string }[] {
  const matched = rows
    .filter((r) => cols.includes(r.column))
    .map((r) => ({
      column: r.column,
      op: r.direction === "below" ? "<=" : ">=",
      value: r.value,
      // Name + comment ride along for preview chips (omitted when empty).
      ...(r.name.trim() ? { label: r.name.trim() } : {}),
      ...(r.comment.trim() ? { comment: r.comment.trim() } : {}),
    }));
  if (matched.length > 0) return matched;
  if (legacy != null && cols.length > 0) return [{ column: cols[0], op: ">=", value: legacy }];
  return [];
}

/**
 * THRESHOLDS prompt block (dry-run proven in ingestion/suggest-charts):
 * one line per definition row so the model cites names/values/directions
 * in rationale/conditions and prefers threshold columns as Y measures.
 */
export function buildThresholdsBlock(rows: ThresholdCondition[]): string {
  if (rows.length === 0) return "";
  const lines = rows.map((r) => {
    const dir = r.direction === "below" ? "below" : "above";
    const comment = r.comment.trim() ? ` · ${r.comment.trim()}` : "";
    const name = r.name.trim() ? `${r.name.trim()} · ` : "";
    return `- ${name}${r.column} · ${dir} ${r.value}${comment}`;
  });
  return `THRESHOLDS (breach conditions defined on this template — cite applicable ones in rationale/conditions and prefer their columns as Y measures):\n${lines.join("\n")}`;
}

export function heuristicSuggestions(
  columns: string[],
  rows: Record<string, unknown>[],
  unit: string,
  threshold: number | null,
  granularity = "hourly",
  thresholdRows: ThresholdCondition[] = []
): ChartSuggestion[] {
  if (rows.length === 0 || columns.length === 0) return [];
  const nums = numericCols(rows, columns);
  const recipeFor = (x: string, y: string[]) => ({
    resolutions: [...RESOLUTION_LADDER],
    xCondition: { column: x, bucket: granularity },
    yConditions: yConditionsFor(y, thresholdRows, threshold),
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
    const out: ChartSuggestion[] = [];
    const first = nums[0];
    out.push({
      chartType: "line",
      xColumn: x,
      yColumns: [first],
      title: `${first} over time`,
      rationale: `"${x}" is temporal and "${first}" is numeric — a line shows trend, drift and threshold breaches.`,
      conditions: cond,
      ...recipeFor(x, [first]),
    });
    // One bucketed bar alternative on the same X+Y (discrete per-bucket view).
    out.push({
      chartType: "bar",
      xColumn: x,
      yColumns: [first],
      title: `${first} per bucket`,
      rationale: `Same "${x}" → "${first}" series as bars — discrete per-bucket magnitudes instead of a continuous trend.`,
      conditions: "When comparing individual buckets rather than following the continuous trend.",
      ...recipeFor(x, [first]),
    });
    // Distribution view of the primary measure.
    out.push({
      chartType: "histogram",
      xColumn: first,
      yColumns: [first],
      title: `${first} distribution`,
      rationale: `"${first}" is numeric — a histogram shows spread, modes and outliers that a trend line hides.`,
      conditions: "When checking distribution, spread or outliers rather than evolution over time.",
      ...recipeFor(first, [first]),
    });
    if (nums[1]) {
      out.push({
        chartType: "line",
        xColumn: x,
        yColumns: [nums[1]],
        title: `${nums[1]} over time`,
        rationale: `Additional numeric series "${nums[1]}" on the same time axis.`,
        conditions: cond,
        ...recipeFor(x, [nums[1]]),
      });
    }
    return out.slice(0, 4);
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
- line: trend over a temporal X; one or more numeric Y. The DEFAULT for time series.
- area: time-series volume/cumulative emphasis; numeric Y over temporal X. EXCLUSIVE with line: for the same X+Y return ONE of line/area, never both (they render near-identically). Prefer line unless the data is cumulative/counter-like.
- bar: discrete magnitudes per bucket/category; numeric Y. Allowed on a temporal X as ONE bucketed alternative to the line (hourly/daily bars), and on categorical X for comparisons.
- histogram: distribution of ONE numeric column (spread, outliers, modes). Set xColumn to the value column and yColumns to [same column]; the UI bins values automatically. No time axis.
- table: many columns, non-numeric data, or exact values matter. Only when nothing numeric plots.
Rules: X must be a real column; Y columns must be numeric (count-like strings coerce). Never invent columns. Never return the same X+Y twice with different line/area types. At most ONE bar alternative per X+Y. Prefer 2-3 distinct, complementary charts over 4 near-duplicates.`;

const HISTOGRAM_HINT = `Histogram guidance: suggest exactly one histogram when there is at least one numeric column with 10+ distinct values. Pick the most meaningful measure (e.g. temperature, count). rationale must say what spread/outliers it reveals; conditions must say "when checking distribution".`;

const SEMANTICS_RULES = `SEMANTICS: use the AIM and COLUMN MEANINGS blocks to choose the measure column(s) and split dimensions. Every measure named in the AIM must appear in at least one candidate. Each rationale must cite the meaning it used (e.g. "per the power_kw meaning, the energy measure").
SELECTIVITY: not every column needs a chart. Ignore IDs, hashes, flags, and near-constant columns (distinct ~1) unless the AIM names them. Choose only columns that serve the AIM or reveal a real pattern (trend, distribution, comparison). Returning 2 sharp candidates that leave 50 columns unused is correct; covering random columns is a failure.
VERBATIM COLUMNS: copy column names character-for-character from DATA columns. Never retype, normalize, or "fix" spelling/case. A renamed column is treated as invented and dropped.`;

/**
 * Shared recommend prompt (feature + card). Worded to not invite echo
 * loops: one object, explicit stop, no repeated example lines.
 */
const CHART_SYSTEM = `You recommend visualizations for plant sensor data. ${CHART_VOCAB} ${HISTOGRAM_HINT} ${SEMANTICS_RULES} Output exactly one JSON object and stop: {"candidates":[{"chartType":"line|bar|area|histogram|table","xColumn":"...","yColumns":["..."],"title":"...","rationale":"why this chart fits this data (must differ per candidate)","conditions":"when it is meaningful"}]}. Rank best first, at most 4. Use the DATA PROFILE (row count, time span, min/max/avg) to ground each rationale — never describe values not in the profile. Never repeat a key or a line. No prose before or after the object.`;

function fmtN(v: number): string {
  return Number(v.toFixed(3)).toString();
}

/** Compact data profile so the model grounds rationales in real stats, not 6 raw rows. */
export function buildDataProfile(
  columns: string[],
  rows: Record<string, unknown>[],
  opts: { granularity?: string; unit?: string; threshold?: number | null } = {},
): string {
  // Temporal columns already surface as time_span below — keep them out of
  // numeric_stats so epoch-ms noise never reaches the model.
  const nums = numericCols(rows, columns).filter((c) => !isTemporalName(c));
  const numStats: Record<string, { min: string; max: string; avg: string; n: number; distinct: number }> = {};
  for (const c of nums) {
    const vals = rows.map((r) => Number(r[c])).filter((v) => !isNaN(v));
    if (vals.length === 0) continue;
    numStats[c] = {
      min: fmtN(Math.min(...vals)),
      max: fmtN(Math.max(...vals)),
      avg: fmtN(vals.reduce((a, b) => a + b, 0) / vals.length),
      n: vals.length,
      // Variance cue for SELECTIVITY: near-constant columns (distinct ~1)
      // are safe to ignore unless the AIM names them.
      distinct: new Set(vals.map((v) => Number(v.toFixed(6)))).size,
    };
  }
  // First temporal column: time span + cardinality of the likely X.
  let timeSpan: { column: string; min: string; max: string; distinct: number } | null = null;
  for (const c of columns) {
    if (!isTemporalName(c)) continue;
    const times = rows.map((r) => Date.parse(String(r[c] ?? ""))).filter((t) => !isNaN(t));
    if (times.length === 0) continue;
    timeSpan = {
      column: c,
      min: new Date(Math.min(...times)).toISOString(),
      max: new Date(Math.max(...times)).toISOString(),
      distinct: new Set(rows.map((r) => String(r[c] ?? ""))).size,
    };
    break;
  }
  const profile = {
    rows: rows.length,
    granularity: opts.granularity ?? "hourly",
    unit: opts.unit || "none",
    threshold: opts.threshold ?? "none",
    numeric_stats: numStats,
    ...(timeSpan ? { time_span: timeSpan } : {}),
  };
  return JSON.stringify(profile);
}

export interface AimInfo {
  description?: string;
  context?: string;
  extractHint?: string;
}

export interface MeaningInfo {
  tableName: string;
  columnName: string;
  meaning: string;
  datatype: string;
}

/**
 * AIM + SEMANTICS block (spike-proven: surfaces aim-named measures like
 * faults that bare stats miss). Budgeted for wide tables: only meanings
 * whose column is referenced by the SQL travel (cap 20, overflow noted);
 * templates without meanings degrade to today's prompt exactly.
 */
export function buildSemanticsBlock(
  sqlTemplate: string,
  aim: AimInfo,
  meanings: MeaningInfo[],
  maxMeanings = 20,
): string {
  const aimLines = [
    `- description: ${aim.description?.trim() || "(none)"}`,
    `- context: ${aim.context?.trim() || "(none)"}`,
    `- extractHint: ${aim.extractHint?.trim() || "(none)"}`,
  ];
  const sqlLower = sqlTemplate.toLowerCase();
  const used = meanings.filter((m) => m.columnName && sqlLower.includes(m.columnName.toLowerCase()));
  const shown = used.slice(0, maxMeanings);
  const overflow = used.length - shown.length;
  const semLines = shown.map(
    (m) => `- ${m.tableName}.${m.columnName} [${m.datatype}]: ${m.meaning?.trim() || "(no meaning)"}`,
  );
  if (overflow > 0) semLines.push(`(+${overflow} more described columns not shown)`);
  if (shown.length === 0) semLines.push("(no column meanings stored for this line's tables yet)");
  return `AIM:\n${aimLines.join("\n")}\n\nCOLUMN MEANINGS:\n${semLines.join("\n")}\n\nSQL (maps raw columns to output columns):\n${sqlTemplate}`;
}

/** Prompt budget: aim + SQL + meanings are never cut; sample rows trim first. */
const PROMPT_BUDGET = 10000;

/** Series palette — must match frontend SERIES_COLORS (Chart.tsx) by order. */
const SERIES_PALETTE = ["#14b8a6", "#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899", "#ef4444"];

const X_TITLE_BY_GRANULARITY: Record<string, string> = {
  hourly: "Hour",
  shift: "Shift",
  daily: "Day",
  weekly: "Week",
  monthly: "Month",
  yearly: "Year",
};

function prettifyColumn(col: string): string {
  const s = col.replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : col;
}

function isCountLikeColumn(col: string): boolean {
  return /count|faults?|samples?|total|qty|quantity/i.test(col);
}

export interface SuggestionFillContext {
  unit: string;
  granularity: string;
  meanings: MeaningInfo[];
  rowCount: number;
  timeMin: string | null;
  timeMax: string | null;
}

/**
 * Deterministic completion for newly recommended suggestions: per-series
 * legend metadata, axis titles, summary seed, and provenance. Runs AFTER
 * sanitize (so only real columns), for both LLM and heuristic paths.
 * Pre-enrichment stored suggestions keep rendering via fallbacks.
 */
export function completeSuggestion(s: ChartSuggestion, ctx: SuggestionFillContext): ChartSuggestion {
  const out = { ...s };
  const isHist = out.chartType === "histogram";
  if (!out.series) {
    out.series = out.yColumns.map((col, i) => {
      // Boundary-anchored match: "temp_c" matches "avg_temp_c" but "ts"
      // must NOT match "faults". Prevents wrong-meaning legend labels.
      const raw = ctx.meanings.find((m) => {
        if (!m.columnName) return false;
        const esc = m.columnName.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`).test(col.toLowerCase());
      });
      return {
        column: col,
        label: raw?.meaning && raw.meaning.length <= 80 ? raw.meaning : prettifyColumn(col),
        // Histogram plots bin *counts*, never the measure unit.
        unit: isHist ? "count" : isCountLikeColumn(col) ? "count" : ctx.unit,
        color: SERIES_PALETTE[i % SERIES_PALETTE.length],
      };
    });
  }
  if (!out.xTitle) {
    // Histogram X is bins of the measure, not the measure itself.
    out.xTitle = isHist
      ? `${prettifyColumn(out.xColumn)} bins`
      : isTemporalName(out.xColumn)
        ? (X_TITLE_BY_GRANULARITY[ctx.granularity] ?? prettifyColumn(out.xColumn))
        : prettifyColumn(out.xColumn);
  }
  if (!out.yTitle) {
    // Histogram Y is always bin counts.
    if (isHist) {
      out.yTitle = "count";
    } else {
      const u = out.series[0]?.unit || ctx.unit;
      out.yTitle = out.yColumns.length > 0 ? `${out.yColumns.join(", ")}${u ? ` (${u})` : ""}` : prettifyColumn(out.xColumn);
    }
  }
  if (!out.summary) {
    const series = (out.series ?? []).map((x) => x.label).join(" vs ") || out.yColumns.join(", ");
    const span = ctx.timeMin && ctx.timeMax ? `, ${ctx.timeMin.slice(0, 10)}..${ctx.timeMax.slice(0, 10)}` : "";
    out.summary = `${out.title}: ${series} across ${out.xTitle?.toLowerCase() ?? out.xColumn} (${ctx.rowCount} rows${span}).`;
  }
  if (!out.provenance) {
    out.provenance = { rows: ctx.rowCount, from: ctx.timeMin, to: ctx.timeMax };
  }
  return out;
}

/** Row count + time span of a sample (traceability for suggestion provenance). */
export function summarizeSample(
  columns: string[],
  rows: Record<string, unknown>[],
): { rowCount: number; timeMin: string | null; timeMax: string | null } {
  let timeMin: string | null = null;
  let timeMax: string | null = null;
  for (const c of columns) {
    if (!isTemporalName(c)) continue;
    const times = rows.map((r) => Date.parse(String(r[c] ?? ""))).filter((t) => !isNaN(t));
    if (times.length === 0) continue;
    timeMin = new Date(Math.min(...times)).toISOString();
    timeMax = new Date(Math.max(...times)).toISOString();
    break;
  }
  return { rowCount: rows.length, timeMin, timeMax };
}

function samplePreview(
  columns: string[],
  rows: Record<string, unknown>[],
  opts: { granularity?: string; unit?: string; threshold?: number | null; semantics?: string } = {},
): string {
  const profile = JSON.parse(buildDataProfile(columns, rows, opts)) as Record<string, unknown>;
  let rowCount = 6;
  let out = "";
  // Trim sample rows (6→3→1) until the whole message fits the budget.
  for (;;) {
    const head = rows.slice(0, rowCount).map((r) => {
      const o: Record<string, unknown> = {};
      for (const c of columns) o[c] = r[c];
      return o;
    });
    out = JSON.stringify({ columns, profile, sample_rows: head }, null, 1);
    if (opts.semantics) out += `\n\n${opts.semantics}`;
    if (out.length <= PROMPT_BUDGET || rowCount <= 1) break;
    rowCount = rowCount > 3 ? 3 : 1;
  }
  return out;
}

export interface RecommendReason {
  /** Null on an LLM-backed result; otherwise why the heuristic was stored. */
  reason: LlmFailReason | "no-valid-candidates" | null;
}

type LlmCandidate = Partial<ChartSuggestion> & { rank?: number };

export interface DroppedColumns {
  /** Names the model returned that match no real column (invented/renamed). */
  invented: string[];
  /** Names accepted after case-canonicalization to the true spelling. */
  renamed: { from: string; to: string }[];
}

function sanitizeCandidates(
  raw: unknown,
  columns: string[],
  rows: Record<string, unknown>[],
  granularity: string,
  threshold: number | null,
  thresholdRows: ThresholdCondition[] = []
): { suggestions: ChartSuggestion[]; dropped: DroppedColumns } {
  const cols = new Set(columns);
  // Verbatim-copy checker: exact match accepts; case-only drift is
  // canonicalized to the true spelling (counted, visible); anything else
  // is invented and dropped (counted, visible) — never stored silently.
  const canon = new Map<string, string>();
  for (const c of columns) canon.set(c.toLowerCase(), c);
  const dropped: DroppedColumns = { invented: [], renamed: [] };
  function resolve(name: unknown): string | null {
    if (typeof name !== "string" || !name) return null;
    if (cols.has(name)) return name;
    const hit = canon.get(name.toLowerCase());
    if (hit) {
      if (!dropped.renamed.some((r) => r.from === name && r.to === hit)) {
        dropped.renamed.push({ from: name, to: hit });
      }
      return hit;
    }
    if (!dropped.invented.includes(name)) dropped.invented.push(name);
    return null;
  }
  const arr = Array.isArray(raw) ? raw : (raw as { candidates?: unknown })?.candidates;
  if (!Array.isArray(arr)) return { suggestions: [], dropped };
  const nums = numericCols(rows, columns);
  const out: ChartSuggestion[] = [];
  // line/area are mutually exclusive per X+Y (near-identical render): keep
  // the first-ranked of the pair, drop the later duplicate. Bar/histogram
  // on the same X+Y are genuine alternatives and survive.
  const seenTrend = new Set<string>();
  for (const c of arr.slice(0, 6)) {
    const cand = c as LlmCandidate;
    if (!cand || !["table", "line", "bar", "area", "histogram"].includes(cand.chartType ?? "")) continue;
    const xCol = resolve(cand.xColumn);
    if (!xCol) continue;
    if (cand.chartType === "histogram") {
      // Histogram: X is the value column; Y normalizes to [X].
      if (!nums.includes(xCol)) continue;
      const key = `hist|${xCol.toLowerCase()}`;
      if (seenTrend.has(key)) continue;
      seenTrend.add(key);
      out.push({
        chartType: "histogram",
        xColumn: xCol,
        yColumns: [xCol],
        title: typeof cand.title === "string" ? cand.title.slice(0, 120) : `${xCol} distribution`,
        rationale: typeof cand.rationale === "string" ? cand.rationale.slice(0, 500) : "",
        conditions: typeof cand.conditions === "string" ? cand.conditions.slice(0, 300) : "",
        enabled: true,
        resolutions: [...RESOLUTION_LADDER],
        xCondition: { column: xCol, bucket: granularity },
        yConditions: yConditionsFor([xCol], thresholdRows, threshold),
      });
      continue;
    }
    const y = Array.isArray(cand.yColumns) ? cand.yColumns.map(resolve).filter((v): v is string => v != null) : [];
    const yOk = y.filter((col) => nums.includes(col));
    if (cand.chartType !== "table" && yOk.length === 0) continue;
    // Fallback-only: a table beside plottable charts is noise. It survives
    // only when nothing numeric plots (handled by the heuristic path).
    if (cand.chartType === "table" && nums.length > 0) continue;
    const yCols = cand.chartType === "table" ? [] : yOk.slice(0, 4);
    if (cand.chartType === "line" || cand.chartType === "area") {
      const key = `trend|${xCol.toLowerCase()}|${[...yCols].sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1).join(",").toLowerCase()}`;
      if (seenTrend.has(key)) continue;
      seenTrend.add(key);
    }
    out.push({
      chartType: cand.chartType as ChartSuggestion["chartType"],
      xColumn: xCol,
      yColumns: yCols,
      title: typeof cand.title === "string" ? cand.title.slice(0, 120) : `${xCol} chart`,
      rationale: typeof cand.rationale === "string" ? cand.rationale.slice(0, 500) : "",
      conditions: typeof cand.conditions === "string" ? cand.conditions.slice(0, 300) : "",
      enabled: true,
      resolutions: [...RESOLUTION_LADDER],
      xCondition: { column: xCol, bucket: granularity },
      yConditions: yConditionsFor(yCols, thresholdRows, threshold),
    });
  }
  return { suggestions: out, dropped };
}

/**
 * Windowed sampler with fallbacks (shared by template + card previews).
 * Explicit window wins; otherwise walks 1d → 7d → 30d → 365d so sparse or
 * old demo data still yields a sample instead of "no rows". Read-only, no
 * run footprint (unlike test runs, which stay strict for Go-live honesty).
 * Returns the window that actually produced rows.
 */
export async function sampleWithFallback(
  conn: ConnectionRecord,
  sqlTemplate: string,
  from?: string,
  to?: string,
): Promise<{ columns: string[]; rows: Record<string, unknown>[]; from: string; to: string }> {
  const windows: { from: string; to: string }[] = [];
  if (from || to) {
    windows.push({
      from: from ?? new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      to: to ?? new Date().toISOString(),
    });
  } else {
    const now = Date.now();
    for (const days of [1, 7, 30, 365]) {
      windows.push({ from: new Date(now - days * 86400 * 1000).toISOString(), to: new Date(now).toISOString() });
    }
  }
  let last = windows[0];
  for (const w of windows) {
    const sql = sqlTemplate.replaceAll("{{from}}", w.from).replaceAll("{{to}}", w.to);
    assertReadonly(sql);
    const rows = await driverFor(conn).queryReadonly<Record<string, unknown>>(conn, sql);
    if (rows.length > 0) {
      return { columns: Object.keys(rows[0]), rows: rows.slice(0, SAMPLE_ROWS), from: w.from, to: w.to };
    }
    last = w;
  }
  return { columns: [], rows: [], from: last.from, to: last.to };
}

/** Run a template's SQL against its reference line for a small sample.
 *  Returns the window that actually produced rows (explicit windows never
 *  fall back inside sampleWithFallback — callers retry window-less). */
async function sampleForTemplate(tpl: CardTemplate, from?: string, to?: string): Promise<{ columns: string[]; rows: Record<string, unknown>[]; from: string; to: string }> {
  if (!tpl.referenceLineId) throw new Error("template has no reference line — set one first");
  const line = getLine(tpl.referenceLineId);
  if (!line) throw new Error("reference line not found");
  const conn = getConnection(line.connectionId);
  if (!conn) throw new Error("connection not found");
  const s = await sampleWithFallback(conn, tpl.sqlTemplate, from, to);
  return { columns: s.columns, rows: s.rows, from: s.from, to: s.to };
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

/**
 * Shared recommend pipeline: sample in, ranked suggestions out. Used by the
 * stored-template route, the card route, and the unsaved-draft route — one
 * prompt, one sanitizer, one enricher, never three diverging copies.
 */
export async function recommendCore(o: {
  log: FastifyInstance["log"];
  context: Record<string, unknown>;
  /** First user line, e.g. `Feature: smoke (granularity hourly, unit "°C").` */
  label: string;
  granularity: string;
  unit: string;
  threshold: number | null;
  /** Full definition rows (templates): prompt block + direction-aware lines. */
  thresholdRows?: ThresholdCondition[];
  semantics: string;
  meanings: ReturnType<typeof listLineColumnMeta>;
  sample: { columns: string[]; rows: Record<string, unknown>[] };
}): Promise<{
  suggestions: ChartSuggestion[];
  model: string | null;
  heuristic: boolean;
  reason: LlmFailReason | "no-valid-candidates" | null;
  dropped: { invented: string[]; renamed: { from: string; to: string }[] };
  prompt: { system: string; user: string };
}> {
  const rows = o.thresholdRows ?? [];
  const fallback = heuristicSuggestions(o.sample.columns, o.sample.rows, o.unit, o.threshold, o.granularity, rows);
  const block = buildThresholdsBlock(rows);
  const user = `${o.label}\nData:\n${samplePreview(o.sample.columns, o.sample.rows, { granularity: o.granularity, unit: o.unit, threshold: o.threshold, semantics: o.semantics })}${block ? `\n\n${block}` : ""}`;
  const r = await llmChatJson({
    system: CHART_SYSTEM,
    user,
    schema: chartCandidatesSchema,
    context: o.context,
    log: o.log,
  });
  const prompt = { system: CHART_SYSTEM, user };
  const checked = r.parsed
    ? sanitizeCandidates(toCandidateArray(r.parsed), o.sample.columns, o.sample.rows, o.granularity, o.threshold, rows)
    : { suggestions: [], dropped: { invented: [], renamed: [] } };
  const raw = checked.suggestions.length > 0 ? checked.suggestions : fallback;
  const sum = summarizeSample(o.sample.columns, o.sample.rows);
  const suggestions = raw.map((s) =>
    completeSuggestion(s, {
      unit: o.unit,
      granularity: o.granularity,
      meanings: o.meanings,
      rowCount: sum.rowCount,
      timeMin: sum.timeMin,
      timeMax: sum.timeMax,
    }),
  );
  const reason: LlmFailReason | "no-valid-candidates" | null =
    checked.suggestions.length > 0 ? null : (r.reason ?? "no-valid-candidates");
  // Prompt echo: powers the preview "AI → Details" view (exact sent text).
  // Included on heuristic results too ("what would be sent").
  return { suggestions, model: r.model || null, heuristic: checked.suggestions.length === 0, reason, dropped: checked.dropped, prompt };
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
      let s = await sampleForTemplate(tpl, p.data.from, p.data.to);
      // Explicit windows miss stale data (e.g. hourly on old tables) — the
      // card sample route 409s here and the UI retries; templates instead
      // retry server-side into the widest non-empty window so previews
      // self-heal without a second round-trip.
      if (s.rows.length === 0 && (p.data.from || p.data.to)) {
        s = await sampleForTemplate(tpl);
      }
      return { columns: s.columns, rows: s.rows.slice(0, SAMPLE_ROWS), rowCount: s.rows.length, from: s.from, to: s.to };
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message });
    }
  });

  /**
   * Small sample of a card's SQL on its own line — powers card-level chart
   * previews (Graph designer modal, Details minis). Same fallback windows
   * as templates; read-only with no run footprint (test runs stay strict).
   */
  app.post("/api/ingest/cards/:id/sample", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = z.object({ from: z.string().optional(), to: z.string().optional() }).safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    const card = getCard(id);
    if (!card) return reply.code(404).send({ error: "card not found" });
    const line = getLine(card.lineId);
    if (!line) return reply.code(404).send({ error: "line not found" });
    const conn = getConnection(line.connectionId);
    if (!conn) return reply.code(404).send({ error: "connection not found" });
    try {
      const s = await sampleWithFallback(conn, card.sql, p.data.from, p.data.to);
      if (s.rows.length === 0) {
        return reply.code(409).send({ error: "query returned no rows in the last 365 days — nothing to preview" });
      }
      return { columns: s.columns, rows: s.rows, rowCount: s.rows.length, from: s.from, to: s.to };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
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
    const body = (req.body ?? {}) as { from?: string; to?: string };
    let sample: { columns: string[]; rows: Record<string, unknown>[] };
    try {
      sample = await sampleForTemplate(tpl, body.from, body.to);
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message });
    }
    if (sample.rows.length === 0) return reply.code(409).send({ error: "reference query returned no rows — nothing to recommend from" });
    const meanings = tpl.referenceLineId ? listLineColumnMeta(tpl.referenceLineId) : [];
    const semantics = tpl.referenceLineId
      ? buildSemanticsBlock(
          tpl.sqlTemplate,
          { description: tpl.description, context: tpl.context, extractHint: tpl.extractHint },
          meanings,
        )
      : "";
    const r = await recommendCore({
      log: app.log,
      context: { route: "recommend-template", templateId: id },
      label: `Feature: ${tpl.name} (granularity ${tpl.granularity}, unit "${tpl.unit || "none"}").`,
      granularity: tpl.granularity,
      unit: tpl.unit,
      // Row 1 drives the profile number; all rows drive block + warn lines.
      threshold: tpl.thresholds[0]?.value ?? null,
      thresholdRows: tpl.thresholds,
      semantics,
      meanings,
      sample,
    });
    updateTemplate(id, { chartSuggestions: r.suggestions });
    return { ...r, stored: true };
  });

  /**
   * Recommend charts for an UNSAVED draft (template form Suggest flow): same
   * pipeline as stored templates, transient inputs, nothing written.
   */
  app.post("/api/ingest/templates/recommend-draft", async (req, reply) => {
    const p = z.object({
      name: z.string().max(120).default(""),
      description: z.string().max(2000).default(""),
      sqlTemplate: z.string().min(1).max(20000),
      unit: z.string().max(20).default(""),
      granularity: z.string().max(20).default("hourly"),
      threshold: z.number().nullable().default(null),
      thresholdRows: z.array(z.object({
        name: z.string().max(120).default(""),
        column: z.string().min(1).max(120),
        direction: z.enum(["above", "below"]).default("above"),
        value: z.number(),
        comment: z.string().max(500).default(""),
      })).max(2).default([]),
      referenceLineId: z.string().min(1),
    }).safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    const b = p.data;
    const line = getLine(b.referenceLineId);
    if (!line) return reply.code(404).send({ error: "line not found" });
    const conn = getConnection(line.connectionId);
    if (!conn) return reply.code(404).send({ error: "connection not found" });
    let sample;
    try {
      sample = await sampleWithFallback(conn, b.sqlTemplate);
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message });
    }
    if (sample.rows.length === 0) return reply.code(409).send({ error: "draft query returned no rows — nothing to recommend from" });
    const meanings = listLineColumnMeta(line.id);
    const semantics = buildSemanticsBlock(
      b.sqlTemplate,
      { description: b.description, context: "", extractHint: "" },
      meanings,
    );
    const rows = parseThresholds(b.thresholdRows);
    const r = await recommendCore({
      log: app.log,
      context: { route: "recommend-draft", lineId: line.id },
      label: `Feature: ${b.name || "(unsaved draft)"} (granularity ${b.granularity}, unit "${b.unit || "none"}").`,
      granularity: b.granularity,
      unit: b.unit,
      threshold: b.threshold ?? rows[0]?.value ?? null,
      thresholdRows: rows,
      semantics,
      meanings,
      sample: { columns: sample.columns, rows: sample.rows },
    });
    return { ...r, stored: false };
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
    const semantics = buildSemanticsBlock(
      card.sql,
      { description: card.name, context: card.context, extractHint: card.extractHint },
      listLineColumnMeta(card.lineId),
    );
    const r = await recommendCore({
      log: app.log,
      context: { route: "recommend-card", cardId: id },
      label: `Card: ${card.name} (granularity ${card.granularity}, unit "${card.unit || "none"}", threshold ${card.threshold ?? "none"}).`,
      granularity: card.granularity,
      unit: card.unit,
      threshold: card.threshold,
      semantics,
      meanings: listLineColumnMeta(card.lineId),
      sample: t,
    });
    return { ...r, stored: false };
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
