import { getConnection, getCoverage, getResolutionRun, listCards, listLines, recordRun, setCoverage, setResolutionRun, touchLineTick, countLlmCallsToday, getCard, type Card, type LineRecord, type StreamResolution } from "./db/store.js";
import type { ConnectionRecord } from "./db/store.js";
import { assertReadonly, driverFor } from "./drivers/index.js";
import { extractAndRetain } from "./extract.js";
import { bucketRowsServer, finestOf, readerDue, spanMs, windowFullySkipped } from "./rollup.js";
import { probeRanges } from "./routes/playground.js";
import { buildTableEnvelope, runStep1 } from "./routes/readings.js";
import type { Logger } from "./logger.js";

const TICK_INTERVAL_MS = Number(process.env.TICK_INTERVAL_MS ?? 5 * 60 * 1000);
/** Prefill walker: own heartbeat, faster than live — history is waiting. */
export const PREFILL_INTERVAL_MS = Number(process.env.PREFILL_INTERVAL_MS ?? 60 * 1000);

/** Live-first rule: the walker never runs while a live tick is in flight. */
let liveInFlight = false;

/** Backfill chunk = this many resolution spans (bounded background drain). */
export const BACKFILL_CHUNK_MULT = 24;
/**
 * Call-count guardrail: Step-1 reads per line per UTC day, shared by manual
 * reads (always pass — humans jump the queue) and walker reads (capped).
 * Money/cost thinking is explicitly deferred; count is the only knob.
 */
export const LLM_READS_PER_DAY = Number(process.env.LLM_READS_PER_DAY ?? 100);

/**
 * Base-sampler window: continuous from the last tick (no gaps), capped at
 * the finest checked stream's span. Wall-clock throughout (no shift anchor).
 */
function windowFor(
  base: "5min" | "hourly" | "daily" | "weekly" | "monthly",
  since: string | null,
  now: Date,
): { from: string; to: string } {
  const span = spanMs(base);
  const to = now;
  return { from: since ?? new Date(to.getTime() - span).toISOString(), to: to.toISOString() };
}

/** First temporal-looking column (reader bucketing needs an X). */
function timeColumn(rows: Record<string, unknown>[]): string | null {
  const cols = Object.keys(rows[0] ?? {});
  return cols.find((c) => /time|date|hour|day|shift|_at$|^ts$|window|bucket/i.test(c)) ?? null;
}

/**
 * Multi-resolution engine: every heartbeat, each LIVE card of each ACTIVE
 * line runs its base sampler (finest checked stream, plant query, continuous
 * windows), then each due coarser checked stream runs as a reader (same SQL
 * over its last complete aligned window, bucketed, extracted + retained with
 * resolution tags). Unchecked streams never run. Every attempt is footprinted
 * (kind=tick, resolution=base|<stream>); extraction stays best-effort and
 * never fails the tick.
 */
