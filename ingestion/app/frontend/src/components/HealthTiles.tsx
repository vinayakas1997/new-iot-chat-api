import { Activity } from "lucide-react";
import type { LineHealth } from "../lib/api";
import { timeAgo, countdownTo } from "../lib/format";
import { AlertBanner, StatusChip } from "./chips";

/** Expected runs per 24h per stream — the denominator in `actual/expected`. Weekly+ expect <1/day, so they show a plain count. */
const EXPECTED_24H: Record<string, number> = { base: 24, "5min": 288, hourly: 24, daily: 1 };

/**
 * F7 Zone 2 — one card per stream, everything inside: status dot, runs
 * actual/expected, last/next. The 5min/1h freshness pulse is a single
 * text line above — same signal, zero extra boxes, no number twice.
 */
export function HealthTiles({ health, streamFilter, onStream }: {
  health: LineHealth;
  streamFilter: string | null;
  onStream: (resolution: string | null) => void;
}) {
  const w = health.windows;
  const pulseBad = w.last5min.failed + w.last1h.failed > 0;
  return (
    <div>
      {(health.quietHours == null || health.quietHours > 6) && (
        <div className="mb-3">
          <AlertBanner
            tone="warn"
            title={health.lastTick == null ? "Never ticked" : `Quiet for ${Math.round(health.quietHours ?? 0)}h`}
            detail="No successful tick recently — a dead sensor looks like a healthy idle line. Investigate."
          />
        </div>
      )}
      <div className="tnum text-xs text-slate-400">
        pulse — last 5min: {w.last5min.runs} runs ({w.last5min.ok} ok{w.last5min.failed > 0 ? `, ${w.last5min.failed} failed` : ""})
        {" · "}last 1h: {w.last1h.runs} runs ({w.last1h.ok} ok{w.last1h.failed > 0 ? `, ${w.last1h.failed} failed` : ""})
        {" · "}<span className={pulseBad ? "text-state-bad" : "text-state-ok"}>{pulseBad ? "failures present" : "all ok"}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {health.streams.map((s) => {
          const active = streamFilter === s.resolution;
          const stale = s.lastRun != null && (Date.now() - new Date(s.lastRun).getTime()) / 3600000 > 6;
          const dot = s.lastRun == null ? "bg-slate-300 dark:bg-ink-700" : stale ? "bg-state-warn" : "bg-state-ok";
          const dotTitle = s.lastRun == null ? "never ran" : stale ? "quiet — stale" : "live — healthy";
          const expected = EXPECTED_24H[s.resolution];
          return (
            <button
              key={s.resolution}
              onClick={() => onStream(active ? null : s.resolution)}
              title={active ? "Clear stream filter" : `Filter log to ${s.resolution}`}
              className={`rounded-xl border p-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 ${
                active
                  ? "border-accent-500 bg-accent-500/10"
                  : "border-slate-200 hover:bg-slate-50 dark:border-ink-800 dark:hover:bg-ink-800/50"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Activity size={12} className="text-slate-400" />
                <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{s.resolution}</span>
                <span title={dotTitle} className={`ml-auto h-2.5 w-2.5 rounded-full ${dot}`} />
              </div>
              <div className="tnum mt-1 text-2xl font-bold">
                {s.runs24h.tick}{expected != null && <span className="text-base font-medium text-slate-400">/{expected}</span>}
                {s.runs24h.test > 0 && (
                  <span title="manual test runs — excluded from health" className="ml-1.5 align-middle text-xs font-medium text-slate-400">
                    +{s.runs24h.test} tests
                  </span>
                )}
              </div>
              <div className="tnum mt-0.5 text-[11px] text-slate-400">
                last {timeAgo(s.lastRun)} · next {countdownTo(s.nextRun)}
              </div>
              <div className="mt-1.5">
                {s.lastRun == null ? (
                  <StatusChip tone="mute">never ran</StatusChip>
                ) : stale ? (
                  <StatusChip tone="warn">quiet</StatusChip>
                ) : (
                  <StatusChip tone="ok">live</StatusChip>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
