import {
  activeLlmProvider,
  getCard,
  getReading,
  getRetainState,
  getSetting,
  setRetainState,
  sqlHash,
  type Card,
  type LineRecord,
} from "./db/store.js";
import type { Logger } from "./logger.js";
import { llmChatJson, type LlmFailReason } from "./llm/client.js";
import { draftFactsSchema } from "./llm/schemas.js";

const HS_TIMEOUT_MS = 15000;
/**
 * Retain is submitted with async:true. Hindsight's synchronous path runs its own
 * LLM extraction and took >60s against the local 35B model — far too slow to sit
 * inside a tick. Async returns an operation_id immediately and consolidates in
 * the background; factsStored then counts facts *submitted*.
 */
const HS_ASYNC = true;
/** Cap rows sent to the LLM prompt; samples count still reflects the full set. */
const MAX_ROWS_TO_LLM = 25;
/** Cap facts retained per tick so one wild result set can't flood a bank. */
const MAX_FACTS = 12;

export interface TickWindow {
  from: string;
  to: string;
}

export interface ExtractResult {
  stored: number;
  error: string | null;
  /** Item 8 substrate gate: identical result set skipped (no LLM, no retain). */
  unchanged?: boolean;
  /** Any draft flagged breach — lets callers decide follow-up reads. */
  hadBreach?: boolean;
}

/** Item 8: every Nth unchanged window still retains one liveness fact. */
const HEARTBEAT_EVERY = 12;