export async function runTick(log: Logger): Promise<{ cards: number; ok: number; failed: number }> {
  const now = new Date();
  let cards = 0;
  let ok = 0;
  let failed = 0;
  liveInFlight = true;
  try {
  for (const line of listLines()) {
    if (!line.active) continue;
    const conn = getConnection(line.connectionId);
    if (!conn || !conn.enabled) {
      log.warn({ lineId: line.id }, "tick skipped: connection missing or disabled");
      continue;
    }
    const live = listCards(line.id).filter((c) => c.status === "live");
    for (const card of live) {
      cards++;
      const streams = card.resolutions?.length ? card.resolutions : ["hourly" as const];
      const base = finestOf(streams);
      // ---- base sampler ----
      const started = Date.now();
      const w = windowFor(base, line.lastTick, now);
      // Deliberate skip (weekly schedule): no query, no facts, no error —
      // footprinted as skipped (ok + reason) so History shows intent, not
      // failure. lastTick advances: skipped spans are never backfilled.
      if (windowFullySkipped(card.skipSchedule, w.from, w.to)) {
        recordRun({
          at: now.toISOString(), lineId: line.id, cardId: card.id,
          cardVersion: card.version, kind: "tick", resolution: "base", ok: true,
          rowsPulled: 0, unitsBuilt: 0, factsStored: 0,
          durationMs: Date.now() - started, error: "skipped by schedule",
        });
        touchLineTick(line.id, now.toISOString());
        ok++;
        continue;
      }
      const sql = card.sql.replaceAll("{{from}}", w.from).replaceAll("{{to}}", w.to);
      try {
        assertReadonly(sql);
        const rows = await driverFor(conn).queryReadonly<Record<string, unknown>>(conn, sql);
        // LLM extracts durable facts from this result set and retains them
        // in the line's bank. Best-effort — a Hindsight/LLM outage records
        // the error but never fails the tick.
        const extraction = await extractAndRetain(log, card, line, rows, w, base);
        if (extraction.error) {
          log.warn({ lineId: line.id, cardId: card.id, error: extraction.error }, "fact extraction skipped");
        }
        // Empty windows are footprints, not silence: an ok tick with zero rows
        // records why, so a static source can never starve the bank quietly again.
        const emptyNote = rows.length === 0 ? "empty window — no rows in range (source stale?)" : null;
        if (emptyNote) {
          log.warn({ lineId: line.id, cardId: card.id, from: w.from, to: w.to }, emptyNote);
        }
        recordRun({
          at: now.toISOString(), lineId: line.id, cardId: card.id,
          cardVersion: card.version, kind: "tick", resolution: "base", ok: true,
          rowsPulled: rows.length, unitsBuilt: rows.length, factsStored: extraction.stored,
          durationMs: Date.now() - started,
          error: extraction.error ?? emptyNote ?? (extraction.unchanged ? "unchanged — values held, retain skipped" : null),
        });
        // Coverage start: first non-empty window stamps where ingestion began.
        if (rows.length > 0 && !getCoverage(card.id, base).coverageFrom) {
          setCoverage(card.id, base, { coverageFrom: w.from });
        }
        touchLineTick(line.id, now.toISOString());
        ok++;
      } catch (e) {
        const error = (e as Error).message;
        recordRun({
          at: now.toISOString(), lineId: line.id, cardId: card.id,
          cardVersion: card.version, kind: "tick", resolution: "base", ok: false,
          rowsPulled: 0, unitsBuilt: 0, factsStored: 0,
          durationMs: Date.now() - started, error,
        });
        log.error({ lineId: line.id, cardId: card.id, card: card.name, error }, "tick failed");
        failed++;
      }
      // ---- derived readers (coarser checked streams, due only) ----
      for (const res of streams) {
        if (res === base) continue;
        const { due, window } = readerDue(res, getResolutionRun(card.id, res), now);
        if (!due || !window) continue;
        // Skipped days never run readers — marked done so the stream
        // doesn't retry every heartbeat.
        if (windowFullySkipped(card.skipSchedule, window.from, window.to)) {
          recordRun({
            at: now.toISOString(), lineId: line.id, cardId: card.id,
            cardVersion: card.version, kind: "tick", resolution: res, ok: true,
            rowsPulled: 0, unitsBuilt: 0, factsStored: 0,
            durationMs: 0, error: "skipped by schedule",
          });
          setResolutionRun(card.id, res, window.to);
          continue;
        }
        const rStarted = Date.now();
        try {
          const rSql = card.sql.replaceAll("{{from}}", window.from).replaceAll("{{to}}", window.to);
          assertReadonly(rSql);
          const raw = await driverFor(conn).queryReadonly<Record<string, unknown>>(conn, rSql);
          const xCol = raw.length > 0 ? timeColumn(raw) : null;
          const bucketed = xCol ? bucketRowsServer(raw, xCol, res) : raw;
          const extraction = await extractAndRetain(log, card, line, bucketed, window, res);
          if (extraction.error) {
            log.warn({ lineId: line.id, cardId: card.id, resolution: res, error: extraction.error }, "reader extraction skipped");
          }
          // Same empty-window rule as the base sampler: footprint, don't silence.
          const rEmptyNote = raw.length === 0 ? "empty window — no rows in range (source stale?)" : null;
          if (rEmptyNote) {
            log.warn({ lineId: line.id, cardId: card.id, resolution: res, from: window.from, to: window.to }, rEmptyNote);
          }
          recordRun({
            at: now.toISOString(), lineId: line.id, cardId: card.id,
            cardVersion: card.version, kind: "tick", resolution: res, ok: true,
            rowsPulled: raw.length, unitsBuilt: bucketed.length, factsStored: extraction.stored,
            durationMs: Date.now() - rStarted,
            error: extraction.error ?? rEmptyNote ?? (extraction.unchanged ? "unchanged — values held, retain skipped" : null),
          });
          if (raw.length > 0 && !getCoverage(card.id, res).coverageFrom) {
            setCoverage(card.id, res, { coverageFrom: window.from });
          }
          setResolutionRun(card.id, res, window.to);
        } catch (e) {
          recordRun({
            at: now.toISOString(), lineId: line.id, cardId: card.id,
            cardVersion: card.version, kind: "tick", resolution: res, ok: false,
            rowsPulled: 0, unitsBuilt: 0, factsStored: 0,
            durationMs: Date.now() - rStarted, error: (e as Error).message,
          });
          log.error({ lineId: line.id, cardId: card.id, card: card.name, resolution: res, error: (e as Error).message }, "reader failed");
        }
      }
    }
  }
  } finally {
    liveInFlight = false;
  }
  return { cards, ok, failed };
}

