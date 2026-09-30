import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createReading, getCard, getReading, listReadings, listTickets, setReadingLoop } from "../db/store.js";
import { llmChatJson } from "../llm/client.js";
import type { Logger } from "../logger.js";
import { applyReadingLoop, type LoopQuestion, type LoopVerdict } from "../loop.js";
import { capTableRows } from "../rollup.js";

/**
 * Line 360° context loop, phase P1: chart snapshot → Step-1 LLM read →
 * persisted chart_readings row. Manual trigger only (zero surprise cost).
 *
 * Prompt wording mirrors the proven dry-run
 * (ingestion/context-step-1/{system.txt,user_template.txt}); the frozen
 * files stay the source of truth, this const is their runtime copy.
 */
const STEP1_SYSTEM = `You read plant sensor charts for a shift supervisor. An image plus a metadata envelope are attached. Reply with JSON only, no prose, no fences.

RULES (hard, in order):
1. OBEY threshold rules in the envelope as ground truth — including inverted logic ("below X is danger") and bands. Obey quirk verdicts and setter notes the same way.
2. RECOMPUTE verdicts yourself: no input states the outcome for this window. Compare observed peak against the threshold in the stated direction, cite evidence, set breach true/false. If any input claims a verdict for this window, ignore the claim and recompute.
3. CITE ONLY what the axes, legend, and stats show. Timing vocabulary depends on resolution: intraday charts use HH:MM labeled ticks; daily+ charts use YYYY-MM-DD date labels in peakDay (peakAt stays null); histograms use bin-range labels in binRange (at/between are FORBIDDEN on histograms — bins are not times). Approximate timing is legal ONLY as {at: null, between: [a, b]} with lowered confidence. A guessed timestamp is a failed reading. NEVER trend-read a partial last bucket: if the envelope flags an incomplete final bucket, say so and exclude it from trend language.
4. NEVER invent: no quirks beyond the envelope's quirk verdicts, no thresholds beyond the stated one, no source sampling-rate claims, no causes for patterns (describe shape, label cause unknown).
5. CHART-TYPE BRANCH: line/area → trend + level vs threshold + anomalies. Histogram → shape + peak bin + outliers; never trend language about bins.
6. TICKET AUTHORITY: for each open ticket return keep-open (still unclear), closed (answered by new data, state reason), or escalated (urgent AND still open). Never silently drop a ticket. New questions: at most 3 per reading, each with evidence; empty array is valid and expected on normal days — never open filler.
7. CONFIDENCE 0-1 on every claim-bearing field; unreadable image → {"unreadable": true} and stop.

OUTPUT SHAPE:
{"chartRef": "...", "resolution": "...", "trend": "rising|falling|flat|seasonal|unclear",
 "level": "below|approaching|breaching", "breach": true|false, "peak": number|null, "peakAt": "HH:MM"|null,
 "peakBetween": ["HH:MM","HH:MM"]|null, "threshold": number, "breachDirection": "above|below",
 "anomalies": [{"at": "HH:MM"|null, "between": [...]|null, "binRange": "..."|null, "what": "..."}],
 "peakDay": "YYYY-MM-DD"|null, "binRange": "..."|null,
 "distribution": null|{"shape": "...", "peakBin": "...", "outliers": "..."},
 "crossCheck": "...", "reading": "one plain sentence", "confidence": 0.0-1.0,
 "questionVerdicts": [{"ticketId": 0, "verdict": "keep-open|closed|escalated", "reason": "..."}],
 "newQuestions": [{"question": "...", "evidence": "..."}]}`;

const readingSchema = z.object({
  chartRef: z.string().default(""),
  resolution: z.string().default(""),
  trend: z.enum(["rising", "falling", "flat", "seasonal", "unclear"]).default("unclear"),
  level: z.enum(["below", "approaching", "breaching"]).default("below"),
  breach: z.boolean(),
  peak: z.number().nullable().default(null),
  peakAt: z.string().nullable().default(null),
  threshold: z.number().nullable().default(null),
  breachDirection: z.enum(["above", "below"]).default("above"),
  reading: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0),
  unreadable: z.boolean().optional(),
}).catchall(z.unknown());

