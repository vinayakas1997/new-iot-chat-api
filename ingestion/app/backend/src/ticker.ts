import { getConnection, listCards, listLines, recordRun, touchLineTick } from "./db/store.js";
import { assertReadonly, driverFor } from "./drivers/index.js";
import { extractAndRetain } from "./extract.js";
import type { Logger } from "./logger.js";

const TICK_INTERVAL_MS = Number(process.env.TICK_INTERVAL_MS ?? 5 * 60 * 1000);

function windowFor(granularity: "hourly" | "shift" | "daily", since: string | null, now: Date): { from: string; to: string } {
  const span = granularity === "hourly" ? 3600_000 : granularity === "shift" ? 8 * 3600_000 : 24 * 3600_000;
  return { from: since ?? new Date(now.getTime() - span).toISOString(), to: now.toISOString() };
}

/**
 * Gap-3 engine v1: every interval, execute each LIVE card of each ACTIVE line
 * (dormant cards and deregistered lines are skipped), footprint every attempt
 * in the run log (kind=tick), stamp the line's last_tick on success, and retain
 * extracted facts in the line's bank (factsStored counts them; errors are
 * recorded without failing the tick).
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
      const started = Date.now();
      const w = windowFor(card.granularity, line.lastTick, now);
      const sql = card.sql.replaceAll("{{from}}", w.from).replaceAll("{{to}}", w.to);
      try {
        assertReadonly(sql);
        const rows = await driverFor(conn).queryReadonly<Record<string, unknown>>(conn, sql);
        // Extraction slice v1: LLM extracts durable facts from this result set
        // and retains them in the line's bank. Best-effort — a Hindsight/LLM
        // outage records the error but never fails the tick.
        const extraction = await extractAndRetain(log, card, line, rows, w);
        if (extraction.error) {
          log.warn({ lineId: line.id, cardId: card.id, error: extraction.error }, "fact extraction skipped");
        }
        recordRun({
          at: now.toISOString(), lineId: line.id, cardId: card.id,
          cardVersion: card.version, kind: "tick", ok: true,
          rowsPulled: rows.length, unitsBuilt: rows.length, factsStored: extraction.stored,
          durationMs: Date.now() - started, error: extraction.error,
        });
        touchLineTick(line.id, now.toISOString());
        ok++;
      } catch (e) {
        const error = (e as Error).message;
        recordRun({
          at: now.toISOString(), lineId: line.id, cardId: card.id,
          cardVersion: card.version, kind: "tick", ok: false,
          rowsPulled: 0, unitsBuilt: 0, factsStored: 0,
          durationMs: Date.now() - started, error,
        });
        log.error({ lineId: line.id, cardId: card.id, card: card.name, error }, "tick failed");
        failed++;
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