/**
 * Prefill walker pass: all lines/cards, chunk logic unchanged (runBackfill),
 * one chunk per resolution per pass. Stands down while live ticks run and
 * when PREFILL_ENABLED=false. Returns pass stats for F8.
 */
export async function runPrefillPass(log: Logger): Promise<{ cards: number; chunks: number; facts: number; stoodDown: boolean }> {
  if (process.env.PREFILL_ENABLED === "false") return { cards: 0, chunks: 0, facts: 0, stoodDown: true };
  if (liveInFlight) {
    log.info("prefill pass stood down — live tick in flight");
    return { cards: 0, chunks: 0, facts: 0, stoodDown: true };
  }
  const now = new Date();
  let cards = 0;
  let chunks = 0;
  let facts = 0;
  for (const line of listLines()) {
    if (!line.active) continue;
    const conn = getConnection(line.connectionId);
    if (!conn || !conn.enabled) continue;
    const live = listCards(line.id).filter((c) => c.status === "live");
    for (const card of live) {
      if (liveInFlight) return { cards, chunks, facts, stoodDown: true };
      const streams = card.resolutions?.length ? card.resolutions : ["hourly" as const];
      const base = finestOf(streams);
      // 4b scope: prefill walks only allowed streams (null/empty = all).
      // Deselected streams simply never enter the walk — live ticks untouched.
      const scope = card.prefillStreams?.length ? new Set(card.prefillStreams) : null;
      const walkStreams = scope ? streams.filter((s) => scope.has(s)) : streams;
      const got = await runBackfill(log, line, conn, card, walkStreams, base, now);
      if (got.chunks > 0) {
        cards++;
        chunks += got.chunks;
        facts += got.facts;
      }
    }
  }
  return { cards, chunks, facts, stoodDown: false };
}

/**
 * Pre-fill walk for cards with analysisStart earlier than the live cursor.
 * Same query → extract → retain path as live ticks (dataMode "prefill",
 * footprint isBackfill), one chunk per resolution per heartbeat. Skipped
 * spans advance the cursor (never retried); live cursors are never touched.
 */