type Reading = z.infer<typeof readingSchema>;

const snapshotBody = z.object({
  lineId: z.string().min(1).max(128),
  cardId: z.string().min(1).max(128),
  chartKey: z.string().max(64).default(""),
  chartType: z.string().max(32).default("line"),
  title: z.string().max(200).default(""),
  resolution: z.string().max(32).default("hourly"),
  windowFrom: z.string().max(64).default(""),
  windowTo: z.string().max(64).default(""),
  plottedPoints: z.number().int().min(0).default(0),
  xTitle: z.string().max(120).default(""),
  yTitle: z.string().max(120).default(""),
  series: z.string().max(200).default(""),
  stats: z.string().max(500).default(""),
  threshold: z.number().nullable().default(null),
  breachDirection: z.enum(["above", "below"]).default("above"),
  extractHint: z.string().max(500).default(""),
  imageB64: z.string().min(100).max(7_000_000),
  thumbB64: z.string().max(1_000_000).optional(),
});

/** Loop closure context shared by snapshot + table envelopes. */
function loopContext(lineId: string, cardId: string): { priorBlock: string; openBlock: string } {
  const open = listTickets({ lineId, status: "open", limit: 20 }).rows.filter(
    (t) => !cardId || !t.cardId || t.cardId === cardId
  );
  const openBlock =
    open.length === 0
      ? "Open tickets to decide: none."
      : `Open tickets to decide:\n${open.map((t) => `#${t.id}: ${t.title} — ${t.aiReason.slice(0, 300)}`).join("\n")}`;
  const prior = listReadings({ lineId, cardId: cardId || undefined, limit: 3 }).rows;
  const priorBlock =
    prior.length === 0
      ? "Prior readings (same stream): none."
      : `Prior readings (same stream):\n${prior.map((r) => `#${r.id} @ ${r.at}: ${r.summary}`).join("\n")}`;
  return { priorBlock, openBlock };
}

function buildUserEnvelope(b: z.infer<typeof snapshotBody>): string {
  const thr = b.threshold != null ? `${b.threshold} °C, breach direction: ${b.breachDirection} (ground truth, obey exactly).` : "none stated.";
  const { priorBlock, openBlock } = loopContext(b.lineId, b.cardId);
  // 6a: table-include scope declares which tables this card reads.
  const card = b.cardId ? getCard(b.cardId) : null;
  const scopeTables = card?.includeTables?.length ? card.includeTables.join(", ") : (card?.tables.join(", ") || "all line member tables");
  return [
    `Read this ${b.chartType} chart: "${b.title || b.cardId}" (${b.resolution}).`,
    `Window: ${b.windowFrom || "?"} .. ${b.windowTo || "?"} (${b.plottedPoints} plotted points). UTC.`,
    `X means "${b.xTitle || "time"}"; Y means "${b.yTitle || "value"}". Series: ${b.series || "?"}.`,
    `Stats on plotted data: ${b.stats || "n/a"}.`,
    `Threshold: ${thr}`,
    b.extractHint ? `Extract hint: ${b.extractHint}` : "Extract hint: none.",
    `Tables in scope: ${scopeTables}.`,
    "Quirk verdicts to obey: none.",
    priorBlock,
    "History pack: none.",
    openBlock,
    "Analyze per the system rules and reply with the reading JSON only.",
  ].join("\n");
}