function hsBase(): string | null {
  const url = getSetting("hindsight_url");
  if (!url) return null;
  return url.replace(/\/health\/?$/, "");
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** First column with any numeric value (scan all rows; pg numerics arrive as strings). */
function measureColumn(rows: Record<string, unknown>[]): string | null {
  for (const c of Object.keys(rows[0] ?? {})) {
    if (rows.some((r) => num(r[c]) != null)) return c;
  }
  return null;
}

function breachOf(value: number | null, threshold: number | null): boolean {
  return value != null && threshold != null && value >= threshold;
}

interface DraftFact {
  content: string;
  measure: string;
  value: number | null;
  unit: string;
  breach: boolean;
}

async function llmDraft(
  log: Logger,
  card: Card,
  lineId: string,
  w: TickWindow,
  rows: Record<string, unknown>[],
  measure: string,
  resolution: string
): Promise<{ drafts: DraftFact[] | null; reason: LlmFailReason | "empty-result" | null }> {
  const shown = rows.slice(0, MAX_ROWS_TO_LLM);
  const user = [
    `Card: ${card.name} (granularity ${card.granularity}, unit "${card.unit || "none"}", threshold ${card.threshold ?? "none"})`,
    `Extract hint: ${card.extractHint || "(none)"}`,
    `Stream: ${resolution} — ${resolution === "base" ? "finest-resolution samples" : `${resolution} rollup of the base stream (sums for counts, averages otherwise)`}`,
    `Window: ${w.from} .. ${w.to} (${rows.length} buckets)`,
    `Rows (JSON): ${JSON.stringify(shown)}`,
    `Reply with JSON only: an array of {"content","measure","value","unit","breach"}.`,
    `One fact per bucket, at most ${MAX_FACTS}. content = one short sentence with the value + unit.`,
    `measure defaults to "${measure}". value = the numeric reading or null. breach = true only if it crossed the threshold above.`,
  ].join("\n");
  // Tick path is background best-effort: small budget, fast degrade to the
  // deterministic fallback (which invents nothing).
  const r = await llmChatJson({
    system: "You extract durable plant facts from one card's result set. Reply with a JSON array only, no prose, no fences.",
    user,
    schema: draftFactsSchema,
    maxAttempts: 2,
    context: { route: "tick-extract", lineId, cardId: card.id, resolution },
    log,
  });
  if (!r.parsed) return { drafts: null, reason: r.reason };
  const drafts = r.parsed
    .filter((f) => typeof f.content === "string" && f.content.trim().length > 0)
    .slice(0, MAX_FACTS)
    .map((f) => ({
      content: f.content.trim(),
      measure: typeof f.measure === "string" && f.measure ? f.measure : measure,
      value: num(f.value),
      unit: typeof f.unit === "string" ? f.unit : card.unit,
      breach: f.breach === true,
    }));
  if (drafts.length === 0) return { drafts: null, reason: "empty-result" };
  return { drafts, reason: null };
}

/** Honest fallback: values straight from the rows, no invention. */
function deterministicFallback(
  card: Card,
  w: TickWindow,
  rows: Record<string, unknown>[],
  measure: string
): DraftFact[] {
  const timeCol = Object.keys(rows[0] ?? {}).find((c) => /time|date|hour|day|shift|_at$|^ts$/i.test(c));
  return rows.slice(0, MAX_FACTS).map((r) => {
    const value = num(r[measure]);
    const when = timeCol && r[timeCol] != null ? ` at ${String(r[timeCol])}` : "";
    const unit = card.unit ? ` ${card.unit}` : "";
    return {
      content: `${card.name}${when}: ${measure} ${value ?? "?"}${unit} (${rows.length} buckets in window).`,
      measure,
      value,
      unit: card.unit,
      breach: breachOf(value, card.threshold),
    };
  });
}

/**
 * Extraction slice v1 + Item 8 substrate gate: one LLM call per card result
 * set -> retain facts in the line's bank. Never throws — callers treat this
 * as best-effort enrichment of an already-successful tick.
 *
 * Gate: byte-identical consecutive result sets skip LLM + retain (footprinted
 * "unchanged" by the caller via `unchanged: true`); every HEARTBEAT_EVERY-th
 * unchanged window retains one deterministic liveness fact instead.
 */
export async function extractAndRetain(
  log: Logger,
  card: Card,
  line: LineRecord,
  rows: Record<string, unknown>[],
  w: TickWindow,
  resolution = "base",
  dataMode: "live" | "prefill" = "live"
): Promise<ExtractResult> {
  if (rows.length === 0) return { stored: 0, error: null, hadBreach: false };
  const hash = sqlHash(JSON.stringify(rows));
  const state = getRetainState(card.id, resolution);
  if (state.lastHash === hash) {
    const streak = state.unchangedStreak + 1;
    setRetainState(card.id, resolution, hash, streak);
    if (streak % HEARTBEAT_EVERY !== 0) {
      return { stored: 0, error: null, unchanged: true, hadBreach: false };
    }
    // Heartbeat: prove liveness deterministically (no LLM spend) and keep
    // the streak counting so the next heartbeat lands on schedule.
    const measure = measureColumn(rows) ?? "value";
    const beat = deterministicFallback(card, w, rows, measure).slice(0, 1);
    const r = await retainItems(log, line, card, w, resolution, beat, rows.length, dataMode, true);
    return { stored: r.stored, error: r.error, hadBreach: beat.some((d) => d.breach) };
  }

  const active = activeLlmProvider();
  if (!active) return { stored: 0, error: "no active LLM" };
  const base = hsBase();
  if (!base) return { stored: 0, error: "hindsight_url not set" };

  const measure = measureColumn(rows) ?? "value";
  const { drafts: llmDrafts, reason } = await llmDraft(log, card, line.id, w, rows, measure, resolution);
  let drafts = llmDrafts;
  if (!drafts || drafts.length === 0) {
    log.warn({ lineId: line.id, cardId: card.id, reason }, "llm extract failed — deterministic fallback");
    drafts = deterministicFallback(card, w, rows, measure);
  }

  const r = await retainItems(log, line, card, w, resolution, drafts, rows.length, dataMode, false);
  if (!r.error) setRetainState(card.id, resolution, hash, 0);
  return { stored: r.stored, error: r.error, hadBreach: drafts.some((d) => d.breach) };
}

/** Item 8 primary feed: question lifecycle memories (birth + resolution). */
export async function retainQuestionMemory(
  log: Logger,
  args: {
    lineId: string;
    cardId: string;
    readingId: number;
    ticketId: number;
    kind: "question" | "question-resolved";
    title: string;
    evidence: string;
    reason?: string;
    dataMode?: "live" | "prefill";
  }
): Promise<void> {
  try {
    const base = hsBase();
    if (!base) return;
    const card = getCard(args.cardId);
    const reading = getReading(args.readingId);
    let resolution = "";
    try {
      const j = JSON.parse(reading?.readingJson ?? "{}") as { resolution?: unknown };
      if (typeof j.resolution === "string") resolution = j.resolution;
    } catch {
      /* keep empty */
    }
    const content =
      args.kind === "question"
        ? `Open question: ${args.title} Evidence: ${args.evidence}`
        : `Question resolved: ${args.title}${args.reason ? ` ${args.reason}` : ""}`;
    const item = {
      content,
      timestamp: reading?.at ?? new Date().toISOString(),
      ...(card?.context ? { context: card.context } : {}),
      tags: [
        `line:${args.lineId}`,
        `card:${card?.id ?? args.cardId}`,
        `cardName:${card?.name ?? args.cardId}`,
        `cardVersion:${card?.version ?? "?"}`,
        `kind:${args.kind}`,
        `ticket:${args.ticketId}`,
        `reading:${args.readingId}`,
        `dataMode:${args.dataMode ?? "live"}`,
        ...(resolution ? [`resolution:${resolution}`] : []),
      ],
      metadata: {
        line: args.lineId,
        card: args.cardId,
        ticket: String(args.ticketId),
        reading: String(args.readingId),
        kind: args.kind,
      },
    };
    const bankId = `bank:line-${args.lineId}`;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), HS_TIMEOUT_MS);
    try {
      await fetch(`${base}/v1/default/banks/${encodeURIComponent(bankId)}/memories`, {
        method: "POST",
        signal: ctl.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [item], async: HS_ASYNC }),
      });
    } finally {
      clearTimeout(t);
    }
  } catch (e) {
    // Best-effort: a question memory must never break the loop that filed it.
    log.warn({ lineId: args.lineId, ticketId: args.ticketId, error: (e as Error).message }, "question memory skipped");
  }
}
/** Shared retain POST: drafts -> bank memories (async op, count submitted). */
async function retainItems(
  log: Logger,
  line: LineRecord,
  card: Card,
  w: TickWindow,
  resolution: string,
  drafts: DraftFact[],
  sampleCount: number,
  dataMode: "live" | "prefill",
  heartbeat: boolean
): Promise<ExtractResult> {
  const base = hsBase();
  if (!base) return { stored: 0, error: "hindsight_url not set" };
  const items = drafts.map((d) => ({
    content: d.content,
    timestamp: w.to,
    // Per-ingest disambiguation shown alongside the fact (Specifics panel).
    // Omitted when empty so older Hindsight versions see a clean item.
    ...(card.context ? { context: card.context } : {}),
    // Gap 3: card keyed by stable id (rename-proof continuity); human name
    // rides alongside as cardName. Old facts carry card:<name> (legacy).
    tags: [
      `line:${line.id}`,
      `card:${card.id}`,
      `cardName:${card.name}`,
      `cardVersion:${card.version}`,
      `connection:${line.connectionId}`,
      `measure:${d.measure}`,
      `unit:${d.unit || "none"}`,
      `granularity:${card.granularity}`,
      `resolution:${resolution}`,
      `breach:${d.breach}`,
      // Era tag: history grounds, live alerts — recall separates by it.
      `dataMode:${dataMode}`,
      ...(heartbeat ? ["heartbeat:true"] : []),
    ],
    // metadata values must be strings in the Hindsight schema.
    metadata: {
      line: line.id,
      card: card.id,
      cardVersion: String(card.version),
      window: JSON.stringify(w),
      samples: String(sampleCount),
      sqlHash: sqlHash(card.sql),
      // Item 8 cross-resolution lineage: this rollup compresses N base
      // windows over from..to — recall drills down by time overlap.
      derivedFrom: `${sampleCount}x${resolution} windows ${w.from}..${w.to}`,
    },
  }));

  const bankId = `bank:line-${line.id}`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), HS_TIMEOUT_MS);
  try {
    const r = await fetch(`${base}/v1/default/banks/${encodeURIComponent(bankId)}/memories`, {
      method: "POST",
      signal: ctl.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items, async: HS_ASYNC }),
    });
    const body = (await r.json().catch(() => ({}))) as { success?: boolean; items_count?: number; operation_id?: string; error?: string; detail?: string };
    if (!r.ok) return { stored: 0, error: body.error ?? body.detail ?? `Hindsight HTTP ${r.status}` };
    return { stored: body.items_count ?? items.length, error: null };
  } catch (e) {
    return { stored: 0, error: (e as Error).message };
  } finally {
    clearTimeout(t);
  }
}
