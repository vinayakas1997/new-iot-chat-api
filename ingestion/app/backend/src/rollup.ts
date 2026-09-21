import type { SkipSchedule, StreamResolution } from "./db/store.js";
import { SKIP_DAYS } from "./db/store.js";

function hhmmToMinutes(s: string): number | null {
  if (s === "24:00") return 1440;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * True when a timestamp falls inside a skipped span of the weekly schedule.
 * Plain UTC wall-clock: Sunday-off means UTC Sunday, "00:00–06:00" means
 * night hours. No shift anchor (removed).
 */
export function isMomentSkipped(schedule: SkipSchedule | undefined, ms: number): boolean {
  const d = new Date(ms);
  const day = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][d.getUTCDay()];
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  const wins = schedule?.[day] ?? [{ from: "00:00", to: "24:00" }];
  for (const w of wins) {
    const f = hhmmToMinutes(w.from);
    const t = hhmmToMinutes(w.to);
    if (f == null || t == null) continue;
    if (mins >= f && mins < t) return false; // inside a running window
  }
  return true;
}

/**
 * True when an entire [from, to) window lies inside skipped time — sampled
 * at 15-minute steps. Partial overlap still runs (data at the edges counts).
 */
export function windowFullySkipped(
  schedule: SkipSchedule | undefined,
  fromIso: string,
  toIso: string,
): boolean {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (!(from < to)) return false;
  const step = 15 * 60_000;
  for (let t = from; t < to; t += step) {
    if (!isMomentSkipped(schedule, t)) return false;
  }
  return isMomentSkipped(schedule, to - 1);
}

/** Human summary of what's skipped ("Sun all day · daily 00:00–06:00"). */
export function skipSummary(schedule: SkipSchedule | undefined): string {
  if (!schedule) return "";
  const fullOff: string[] = [];
  const partial: string[] = [];
  for (const d of SKIP_DAYS) {
    const w = schedule[d] ?? [];
    if (w.length === 0) fullOff.push(d);
    else if (!(w.length === 1 && w[0].from === "00:00" && w[0].to === "24:00")) {
      partial.push(`${d} ${w.map((x) => `${x.from}–${x.to}`).join(",")}`);
    }
  }
  const bits: string[] = [];
  if (fullOff.length > 0) bits.push(`${fullOff.join(", ")} off`);
  if (partial.length > 0) bits.push(`runs ${partial.join(" · ")}`);
  return bits.join(" · ");
}

/**
 * Multi-resolution ingest math (pure, no I/O): stream order, window spans,
 * shift-anchored boundaries, due checks, and server-side bucketing for
 * derived readers. Mirrors the frontend preview bucketing (Chart.tsx) so
 * ingested rollups and displayed rollups always agree.
 */

export const RESOLUTION_ORDER: StreamResolution[] = ["5min", "hourly", "daily", "weekly", "monthly"];

/** Finest checked stream = base sampler (plant queries). */
export function finestOf(resolutions: StreamResolution[]): StreamResolution {
  for (const r of RESOLUTION_ORDER) {
    if (resolutions.includes(r)) return r;
  }
  return "hourly";
}

/** Nominal window span per stream. */
export function spanMs(res: StreamResolution): number {
  switch (res) {
    case "5min": return 5 * 60_000;
    case "hourly": return 3600_000;
    case "daily": return 24 * 3600_000;
    case "weekly": return 7 * 24 * 3600_000;
    case "monthly": return 30 * 24 * 3600_000;
  }
}

/**
 * Aligned window for a derived reader: the last COMPLETE boundary period
 * ending at or before `now` (UTC midnight days, UTC months). Returns null
 * when no full period has elapsed yet (fresh card) — the reader waits.
 */
export function readerWindow(
  res: StreamResolution,
  now: Date,
): { from: string; to: string } | null {
  const t = now.getTime();
  if (res === "5min" || res === "hourly") {
    const span = spanMs(res);
    const to = Math.floor(t / span) * span;
    if (to + span > t + 1000 && to <= 0) return null;
    return { from: new Date(to - span).toISOString(), to: new Date(to).toISOString() };
  }
  const day = 24 * 3600_000;
  if (res === "daily") {
    const to = Math.floor(t / day) * day;
    if (to > t) return null;
    if (to - day > t) return null;
    return { from: new Date(to - day).toISOString(), to: new Date(to).toISOString() };
  }
  if (res === "weekly") {
    // Weeks: 7 UTC days back from the last UTC midnight.
    const to = Math.floor(t / day) * day;
    if (to > t) return null;
    return { from: new Date(to - 7 * day).toISOString(), to: new Date(to).toISOString() };
  }
  // monthly: last complete UTC calendar month.
  const d = new Date(t);
  let y = d.getUTCFullYear();
  let m = d.getUTCMonth();
  const monthStart = Date.UTC(y, m, 1);
  if (monthStart > t) {
    m -= 1;
    if (m < 0) { m = 11; y -= 1; }
  }
  const to = Date.UTC(y, m, 1);
  if (to > t) return null;
  const prevM = m === 0 ? 11 : m - 1;
  const prevY = m === 0 ? y - 1 : y;
  return { from: new Date(Date.UTC(prevY, prevM, 1)).toISOString(), to: new Date(to).toISOString() };
}

/**
 * A derived reader is due when a new complete boundary period exists since
 * its last run. First run fires as soon as one full period has elapsed.
 */
export function readerDue(
  res: StreamResolution,
  lastRun: string | null,
  now: Date,
): { due: boolean; window: { from: string; to: string } | null } {
  const window = readerWindow(res, now);
  if (!window) return { due: false, window: null };
  if (!lastRun) return { due: true, window };
  return { due: new Date(lastRun).getTime() < new Date(window.to).getTime(), window };
}

/** Count-like columns sum, the rest average (same rule as preview bucketing). */
function isCountLike(col: string): boolean {
  return /count|pcs|qty|quantity|samples|total/i.test(col);
}

function bucketKey(t: Date, res: StreamResolution): string {
  const d = t;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  if (res === "daily" || res === "5min" || res === "hourly") return `${y}-${m}-${day}T00:00`;
  return `${y}-${m}-01`;
}

/**
 * Roll raw rows into one row per bucket for a derived reader, so the LLM
 * sees shape (≤25 buckets) instead of thousands of raw rows. X becomes the
 * bucket key; non-temporal X passes rows through untouched.
 */
export function bucketRowsServer(
  rows: Record<string, unknown>[],
  xCol: string,
  res: StreamResolution,
): Record<string, unknown>[] {
  if (res === "5min" || res === "hourly" || rows.length === 0) return rows;
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const t = new Date(String(r[xCol] ?? ""));
    if (isNaN(t.getTime())) return rows;
    const k = bucketKey(t, res);
    const g = groups.get(k) ?? [];
    g.push(r);
    groups.set(k, g);
  }
  const yCols = Object.keys(rows[0]).filter((c) => c !== xCol);
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, g]) => {
      const o: Record<string, unknown> = { [xCol]: k };
      for (const y of yCols) {
        const vals = g.map((r) => Number(r[y])).filter((v) => !isNaN(v));
        if (vals.length === 0) { o[y] = null; continue; }
        o[y] = isCountLike(y)
          ? vals.reduce((a, b) => a + b, 0)
          : vals.reduce((a, b) => a + b, 0) / vals.length;
      }
      return o;
    });
}