async function runBackfill(
  log: Logger,
  line: LineRecord,
  conn: ConnectionRecord,
  card: Card,
  streams: StreamResolution[],
  base: StreamResolution,
  now: Date
): Promise<{ chunks: number; facts: number }> {
  const want = (card.analysisStart ?? "").trim();
  // Opt-out: "off" never walks. Default-on: "" means from-start (resolve
  // earliest data) — connecting a line with history starts the walk itself.
  if (want === "off") return { chunks: 0, facts: 0 };
  // Resolve the start: explicit date, or earliest recorded data (probed once —
  // after the cursor initializes we never probe again).
  let start: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(want)) {
    start = `${want}T00:00:00.000Z`;
  } else {
    try {
      const ranges = await probeRanges(conn, line);
      start = ranges.overall.start;
    } catch (e) {
      log.warn({ lineId: line.id, cardId: card.id, error: (e as Error).message }, "backfill start unresolvable — skipping");
      return { chunks: 0, facts: 0 };
    }
  }
  if (!start) return { chunks: 0, facts: 0 };
  let chunks = 0;
  let facts = 0;
  // streams here is already the 4b-scoped allow-list (may exclude base).
  const inScope = new Set(streams);
  const targets: { res: string; liveEnd: string; runResolution: string }[] = [];
  if (inScope.has(base)) {
    targets.push({ res: base, liveEnd: line.lastTick ?? now.toISOString(), runResolution: "base" });
  }
  for (const res of streams) {
    if (res === base) continue;
    targets.push({ res, liveEnd: getResolutionRun(card.id, res) ?? now.toISOString(), runResolution: res });
  }
  for (const t of targets) {
    const cov = getCoverage(card.id, t.runResolution);
    if (cov.paused) continue;
    const cursor = cov.backfillCursor ?? start;
    if (cursor >= t.liveEnd) continue;
    // Chunk = 24 spans (bounded drain: a week of 5-min history walks in ~2h
    // chunks, daily+ in single chunks). Fidelity comes from the SQL, not the
    // chunk size — the chunk is only a window.
    const chunkMs = spanMs(t.res as StreamResolution) * BACKFILL_CHUNK_MULT;
    const chunkTo = new Date(Math.min(new Date(cursor).getTime() + chunkMs, new Date(t.liveEnd).getTime())).toISOString();
    const window = { from: cursor, to: chunkTo };
    const started = Date.now();
    if (windowFullySkipped(card.skipSchedule, window.from, window.to)) {
      recordRun({
        at: now.toISOString(), lineId: line.id, cardId: card.id,
        cardVersion: card.version, kind: "tick", resolution: t.runResolution, ok: true,
        rowsPulled: 0, unitsBuilt: 0, factsStored: 0,
        durationMs: Date.now() - started, error: "skipped by schedule", isBackfill: true,
      });
      setCoverage(card.id, t.runResolution, { backfillCursor: chunkTo });
      chunks++;
      continue;
    }
    try {
      const sql = card.sql.replaceAll("{{from}}", window.from).replaceAll("{{to}}", window.to);
      assertReadonly(sql);
      const raw = await driverFor(conn).queryReadonly<Record<string, unknown>>(conn, sql);
      const xCol = raw.length > 0 ? timeColumn(raw) : null;
      const bucketed = t.runResolution === "base" ? raw : xCol ? bucketRowsServer(raw, xCol, t.res as StreamResolution) : raw;
      const extraction = await extractAndRetain(log, card, line, bucketed, window, t.runResolution, "prefill");
      const emptyNote = raw.length === 0 ? "empty backfill window — no rows in range" : null;
      recordRun({
        at: now.toISOString(), lineId: line.id, cardId: card.id,
        cardVersion: card.version, kind: "tick", resolution: t.runResolution, ok: true,
        rowsPulled: raw.length, unitsBuilt: bucketed.length, factsStored: extraction.stored,
        durationMs: Date.now() - started,
        error: extraction.error ?? emptyNote ?? (extraction.unchanged ? "unchanged — values held, retain skipped" : null),
        isBackfill: true,
      });
      chunks++;
      facts += extraction.stored;
      if (raw.length > 0 && !getCoverage(card.id, t.runResolution).coverageFrom) {
        setCoverage(card.id, t.runResolution, { coverageFrom: window.from });
      }
      setCoverage(card.id, t.runResolution, { backfillCursor: chunkTo });
      // Walker reads: same Step-1 + loop as manual, bounded by rule + budget.
      // Coarse chunks always earn a read; fine chunks only on breach.
      // Unchanged/empty chunks never read (a repeat read would repeat itself).
      if (!extraction.error && raw.length > 0 && !extraction.unchanged) {
        const coarse = t.res === "daily" || t.res === "weekly" || t.res === "monthly";
        if (coarse || extraction.hadBreach) {
          await maybeWalkerRead(log, line, card, t.runResolution, window, bucketed);
        }
      }
    } catch (e) {
      recordRun({
        at: now.toISOString(), lineId: line.id, cardId: card.id,
        cardVersion: card.version, kind: "tick", resolution: t.runResolution, ok: false,
        rowsPulled: 0, unitsBuilt: 0, factsStored: 0,
        durationMs: Date.now() - started, error: (e as Error).message, isBackfill: true,
      });
      chunks++;
      log.error({ lineId: line.id, cardId: card.id, card: card.name, resolution: t.runResolution, error: (e as Error).message }, "backfill chunk failed");
    }
  }
  return { chunks, facts };
}

