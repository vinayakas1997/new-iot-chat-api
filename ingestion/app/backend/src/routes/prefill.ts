import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  countLlmCallsToday,
  getCoverage,
  getDb,
  getLine,
  getResolutionRun,
  listCards,
  setCoverage,
} from "../db/store.js";
import { BACKFILL_CHUNK_MULT, LLM_READS_PER_DAY, PREFILL_INTERVAL_MS } from "../ticker.js";

const ORDER = ["5min", "hourly", "daily", "weekly", "monthly"];
const STREAM_MS: Record<string, number> = {
  "5min": 5 * 60 * 1000,
  hourly: 3600 * 1000,
  daily: 24 * 3600 * 1000,
  weekly: 7 * 24 * 3600 * 1000,
  monthly: 30 * 24 * 3600 * 1000,
};

/** F8: prefill job control + progress. Pause holds cursors (resumable);
 *  "off" (analysisStart) is the permanent opt-out. Live ticks untouched. */
export async function prefillRoutes(app: FastifyInstance) {
  const scope = z.object({
    lineId: z.string().min(1).optional(),
    cardId: z.string().min(1).optional(),
    resolution: z.string().min(1).optional(),
  });

  function targetsFor(q: z.infer<typeof scope>): { cardId: string; resolutions: string[] }[] {
    if (q.cardId) {
      return [{ cardId: q.cardId, resolutions: q.resolution ? [q.resolution] : [] }];
    }
    if (q.lineId) {
      return listCards(q.lineId)
        .filter((c) => c.status === "live")
        .map((c) => ({ cardId: c.id, resolutions: q.resolution ? [q.resolution] : (c.resolutions?.length ? [...c.resolutions] : ["hourly"]) }));
    }
    return [];
  }

  app.post("/api/ingest/prefill/pause", async (req, reply) => {
    const p = scope.safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    const targets = targetsFor(p.data);
    if (targets.length === 0) return reply.code(400).send({ error: "lineId or cardId required" });
    let n = 0;
    for (const t of targets) {
      const resos = t.resolutions.length > 0 ? t.resolutions : ["base"];
      for (const r of resos) {
        setCoverage(t.cardId, r, { paused: true });
        n++;
      }
    }
    return { ok: true, paused: n };
  });

  app.post("/api/ingest/prefill/resume", async (req, reply) => {
    const p = scope.safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ error: p.error.message });
    const targets = targetsFor(p.data);
    if (targets.length === 0) return reply.code(400).send({ error: "lineId or cardId required" });
    let n = 0;
    for (const t of targets) {
      const resos = t.resolutions.length > 0 ? t.resolutions : ["base"];
      for (const r of resos) {
        setCoverage(t.cardId, r, { paused: false });
        n++;
      }
    }
    return { ok: true, resumed: n };
  });

  app.get("/api/ingest/prefill/status/:lineId", async (req, reply) => {
    const { lineId } = req.params as { lineId: string };
    const line = getLine(lineId);
    if (!line) return reply.code(404).send({ error: "line not found" });
    const db = getDb();
    // 24h LLM/time split live vs prefill (kind=tick only — tests excluded).
    const split = db
      .prepare(
        `SELECT is_backfill AS bf, COUNT(*) AS n, COALESCE(SUM(duration_ms),0) AS ms, COALESCE(SUM(facts_stored),0) AS facts
         FROM runs WHERE line_id=? AND kind='tick' AND at >= datetime('now','-1 day') GROUP BY is_backfill`
      )
      .all(lineId) as { bf: number; n: number; ms: number; facts: number }[];
    const row = (bf: number) => split.find((s) => s.bf === bf) ?? { n: 0, ms: 0, facts: 0 };
    const cards = listCards(lineId).map((c) => {
      const streams = c.resolutions?.length ? c.resolutions : ["hourly"];
      const finest = [...streams].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))[0] ?? "hourly";
      const optedOff = (c.analysisStart ?? "").trim() === "off";
      const scope = c.prefillStreams?.length ? new Set(c.prefillStreams) : null;
      return {
        cardId: c.id,
        name: c.name,
        status: c.status,
        granularity: c.granularity,
        analysisStart: c.analysisStart ?? null,
        optedOff,
        prefillStreams: c.prefillStreams ?? null,
        streams: streams.map((s) => {
          const inScope = !scope || scope.has(s);
          const runRes = s === finest ? "base" : s;
          const cov = getCoverage(c.id, runRes);
          const liveEnd = (s === finest ? line.lastTick : getResolutionRun(c.id, s)) ?? new Date().toISOString();
          const chunkMs = (STREAM_MS[s] ?? STREAM_MS.hourly) * BACKFILL_CHUNK_MULT;
          const remaining = cov.backfillCursor && cov.backfillCursor < liveEnd
            ? Math.ceil((new Date(liveEnd).getTime() - new Date(cov.backfillCursor).getTime()) / chunkMs)
            : 0;
          const stat = db
            .prepare(
              `SELECT COUNT(*) AS n, COALESCE(AVG(duration_ms),0) AS avgMs,
                      (SELECT error FROM runs WHERE card_id=? AND resolution=? AND is_backfill=1 AND ok=0 ORDER BY at DESC LIMIT 1) AS lastError
               FROM runs WHERE card_id=? AND resolution=? AND is_backfill=1`
            )
            .get(c.id, runRes, c.id, runRes) as { n: number; avgMs: number; lastError: string | null };
          // ETA at walker pace: 1 chunk per resolution per pass (60s default).
          const etaSec = remaining > 0 ? remaining * (PREFILL_INTERVAL_MS / 1000) : 0;
          const state = optedOff || !inScope
            ? "off"
            : cov.paused
              ? "paused"
              : stat.lastError
                ? "error"
                : remaining > 0
                  ? "walking"
                  : "caught-up";
          return {
            resolution: s,
            coverageFrom: cov.coverageFrom,
            backfillCursor: cov.backfillCursor,
            liveCursor: liveEnd,
            paused: cov.paused,
            inScope,
            scopeNote: !inScope ? "out of scope — deselected in 4b" : null,
            chunksDone: stat.n,
            chunksRemaining: remaining,
            msPerChunk: Math.round(stat.avgMs),
            etaSec: Math.round(etaSec),
            lastError: stat.lastError,
            state,
          };
        }),
      };
    });
    const live = row(0);
    const pre = row(1);
    return {
      lineId,
      walker: {
        enabled: process.env.PREFILL_ENABLED !== "false",
        intervalMs: PREFILL_INTERVAL_MS,
        chunkMult: BACKFILL_CHUNK_MULT,
      },
      last24h: {
        live: { runs: live.n, ms: live.ms, facts: live.facts },
        prefill: { runs: pre.n, ms: pre.ms, facts: pre.facts },
      },
      // Call-count guardrail: the only knob. Shared budget, humans bypass.
      readsToday: { used: countLlmCallsToday(lineId, "readings/step1"), cap: LLM_READS_PER_DAY },
      cards,
    };
  });
}
