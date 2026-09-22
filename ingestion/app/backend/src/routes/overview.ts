import type { FastifyInstance } from "fastify";
import { getLine, getResolutionRun, listCards, runsForLine } from "../db/store.js";

/**
 * Line 360° health tiles (P2 backend, UI later): per-window ingest counts
 * plus per-stream last/next run. Next-run is DERIVED in one place —
 * hourly base → top-of-hour after last_tick; derived readers → last_run +
 * period. UTC wall-clock everywhere, same as the tick engine.
 */
const PERIOD_MS: Record<string, number> = {
  base: 3600_000,
  "5min": 300_000,
  hourly: 3600_000,
  daily: 86_400_000,
  weekly: 7 * 86_400_000,
  monthly: 30 * 86_400_000,
};

function nextAfter(last: string | null, periodMs: number): string | null {
  if (!last) return null;
  return new Date(new Date(last).getTime() + periodMs).toISOString();
}

export async function overviewRoutes(app: FastifyInstance) {
  app.get("/api/ingest/overview/health", async (req, reply) => {
    const { line } = req.query as { line?: string };
    if (!line) return reply.code(400).send({ error: "line required" });
    const l = getLine(line);
    if (!l) return reply.code(404).send({ error: "line not found" });
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    const summarize = (from: number, to: number) => {
      const runs = runsForLine(line, iso(from), iso(to));
      const ok = runs.filter((r) => r.ok).length;
      return { runs: runs.length, ok, failed: runs.length - ok };
    };
    const cards = listCards(line);
    // "base" (the sampler) always streams even though cards list derived readers.
    const resolutions: string[] = [...new Set(["base", ...cards.flatMap((c) => c.resolutions ?? [])])];
    const day = runsForLine(line, iso(now - 86_400_000), iso(now));
    const streams = resolutions.map((res) => {
      let last: string | null = null;
      for (const c of cards) {
        if (!(c.resolutions ?? []).includes(res as (typeof c.resolutions)[number])) continue;
        const lr = res === "base" ? null : getResolutionRun(c.id, res);
        if (lr && (!last || lr > last)) last = lr;
      }
      if (res === "base" && l.lastTick && (!last || l.lastTick > last)) last = l.lastTick;
      // Tick/test split: the big number judges the schedule (ticks), the
      // small suffix explains human activity (manual tests). Same runs table.
      const streamRuns = day.filter((r) => (r.resolution ?? "base") === res);
      const runs24h = {
        tick: streamRuns.filter((r) => r.kind === "tick").length,
        test: streamRuns.filter((r) => r.kind === "test").length,
      };
      return {
        resolution: res,
        cards: cards.filter((c) => (c.resolutions ?? []).includes(res as (typeof c.resolutions)[number])).length,
        lastRun: last,
        nextRun: nextAfter(last, PERIOD_MS[res] ?? PERIOD_MS.base),
        runs24h,
      };
    });
    return {
      lineId: line,
      lastTick: l.lastTick,
      quietHours: l.lastTick == null ? null : (now - new Date(l.lastTick).getTime()) / 3600000,
      windows: { last5min: summarize(now - 300_000, now), last1h: summarize(now - 3600_000, now) },
      streams,
    };
  });
}