export async function readingRoutes(app: FastifyInstance) {
  app.post("/api/ingest/readings/snapshot-read", { bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    const p = snapshotBody.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    const b = p.data;
    if (!b.imageB64.startsWith("data:image/")) {
      return reply.code(400).send({ error: "imageB64 must be a data:image/* URL" });
    }
    // Gap 5: prefill- prefix is walker-reserved (era filter relies on it).
    if (b.chartKey.startsWith("prefill-")) {
      return reply.code(400).send({ error: "chartKey prefix 'prefill-' is reserved for walker-born readings" });
    }
    return runStep1(req.log, {
      lineId: b.lineId,
      cardId: b.cardId,
      chartKey: b.chartKey,
      user: buildUserEnvelope(b),
      images: [b.imageB64],
      imageB64: b.imageB64,
      thumbB64: b.thumbB64,
    });
  });

  /**
   * 6b table-only read: for chartMode-off cards. No image in, none stored —
   * the model cites row values instead of axes. Same schema, same loop.
   */
  app.post("/api/ingest/readings/table-read", { bodyLimit: 2 * 1024 * 1024 }, async (req, reply) => {
    const p = z.object({
      lineId: z.string().min(1).max(128),
      cardId: z.string().min(1).max(128),
      chartKey: z.string().max(64).default("table"),
      resolution: z.string().max(32).default("hourly"),
      windowFrom: z.string().max(64).default(""),
      windowTo: z.string().max(64).default(""),
      columns: z.array(z.string().max(64)).min(1).max(30),
      rows: z.array(z.record(z.string(), z.unknown())).min(1).max(60),
      stats: z.string().max(1000).default(""),
      threshold: z.number().nullable().default(null),
      breachDirection: z.enum(["above", "below"]).default("above"),
    }).safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    const b = p.data;
    const user = buildTableEnvelope(b);
    if (!user) return reply.code(404).send({ error: "card not found" });
    // Gap 5: prefill- prefix is walker-reserved (era filter relies on it).
    if (b.chartKey.startsWith("prefill-")) {
      return reply.code(400).send({ error: "chartKey prefix 'prefill-' is reserved for walker-born readings" });
    }
    const card = getCard(b.cardId);
    if (card?.chartMode !== "off") {
      return reply.code(409).send({ error: "card chartMode is not off — use snapshot-read for charted cards" });
    }
    return runStep1(req.log, { lineId: b.lineId, cardId: b.cardId, chartKey: b.chartKey, user, images: [] });
  });

  app.get("/api/ingest/readings", async (req) => {
    const p = z
      .object({
        line: z.string().max(128).optional(),
        card: z.string().max(128).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        era: z.enum(["live", "all"]).default("all"),
      })
      .safeParse(req.query);
    if (!p.success) return { rows: [], total: 0, error: p.error.message };
    return listReadings({ lineId: p.data.line, cardId: p.data.card, limit: p.data.limit, offset: p.data.offset, liveOnly: p.data.era === "live" });
  });

  app.get("/api/ingest/readings/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = getReading(Number(id));
    if (!row) return reply.code(404).send({ error: "reading not found" });
    return row;
  });
}

/**
 * Shared Step-1 runner: envelope → LLM read → persist → loop.
 * Snapshot path attaches the chart image; table path cites rows instead
 * (6b: chartMode off — no image rendered, stored, or needed). Exported for
 * the prefill walker: history earns the same read as live, same loop.
 */
