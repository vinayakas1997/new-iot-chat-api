import { assertReadonly, driverFor } from "./drivers/index.js";

import type { ConnectionRecord } from "./db/store.js";

/**
 * Quirk discovery for hint suggestions: pure counting over sample rows, zero
 * LLM involvement. Every finding carries evidence counts (days, sizes) because
 * it is measured, not opined. The LLM only narrates confirmed findings; the
 * setter confirms or denies each candidate before it can enter a hint.
 */

export interface CandidateQuirk {
  kind: "daily-dip" | "daily-spike" | "recurring-gap" | "flatline" | "spike-shape" | "zero-window" | "counter";
  /** Clock hour HH:MM the quirk anchors to (when applicable). */
  at: string | null;
  column: string;
  /** Evidence, e.g. "3.1 below mean, 1 bucket, 30/30 days". */
  detail: string;
  /** Draft clause for the hint, used only after setter confirmation. */
  proposedClause: string;
}

export interface QuirkScan {
  daysAvailable: number;
  status: "ok" | "insufficient-data";
  xColumn: string | null;
  candidates: CandidateQuirk[];
}

const MIN_DAYS = 5;
const COVERAGE = 0.8;
const K_STD = 2;
const FLAT_RUN = 3;
const Z_SPIKE = 3;
const MONO_RATIO = 0.95;
const FETCH_LIMIT = 2000;
const THIN_TO = 800;

