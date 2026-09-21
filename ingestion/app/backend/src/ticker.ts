import { getConnection, getResolutionRun, listCards, listLines, recordRun, setResolutionRun, touchLineTick } from "./db/store.js";
import { assertReadonly, driverFor } from "./drivers/index.js";
import { extractAndRetain } from "./extract.js";
import { bucketRowsServer, finestOf, readerDue, spanMs, windowFullySkipped } from "./rollup.js";
import type { Logger } from "./logger.js";

const TICK_INTERVAL_MS = Number(process.env.TICK_INTERVAL_MS ?? 5 * 60 * 1000);

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
        recordRun({
          at: now.toISOString(), lineId: line.id, cardId: card.id,
          cardVersion: card.version, kind: "tick", resolution: "base", ok: true,
          rowsPulled: rows.length, unitsBuilt: rows.length, factsStored: extraction.stored,
          durationMs: Date.now() - started, error: extraction.error,
        });
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
          recordRun({
            at: now.toISOString(), lineId: line.id, cardId: card.id,
            cardVersion: card.version, kind: "tick", resolution: res, ok: true,
            rowsPulled: raw.length, unitsBuilt: bucketed.length, factsStored: extraction.stored,
            durationMs: Date.now() - rStarted, error: extraction.error,
          });
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
  return { cards, ok, failed };
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