export function startTicker(log: Logger): NodeJS.Timeout {
  async function tick() {
    try {
      const r = await runTick(log);
      if (r.cards > 0) log.info({ ...r }, "tick complete");
    } catch (e) {
      log.error({ error: (e as Error).message }, "tick crashed");
    }
  }
  void tick();
  return setInterval(() => void tick(), TICK_INTERVAL_MS);
}

/**
 * Walker Step-1 read: the chunk's rows through the shared table envelope +
 * loop. Budget-guarded by call count (humans bypass — enforced only here,
 * never on the manual route). Skips are logged, never silent.
 */
async function maybeWalkerRead(
  log: Logger,
  line: LineRecord,
  card: Card,
  runResolution: string,
  window: { from: string; to: string },
  bucketed: Record<string, unknown>[]
): Promise<void> {
  const used = countLlmCallsToday(line.id, "readings/step1");
  if (used >= LLM_READS_PER_DAY) {
    log.warn({ lineId: line.id, cardId: card.id, used, cap: LLM_READS_PER_DAY }, "walker read skipped — llm budget reached");
    return;
  }
  const full = getCard(card.id);
  const columns = Object.keys(bucketed[0] ?? {});
  if (columns.length === 0) return;
  const user = buildTableEnvelope({
    lineId: line.id,
    cardId: card.id,
    chartKey: `prefill-${runResolution}`,
    resolution: runResolution,
    windowFrom: window.from,
    windowTo: window.to,
    columns,
    rows: bucketed.slice(0, 60),
    stats: `${bucketed.length} rows in prefill window`,
    threshold: full?.threshold ?? card.threshold,
    breachDirection: "above",
  });
  if (!user) return;
  try {
    const r = await runStep1(log, { lineId: line.id, cardId: card.id, chartKey: `prefill-${runResolution}`, user, images: [] });
    log.info({ lineId: line.id, cardId: card.id, readingId: r.id, status: r.status }, "walker read complete");
  } catch (e) {
    log.warn({ lineId: line.id, cardId: card.id, error: (e as Error).message }, "walker read skipped");
  }
}

/** Prefill walker: own heartbeat (default 60s), stands down for live ticks. */
export function startPrefillWalker(log: Logger): NodeJS.Timeout {  async function pass() {
    try {
      const r = await runPrefillPass(log);
      if (r.chunks > 0) log.info({ ...r }, "prefill pass complete");
    } catch (e) {
      log.error({ error: (e as Error).message }, "prefill pass crashed");
    }
  }
  return setInterval(() => void pass(), PREFILL_INTERVAL_MS);
}