const TIME_RE = /time|date|hour|day|shift|_at$|^ts$|window|bucket/i;

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function hhmm(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** UTC calendar-day key for day-span gating. */
function prodDayKey(t: Date): string {
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** Count-like columns (faults, samples, totals): a flat zero or a lone spike
 *  is the signal, not a quirk — dip/spike/flatline/shape detection would cry
 *  wolf on every quiet hour. Only gaps + counter checks apply to them. */
function isCountLike(col: string): boolean {
  return /count|pcs|qty|quantity|samples|total|faults/i.test(col);
}

function mean(a: number[]): number {
  return a.reduce((x, y) => x + y, 0) / a.length;
}

function std(a: number[], m: number): number {
  return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / a.length);
}

/**
 * Detection sample: explicit wide windows (newest coverage first), each
 * capped, merged and evenly thinned so time-of-day patterns survive. Bounded
 * plant load: at most 3 capped reads, user-initiated only.
 */
export async function fetchDetectionRows(
  conn: ConnectionRecord,
  sqlTemplate: string,
): Promise<Record<string, unknown>[]> {
  const now = Date.now();
  const merged: Record<string, unknown>[] = [];
  for (const days of [7, 30, 90]) {
    const from = new Date(now - days * 86400 * 1000).toISOString();
    const to = new Date(now).toISOString();
    const inner = sqlTemplate.replaceAll("{{from}}", from).replaceAll("{{to}}", to);
    const sql = `SELECT * FROM (${inner}) t LIMIT ${FETCH_LIMIT}`;
    try {
      assertReadonly(sql);
    } catch {
      return merged;
    }
    try {
      const rows = await driverFor(conn).queryReadonly<Record<string, unknown>>(conn, sql);
      for (const r of rows) merged.push(r);
    } catch {
      break;
    }
    if (merged.length >= FETCH_LIMIT) break;
  }
  // Windows overlap (7d ⊂ 30d ⊂ 90d) — dedup so evidence counts stay honest
  // and concatenated copies can't forge flatline runs at junctions.
  const seen = new Set<string>();
  const deduped = merged.filter((r) => {
    const k = JSON.stringify(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  merged.length = 0;
  merged.push(...deduped);
  if (merged.length <= THIN_TO) return merged;
  // Even thin: every k-th row preserves time-of-day coverage.
  const step = merged.length / THIN_TO;
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < THIN_TO; i++) out.push(merged[Math.floor(i * step)]);
  return out;
}

/** Numeric measure columns (everything numeric except the X column). */
function measureCols(rows: Record<string, unknown>[], xCol: string | null): string[] {
  return Object.keys(rows[0] ?? {}).filter((c) => c !== xCol && rows.some((r) => num(r[c]) != null));
}

export function scanQuirks(
  rows: Record<string, unknown>[],
): QuirkScan {
  const cols = Object.keys(rows[0] ?? {});
  const xCol = cols.find((c) =>
    rows.some((r) => {
      const v = r[c];
      return v != null && !isNaN(Date.parse(String(v)));
    }),
  ) ?? cols.find((c) => TIME_RE.test(c)) ?? null;
  const empty: QuirkScan = { daysAvailable: 0, status: "insufficient-data", xColumn: xCol, candidates: [] };
  if (!xCol || rows.length === 0) return empty;
  const times: (Date | null)[] = rows.map((r) => {
    const t = new Date(String(r[xCol] ?? ""));
    return isNaN(t.getTime()) ? null : t;
  });
  const days = new Set<string>();
  for (const t of times) if (t) days.add(prodDayKey(t));
  const daysAvailable = days.size;
  if (daysAvailable < MIN_DAYS) return { ...empty, daysAvailable };
  const measures = measureCols(rows, xCol);
  const candidates: CandidateQuirk[] = [];
  const totalDays = daysAvailable;

  for (const col of measures) {
    // Fold onto one 24h clock: hour -> values + day coverage.
    const byHour = new Map<number, { vals: number[]; days: Set<string>; nullDays: Set<string> }>();
    rows.forEach((r, i) => {
      const t = times[i];
      if (!t) return;
      const h = t.getUTCHours();
      const e = byHour.get(h) ?? { vals: [], days: new Set<string>(), nullDays: new Set<string>() };
      const v = num(r[col]);
      const dk = prodDayKey(t);
      if (v == null) e.nullDays.add(dk);
      else { e.vals.push(v); e.days.add(dk); }
      byHour.set(h, e);
    });
    const all = [...byHour.values()].flatMap((e) => e.vals);
    if (all.length < 10) continue;
    const gm = mean(all);
    const gs = std(all, gm) || 1;

    // Hours already explained by a recurring deviation or gap are not
    // re-reported as isolated spikes (same phenomenon, one clause).
    const explainedHours = new Set<number>();
    // Count-like columns skip shape detectors (a quiet zero is the signal).
    const shapeOk = !isCountLike(col);
    // 1. Recurring time-of-day deviations (dips + spikes).
    for (const [h, e] of byHour) {
      if (!shapeOk) break;
      if (e.vals.length < 3 || e.days.size / totalDays < COVERAGE) continue;
      const hm = mean(e.vals);
      const dev = hm - gm;
      if (Math.abs(dev) < K_STD * gs) continue;
      explainedHours.add(h);
      const at = `${String(h).padStart(2, "0")}:00`;
      const dir = dev < 0 ? "dip" : "spike";
      const size = `${Math.abs(dev).toFixed(1)} ${dev < 0 ? "below" : "above"} mean`;
      candidates.push({
        kind: dev < 0 ? "daily-dip" : "daily-spike",
        at,
        column: col,
        detail: `${size}, ${e.days.size}/${totalDays} days`,
        proposedClause: `ignore the ${at} single-bucket ${dir} in ${col} (${size}, ${e.days.size}/${totalDays} days)`,
      });
    }

    // 2. Recurring single-bucket gaps.
    for (const [h, e] of byHour) {
      if (e.nullDays.size / totalDays < COVERAGE || e.vals.length > e.nullDays.size) continue;
      explainedHours.add(h);
      const at = `${String(h).padStart(2, "0")}:00`;
      candidates.push({
        kind: "recurring-gap",
        at,
        column: col,
        detail: `missing ${e.nullDays.size}/${totalDays} days`,
        proposedClause: `ignore the ${at} gap in ${col} (missing ${e.nullDays.size}/${totalDays} days)`,
      });
    }

    // 3+4. Flatlines and spike shape need real gauges — skipped for
    // count-like columns (a quiet zero is the signal, not a quirk).
    const vals = rows.map((r) => num(r[col]));
    if (!shapeOk) {
      // fall through to the counter check below
    } else {
    let runStart = -1;
    let runVal: number | null = null;
    const flush = (end: number) => {
      if (runStart >= 0 && end - runStart >= FLAT_RUN && runVal != null) {
        const t = times[runStart];
        candidates.push({
          kind: "flatline",
          at: t ? hhmm(t) : null,
          column: col,
          detail: `identical ${runVal} for ${end - runStart} buckets`,
          proposedClause: `watch for ${col} flatlining at ${runVal} (${end - runStart}+ identical buckets = stuck sensor)`,
        });
      }
      runStart = -1;
      runVal = null;
    };
    vals.forEach((v, i) => {
      if (v == null) { flush(i); return; }
      if (runVal != null && v === runVal) return;
      flush(i);
      runStart = i;
      runVal = v;
    });
    flush(vals.length);

    // 4. Spike shape: isolated 1-bucket spikes (observed widths cited).
    // Buckets in already-explained hours don't count (no double clauses).
    let isolated = 0;
    vals.forEach((v, i) => {
      if (v == null) return;
      const t = times[i];
      if (t && explainedHours.has(t.getUTCHours())) return;
      const nb: number[] = [];
      for (let k = Math.max(0, i - 3); k <= Math.min(vals.length - 1, i + 3); k++) {
        if (k !== i) {
          const n = vals[k];
          if (n != null) nb.push(n);
        }
      }
      if (nb.length < 4) return;
      const nm = mean(nb);
      const ns = std(nb, nm) || 1;
      const prev = vals[i - 1];
      const next = vals[i + 1];
      if (Math.abs(v - nm) > Z_SPIKE * ns && (prev == null || Math.abs(prev - nm) < Z_SPIKE * ns) && (next == null || Math.abs(next - nm) < Z_SPIKE * ns)) {
        isolated++;
      }
    });
    if (isolated > 0) {
      candidates.push({
        kind: "spike-shape",
        at: null,
        column: col,
        detail: `${isolated} isolated one-bucket spike${isolated === 1 ? "" : "s"}`,
        proposedClause: `ignore one-bucket spikes in ${col} (${isolated} observed); only multi-bucket runs count as trend`,
      });
    }
    } // end shapeOk else

    // 5. Range envelope per hour is prompt context, not a quirk — skip here.

    // 6. Counter vs gauge.
    let up = 0;
    let steps = 0;
    for (let i = 1; i < vals.length; i++) {
      const a = vals[i - 1];
      const b = vals[i];
      if (a == null || b == null) continue;
      steps++;
      if (b >= a) up++;
    }
    if (steps >= 10 && up / steps >= MONO_RATIO) {
      candidates.push({
        kind: "counter",
        at: null,
        column: col,
        detail: `non-decreasing ${(100 * up / steps).toFixed(0)}% of steps`,
        proposedClause: `${col} is a cumulative counter — report deltas between buckets, never raw levels`,
      });
    }

    // 7. Zero-production windows: all-null stretches at recurring hours.
    // (Covered per-column by recurring-gap when every measure shares the
    // hour; the prompt merges them. No separate pass needed.)
  }
  return { daysAvailable, status: "ok", xColumn: xCol, candidates: candidates.slice(0, 12) };
}