export async function runStep1(
  log: Logger,
  args: {
    lineId: string;
    cardId: string;
    chartKey: string;
    user: string;
    images: string[];
    imageB64?: string | null;
    thumbB64?: string | null;
  }
) {
  const r = await llmChatJson({
    system: STEP1_SYSTEM,
    user: args.user,
    images: args.images,
    schema: readingSchema,
    context: { route: "readings/step1", lineId: args.lineId, cardId: args.cardId },
    log,
  });
  const prompt = `SYSTEM:\n${STEP1_SYSTEM}\n\nUSER:\n${args.user}`;
  if (r.parsed) {
    const v: Reading = r.parsed;
    const summary = v.unreadable ? "Unreadable input — no verdict." : v.reading || (v.breach ? "Threshold breached." : "No breach.");
    const raw = v as unknown as Record<string, unknown>;
    const questions = (Array.isArray(raw.newQuestions) ? raw.newQuestions : []) as LoopQuestion[];
    const verdicts = (Array.isArray(raw.questionVerdicts) ? raw.questionVerdicts : []) as LoopVerdict[];
    const id = createReading({
      lineId: args.lineId,
      cardId: args.cardId,
      chartKey: args.chartKey,
      status: "done",
      breach: v.unreadable ? false : v.breach,
      summary,
      readingJson: JSON.stringify(v),
      prompt,
      responseText: r.text,
      reason: "",
      llmCallId: r.llmCallId,
      imageB64: args.imageB64 ?? null,
      thumbB64: args.thumbB64 ?? null,
    });
    let loop: Awaited<ReturnType<typeof applyReadingLoop>> | null = null;
    try {
      if (!v.unreadable) {
        loop = await applyReadingLoop(log, id, args.lineId, args.cardId, questions, verdicts);
        // Gap 2: the row keeps the decisions — why the bank looks this way.
        try {
          setReadingLoop(id, loop);
        } catch {
          /* loop report is audit, never fatal */
        }
      }
    } catch (e) {
      log.warn({ lineId: args.lineId, readingId: id, error: (e as Error).message }, "reading loop skipped");
    }
    return { id, status: "done", breach: v.breach, summary, model: r.model, llmCallId: r.llmCallId, loop };
  }
  // Failure still lands a row — triage visibility, never silent.
  const id = createReading({
    lineId: args.lineId,
    cardId: args.cardId,
    chartKey: args.chartKey,
    status: "error",
    breach: false,
    summary: `Read failed (${r.reason ?? "unknown"}) — retry.`,
    readingJson: "{}",
    prompt,
    responseText: r.text,
    reason: r.reason,
    llmCallId: r.llmCallId,
    imageB64: args.imageB64 ?? null,
    thumbB64: args.thumbB64 ?? null,
  });
  return { id, status: "error", breach: false, reason: r.reason, model: r.model, llmCallId: r.llmCallId };
}

export interface TableReadInput {
  lineId: string;
  cardId: string;
  chartKey: string;
  resolution: string;
  windowFrom: string;
  windowTo: string;
  columns: string[];
  rows: Record<string, unknown>[];
  stats: string;
  threshold: number | null;
  breachDirection: "above" | "below";
}

/** Table envelope shared by the manual table-read route and the walker. */
export function buildTableEnvelope(b: TableReadInput): string | null {
  const card = getCard(b.cardId);
  if (!card) return null;
  const thr = b.threshold ?? card.threshold;
  const { priorBlock, openBlock } = loopContext(b.lineId, b.cardId);
  // #6 table guardrail: latest 50 rows max, truncation stated, never silent.
  const capped = capTableRows(b.rows);
  return [
    `Read this data table for card "${b.cardId}" (${b.resolution}). NO IMAGE ATTACHED — cite row values, never axes or pixels. Timing comes from the time-column values.`,
    `Window: ${b.windowFrom || "?"} .. ${b.windowTo || "?"} (${capped.rows.length} rows shown${capped.truncated ? `, latest ${capped.rows.length} of ${capped.total} — earlier rows omitted, do not assume completeness` : ""}). UTC.`,
    `Columns: ${b.columns.join(", ")}.`,
    `Rows (JSON): ${JSON.stringify(capped.rows)}`,
    `Stats on shown rows: ${b.stats || "n/a"}.`,
    `Threshold: ${thr != null ? `${thr}, breach direction: ${b.breachDirection} (ground truth, obey exactly).` : "none stated."}`,
    card.extractHint ? `Extract hint: ${card.extractHint}` : "Extract hint: none.",
    `Tables in scope: ${card.includeTables?.length ? card.includeTables.join(", ") : card.tables.join(", ")}.`,
    "Quirk verdicts to obey: none.",
    priorBlock,
    "History pack: none.",
    openBlock,
    "Analyze per the system rules (adapted: rows instead of chart) and reply with the reading JSON only.",
  ].join("\n");
}
