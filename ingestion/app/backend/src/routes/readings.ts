import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createReading, getReading, listReadings } from "../db/store.js";
import { llmChatJson } from "../llm/client.js";

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

function buildUserEnvelope(b: z.infer<typeof snapshotBody>): string {
  const thr = b.threshold != null ? `${b.threshold} °C, breach direction: ${b.breachDirection} (ground truth, obey exactly).` : "none stated.";
  return [
    `Read this ${b.chartType} chart: "${b.title || b.cardId}" (${b.resolution}).`,
    `Window: ${b.windowFrom || "?"} .. ${b.windowTo || "?"} (${b.plottedPoints} plotted points). UTC.`,
    `X means "${b.xTitle || "time"}"; Y means "${b.yTitle || "value"}". Series: ${b.series || "?"}.`,
    `Stats on plotted data: ${b.stats || "n/a"}.`,
    `Threshold: ${thr}`,
    b.extractHint ? `Extract hint: ${b.extractHint}` : "Extract hint: none.",
    "Quirk verdicts to obey: none. Prior readings (same stream): none. History pack: none.",
    "Open tickets to decide: none.",
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
    const user = buildUserEnvelope(b);
    const r = await llmChatJson({
      system: STEP1_SYSTEM,
      user,
      images: [b.imageB64],
      schema: readingSchema,
      context: { route: "readings/snapshot-read", lineId: b.lineId, cardId: b.cardId },
      log: req.log,
    });
    const prompt = `SYSTEM:\n${STEP1_SYSTEM}\n\nUSER:\n${user}`;
    if (r.parsed) {
      const v: Reading = r.parsed;
      const summary = v.unreadable ? "Unreadable image — no verdict." : v.reading || (v.breach ? "Threshold breached." : "No breach.");
      const id = createReading({
        lineId: b.lineId,
        cardId: b.cardId,
        chartKey: b.chartKey,
        status: "done",
        breach: v.unreadable ? false : v.breach,
        summary,
        readingJson: JSON.stringify(v),
        prompt,
        responseText: r.text,
        reason: "",
        llmCallId: r.llmCallId,
        imageB64: b.imageB64,
        thumbB64: b.thumbB64,
      });
      return { id, status: "done", breach: v.breach, summary, model: r.model, llmCallId: r.llmCallId };
    }
    // Failure still lands a row — triage visibility, never silent.
    const id = createReading({
      lineId: b.lineId,
      cardId: b.cardId,
      chartKey: b.chartKey,
      status: "error",
      breach: false,
      summary: `Read failed (${r.reason ?? "unknown"}) — retry Snapshot & Read.`,
      readingJson: "{}",
      prompt,
      responseText: r.text,
      reason: r.reason,
      llmCallId: r.llmCallId,
      imageB64: b.imageB64,
      thumbB64: b.thumbB64,
    });
    return { id, status: "error", breach: false, reason: r.reason, model: r.model, llmCallId: r.llmCallId };
  });

  app.get("/api/ingest/readings", async (req) => {
    const p = z
      .object({
        line: z.string().max(128).optional(),
        card: z.string().max(128).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .safeParse(req.query);
    if (!p.success) return { rows: [], total: 0, error: p.error.message };
    return listReadings({ lineId: p.data.line, cardId: p.data.card, limit: p.data.limit, offset: p.data.offset });
  });

  app.get("/api/ingest/readings/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = getReading(Number(id));
    if (!row) return reply.code(404).send({ error: "reading not found" });
    return row;
  });
}
