import { useId, useState } from "react";
import type { ChartSeriesMeta, ChartType } from "../lib/api";

/** Categorical series palette — reads on light + dark. First slot is the industrial teal. */
export const SERIES_COLORS = ["#14b8a6", "#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899", "#ef4444"];

/** Shared numeric detection: scan ALL rows, coerce numeric strings (pg numerics
 *  arrive as strings), ignore nulls/empties. >=80% numeric values counts. */
export function isNumericColumn(rows: Record<string, unknown>[], col: string): boolean {
  let seen = 0;
  let ok = 0;
  for (const r of rows) {
    const v = r[col];
    if (v == null || v === "") continue;
    seen++;
    if (typeof v === "number" || !isNaN(Number(v))) ok++;
  }
  return seen > 0 && ok / seen >= 0.8;
}

export function numericColumns(rows: Record<string, unknown>[], columns: string[]): string[] {
  return columns.filter((c) => isNumericColumn(rows, c));
}

export function isTemporalName(name: string): boolean {
  return /time|date|hour|day|shift|_at$|^ts$|window|bucket/i.test(name);
}

/** Default chart type for an X column: temporal -> line, else bar, else table. */
export function defaultChartType(xName: string, hasNumericY: boolean): ChartType {
  if (!hasNumericY) return "table";
  return isTemporalName(xName) ? "line" : "bar";
}

export interface ChartProps {
  rows: Record<string, unknown>[];
  x: string;
  yCols: string[];
  type: ChartType;
  title?: string;
  /** Warn threshold: drawn as a dashed line; points at/above get breach dots. */
  threshold?: number | null;
  /** Direction-aware warn lines (preview): one dashed line per condition;
   *  points breaching ANY condition redden. Wins over `threshold` when set. */
  thresholdConditions?: { column: string; op: string; value: number; label?: string; comment?: string }[];
  height?: number;
  compact?: boolean;
  /** Per-series legend metadata (label/unit/color). Falls back to column
   *  names + palette order when absent (pre-enrichment suggestions). */
  series?: ChartSeriesMeta[];
  /** Axis titles. Default to the column names (caller appends units). */
  xLabel?: string;
  yLabel?: string;
  /** Grafana variant (preview modal): time-aware ticks, gradient line fill,
   *  threshold band, hover dots on all series, stats legend. */
  grafana?: boolean;
  /** Docked single-line legend above the plot (preview modal); default is
   *  the floating top-right overlay. */
  legendDocked?: boolean;
  /** Unit suffix for tooltip + legend stats (e.g. "°C"). */
  units?: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtTick(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (a >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return Number(v.toFixed(2)).toString();
}

/** Numeric value or null (nulls break lines — never fabricate zeros). */
function numAt(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function parseTime(v: unknown): number | null {
  if (v == null) return null;
  const t = Date.parse(String(v));
  return isNaN(t) ? null : t;
}

/** Grafana-style time tick: label adapts to the visible span. */
function formatTimeTick(t: number, spanMs: number): string {
  const d = new Date(t);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  if (spanMs < 48 * 3600 * 1000) return `${hh}:${mm}`;
  if (spanMs < 62 * 86400 * 1000) return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  if (spanMs < 730 * 86400 * 1000) return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return `${d.getUTCFullYear()}`;
}

export function formatTimeFull(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

/** Nice-number ticks (1/2/2.5/5 × 10^n) for the Grafana variant. */
function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / Math.max(count - 1, 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 5 : norm >= 2.5 ? 2.5 : norm >= 2 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= max + step * 1e-9; v += step) out.push(Number(v.toFixed(12)));
  return out;
}

function seriesStats(vals: number[]): { min: number; max: number; mean: number; last: number } {
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return { min, max, mean: vals.reduce((a, b) => a + b, 0) / vals.length, last: vals[vals.length - 1] };
}

/** Shared dependency-free SVG chart: line / bar / area + table fallback.
 *  Dark-first industrial styling, colorful data series, calm chrome. */
export function Chart({ rows, x, yCols, type, title, threshold, thresholdConditions, height = 180, compact = false, xLabel, yLabel, grafana = false, units, series, legendDocked }: ChartProps) {
  const seriesOf = (col: string) => series?.find((s) => s.column === col);
  const serieColor = (col: string, ci: number) => seriesOf(col)?.color ?? SERIES_COLORS[ci % SERIES_COLORS.length];
  const serieLabel = (col: string) => seriesOf(col)?.label ?? col;
  const gid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [hover, setHover] = useState<number | null>(null);

  if (rows.length === 0) return <div className="text-xs text-slate-400">No data to preview</div>;
  // Histogram: bin one numeric column into ~12 equal-width buckets and draw
  // the counts as bars (recursion reuses the bar renderer + hover/tooltip).
  if (type === "histogram") {
    const vcol = yCols[0] ?? x;
    const vals = rows.map((r) => numAt(r[vcol])).filter((v): v is number => v != null);
    if (vals.length < 2) return <div className="text-xs text-slate-400">Not enough numeric values for a distribution</div>;
    let mn = Math.min(...vals);
    let mx = Math.max(...vals);
    if (mx === mn) { mn -= 0.5; mx += 0.5; }
    const distinct = new Set(vals.map((v) => Number(v.toFixed(6)))).size;
    const nb = Math.max(3, Math.min(12, distinct));
    const w = (mx - mn) / nb;
    const counts = new Array<number>(nb).fill(0);
    for (const v of vals) {
      const i = Math.min(nb - 1, Math.max(0, Math.floor((v - mn) / w)));
      counts[i]++;
    }
    const binned = counts.map((count, i) => ({
      bin: `${fmtTick(mn + i * w)}–${fmtTick(mn + (i + 1) * w)}`,
      count,
    }));
    return (
      <Chart
        rows={binned}
        x="bin"
        yCols={["count"]}
        type="bar"
        title={title}
        height={height}
        compact={compact}
        xLabel={compact ? undefined : (xLabel ?? `${vcol} bins`)}
        yLabel={compact ? undefined : (yLabel ?? "count")}
        grafana={grafana}
        legendDocked={legendDocked}
      />
    );
  }
  if (type === "table" || yCols.length === 0) {
    const cols = [x, ...yCols].filter(Boolean);
    const show = rows.slice(0, 8);
    return (
      <div className="overflow-auto">
        {title && !compact && <div className="mb-1 text-xs font-semibold text-slate-500">{title}</div>}
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-400">
              {(cols.length > 0 ? cols : Object.keys(rows[0])).map((c) => (
                <th key={c} className="border-b border-slate-200 px-2 py-1 font-medium dark:border-ink-800">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody className="tnum">
            {show.map((r, i) => (
              <tr key={i} className="odd:bg-slate-50 dark:odd:bg-ink-800/40">
                {(cols.length > 0 ? cols : Object.keys(r)).map((c) => (
                  <td key={c} className="border-b border-slate-100 px-2 py-1 text-slate-600 dark:border-ink-800/60 dark:text-ink-300">{String(r[c] ?? "—")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 8 && <div className="mt-1 text-[10px] text-slate-400">+ {rows.length - 8} more rows</div>}
      </div>
    );
  }

  const W = 560;
  const H = height;
  const showLabels = !compact && (!!xLabel || !!yLabel);
  const PAD = compact ? 8 : yLabel ? 46 : 34;
  const tickY = H - (showLabels && xLabel ? 22 : 8);
  const PADB = compact ? 16 : showLabels && xLabel ? 38 : 26;
  const xVals = rows.map((r) => String(r[x] ?? ""));
  const numCols = yCols.filter((c) => rows.some((r) => numAt(r[c]) != null));
  if (numCols.length === 0) return <div className="text-xs text-slate-400">No numeric Y columns</div>;

  // Time-aware X: parse once; span drives tick labels (never raw ISO).
  const xTimes = xVals.map(parseTime);
  const temporal = xTimes.every((t) => t != null);
  const tMin = temporal ? Math.min(...(xTimes as number[])) : 0;
  const tMax = temporal ? Math.max(...(xTimes as number[])) : 0;
  const tSpan = temporal ? Math.max(tMax - tMin, 1) : 0;

  const allNums = rows.map((r) => numCols.map((c) => numAt(r[c]))).flat().filter((v): v is number => v != null);
  if (allNums.length === 0) return <div className="text-xs text-slate-400">No plottable values</div>;
  let yMin = Math.min(...allNums);
  let yMax = Math.max(...allNums);
  // Effective warn lines: per-direction conditions win; legacy single
  // threshold behaves as one above-line (back-compat for older callers).
  const conds = thresholdConditions && thresholdConditions.length > 0
    ? thresholdConditions.map((c) => ({ op: c.op === "<=" ? "<=" : ">=", value: c.value }))
    : threshold != null ? [{ op: ">=", value: threshold }] : [];
  const breached = (v: number) => conds.some((c) => (c.op === "<=" ? v <= c.value : v >= c.value));
  for (const c of conds) { yMin = Math.min(yMin, c.value); yMax = Math.max(yMax, c.value); }
  if (yMax === yMin) { yMax = yMin + 1; }
  // 12% headroom: peaks sit below the top-right legend overlay.
  const pad = (yMax - yMin) * 0.12;
  yMin -= pad; yMax += pad;
  // Grafana variant: snap the grid to nice numbers.
  const yTicks = grafana && !compact ? niceTicks(yMin, yMax, 5) : null;
  if (yTicks && yTicks.length > 0) {
    yMin = Math.min(yMin, yTicks[0]);
    yMax = Math.max(yMax, yTicks[yTicks.length - 1]);
  }

  const xi = (i: number) => PAD + (i / Math.max(xVals.length - 1, 1)) * (W - PAD - 12);
  const yi = (v: number) => H - PADB - ((v - yMin) / (yMax - yMin)) * (H - 14 - PADB);
  const step = Math.max(1, Math.floor(xVals.length / (temporal ? 6 : 7)));

  /** Contiguous non-null segments per column (nulls break lines, no fake zeros). */
  const segments = (col: string): string[][] => {
    const segs: string[][] = [];
    let cur: string[] = [];
    rows.forEach((r, i) => {
      const v = numAt(r[col]);
      if (v == null) {
        if (cur.length > 1) segs.push(cur);
        else if (cur.length === 1) segs.push([cur[0], cur[0]]);
        cur = [];
      } else {
        cur.push(`${xi(i)},${yi(v)}`);
      }
    });
    if (cur.length > 1) segs.push(cur);
    else if (cur.length === 1) segs.push([cur[0], cur[0]]);
    return segs;
  };

  const hoverRow = hover != null ? rows[hover] : null;
  const hoverTime = hover != null && temporal ? (xTimes[hover] as number) : null;

  const legendItems = numCols.slice(0, 6).map((col, ci) => ({
    label: serieLabel(col),
    color: serieColor(col, ci),
    unit: seriesOf(col)?.unit || units,
  }));
  return (
    <div className="relative">
      {title && !compact && <div className="mb-1 text-xs font-semibold text-slate-500">{title}</div>}
      {!compact && legendDocked && (
        <ChartLegend xTitle={xLabel} yTitle={yLabel} items={legendItems} docked breachKey={breachKeyFor(conds)} />
      )}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const fx = ((e.clientX - rect.left) / rect.width) * W;
          let best = 0; let bd = Infinity;
          xVals.forEach((_, i) => { const d = Math.abs(xi(i) - fx); if (d < bd) { bd = d; best = i; } });
          setHover(best);
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          {numCols.map((col, ci) => (
            <linearGradient key={col} id={`${gid}-a${ci}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={serieColor(col, ci)} stopOpacity={0.35} />
              <stop offset="100%" stopColor={serieColor(col, ci)} stopOpacity={0.04} />
            </linearGradient>
          ))}
        </defs>
        {!compact && yTicks && yTicks.map((t) => (
          <g key={t}>
            <line x1={PAD} x2={W - 12} y1={yi(t)} y2={yi(t)} className="stroke-slate-200 dark:stroke-ink-800" strokeWidth={0.5} />
            <text x={PAD - 5} y={yi(t) + 3} textAnchor="end" className="fill-slate-400 text-[9px]">{fmtTick(t)}</text>
          </g>
        ))}
        {!compact && !yTicks && [0, 0.25, 0.5, 0.75, 1].map((f) => {
          const gv = yMin + f * (yMax - yMin);
          return (
            <g key={f}>
              <line x1={PAD} x2={W - 12} y1={yi(gv)} y2={yi(gv)} className="stroke-slate-200 dark:stroke-ink-800" strokeWidth={0.5} />
              <text x={PAD - 5} y={yi(gv) + 3} textAnchor="end" className="fill-slate-400 text-[9px]">{fmtTick(gv)}</text>
            </g>
          );
        })}
        {grafana && !compact && conds.map((c, i) => (
          c.op === "<="
            ? <rect key={i} x={PAD} width={W - PAD - 12} y={yi(c.value)} height={Math.max(H - PADB - yi(c.value), 0)} fill="#f59e0b" fillOpacity={0.08} />
            : <rect key={i} x={PAD} width={W - PAD - 12} y={yi(yMax)} height={Math.max(yi(c.value) - yi(yMax), 0)} fill="#f59e0b" fillOpacity={0.08} />
        ))}
        {conds.map((c, i) => (
          <g key={i}>
            <line x1={PAD} x2={W - 12} y1={yi(c.value)} y2={yi(c.value)} stroke="#f59e0b" strokeWidth={1} strokeDasharray="5 3" opacity={0.8} />
            {!compact && <text x={W - 14} y={c.op === "<=" ? yi(c.value) + 10 : yi(c.value) - 3} textAnchor="end" className="fill-state-warn text-[9px]">warn {fmtTick(c.value)}</text>}
          </g>
        ))}
        {type === "area" && !grafana && numCols.map((col, ci) => {
          const base = yi(yMin);
          return (
            <g key={col}>
              {segments(col).map((pts, si) => (
                <path key={si} d={`M${pts.join(" L")} L${pts[pts.length - 1].split(",")[0]},${base} L${pts[0].split(",")[0]},${base} Z`} fill={`url(#${gid}-a${ci})`} />
              ))}
            </g>
          );
        })}
        {type === "bar" && rows.map((r, i) => {
          const slot = (W - PAD - 12) / Math.max(rows.length, 1);
          const bw = Math.min(28, (slot / Math.max(numCols.length, 1)) * 0.62);
          return numCols.map((col, ci) => {
            const v = numAt(r[col]);
            if (v == null) return null;
            const zeroY = yi(Math.max(0, yMin));
            const barH = Math.abs(yi(v) - zeroY);
            const colr = v != null && breached(v) ? "#ef4444" : serieColor(col, ci);
            return <rect key={`${i}-${col}`} x={xi(i) - (bw * numCols.length) / 2 + ci * bw} y={v >= 0 ? yi(v) : zeroY} width={Math.max(bw - 1, 1)} height={Math.max(barH, 1)} fill={colr} fillOpacity={0.88} rx={1.5} />;
          });
        })}
        {(type === "line" || type === "area") && numCols.map((col, ci) => (
          <g key={col}>
            {type === "area" && segments(col).map((pts, si) => {
              const base = yi(yMin);
              return <path key={`f-${si}`} d={`M${pts.join(" L")} L${pts[pts.length - 1].split(",")[0]},${base} L${pts[0].split(",")[0]},${base} Z`} fill={`url(#${gid}-a${ci})`} opacity={grafana ? 0.85 : 0.45} />;
            })}
            {segments(col).map((pts, si) => (
              <polyline key={si} points={pts.join(" ")} fill="none" stroke={serieColor(col, ci)} strokeWidth={grafana && !compact ? 2 : compact ? 1.25 : 1.75} strokeLinejoin="round" strokeLinecap="round" />
            ))}
          </g>
        ))}
        {/* hover dots on every series at the cursor (Grafana variant) */}
        {grafana && !compact && hover != null && numCols.map((col, ci) => {
          const v = numAt(rows[hover][col]);
          if (v == null) return null;
          return <circle key={col} cx={xi(hover)} cy={yi(v)} r={3.5} fill={serieColor(col, ci)} strokeWidth={1.5} className="stroke-white dark:stroke-ink-900" />;
        })}
        {/* breach dots: red on the breaching side of any warn line */}
        {conds.length > 0 && type !== "bar" && numCols.map((col) => (
          <g key={`b-${col}`}>
            {rows.map((r, i) => {
              const v = numAt(r[col]);
              if (v == null || !breached(v)) return null;
              return <circle key={i} cx={xi(i)} cy={yi(v)} r={compact ? 2 : 2.8} fill="#ef4444" strokeWidth={1} className="stroke-white dark:stroke-ink-900" opacity={hover === i ? 1 : 0.75} />;
            })}
          </g>
        ))}
        {/* x labels: time-aware when temporal, categorical otherwise */}
        {!compact && xVals.filter((_, i) => i % step === 0).map((v) => {
          const i = xVals.indexOf(v);
          const t = xTimes[i];
          const s = t != null && temporal
            ? formatTimeTick(t, tSpan)
            : v.length > 10 ? `${v.slice(0, 10)}…` : v;
          return <text key={i} x={xi(i)} y={tickY} textAnchor="middle" className="fill-slate-400 text-[9px]">{s}</text>;
        })}
        {/* axis titles */}
        {!compact && yLabel && (
          <text transform={`rotate(-90 12 ${H / 2})`} x={12} y={H / 2} textAnchor="middle" className="fill-slate-500 text-[10px] font-medium">{yLabel}</text>
        )}
        {!compact && xLabel && (
          <text x={(W + PAD) / 2} y={H - 8} textAnchor="middle" className="fill-slate-500 text-[10px] font-medium">{xLabel}</text>
        )}
        {/* hover cursor */}
        {hover != null && <line x1={xi(hover)} x2={xi(hover)} y1={10} y2={H - PADB} className="stroke-slate-300 dark:stroke-ink-600" strokeWidth={1} />}
      </svg>
      {!compact && !legendDocked && (
        <ChartLegend
          xTitle={xLabel}
          yTitle={yLabel}
          items={legendItems}
          breachKey={breachKeyFor(conds)}
        />
      )}
      {hoverRow && !compact && (
        <div className="anim-fade-in pointer-events-none absolute left-2 top-2 min-w-36 rounded-lg border border-slate-200 bg-white/95 p-2 text-xs shadow-lg dark:border-ink-700 dark:bg-ink-800/95">
          <div className="font-medium text-slate-500">{hoverTime != null ? formatTimeFull(hoverTime) : String(hoverRow[x] ?? "")}</div>
          {numCols.slice(0, 5).map((c, ci) => {
            const v = numAt(hoverRow[c]);
            const u = seriesOf(c)?.unit || units;
            return (
              <div key={c} className="tnum flex items-center gap-1.5 text-slate-600 dark:text-ink-300">
                <span className="h-2 w-2 rounded-sm" style={{ background: serieColor(c, ci) }} />
                {serieLabel(c)}: <span className="font-semibold">{v == null ? "—" : `${fmtTick(v)}${u ? ` ${u}` : ""}`}</span>
              </div>
            );
          })}
        </div>
      )}
      {/* Grafana stats table under the chart */}
      {grafana && !compact && (
        <table className="tnum mt-1 w-full text-[11px]">
          <thead>
            <tr className="text-left text-slate-400">
              <th className="py-0.5 pr-3 font-medium">series</th>
              <th className="py-0.5 pr-3 text-right font-medium">min</th>
              <th className="py-0.5 pr-3 text-right font-medium">max</th>
              <th className="py-0.5 pr-3 text-right font-medium">mean</th>
              <th className="py-0.5 text-right font-medium">last</th>
            </tr>
          </thead>
          <tbody>
            {numCols.slice(0, 6).map((col, ci) => {
              const vals = rows.map((r) => numAt(r[col])).filter((v): v is number => v != null);
              if (vals.length === 0) return null;
              const st = seriesStats(vals);
              const u = seriesOf(col)?.unit || units;
              const f = (v: number) => `${fmtTick(v)}${u ? ` ${u}` : ""}`;
              return (
                <tr key={col} className="border-t border-slate-100 text-slate-600 dark:border-ink-800 dark:text-ink-300">
                  <td className="py-0.5 pr-3"><span className="mr-1.5 inline-block h-2 w-2 rounded-sm" style={{ background: serieColor(col, ci) }} />{serieLabel(col)}</td>
                  <td className="py-0.5 pr-3 text-right">{f(st.min)}</td>
                  <td className="py-0.5 pr-3 text-right">{f(st.max)}</td>
                  <td className="py-0.5 pr-3 text-right">{f(st.mean)}</td>
                  <td className="py-0.5 text-right font-semibold">{f(st.last)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Standing in-chart legend (top-right): X meaning + per-series color key
 *  with units. Shared by the SVG renderer and the TradingView wrapper so
 *  both read identically. Renders nothing when there is nothing to say
 *  (compact thumbnails stay clean). */
export interface LegendItem {
  label: string;
  color: string;
  unit?: string;
}

/** Self-explanatory breach key from warn-line directions (image-capture
 *  readable: the picture explains itself with no surrounding UI). */
export function breachKeyFor(conds: { op: string }[]): "above" | "below" | "both" | null {
  const above = conds.some((c) => c.op !== "<=");
  const below = conds.some((c) => c.op === "<=");
  if (above && below) return "both";
  if (above) return "above";
  if (below) return "below";
  return null;
}

const BREACH_TEXT = {
  above: "breach above warn line",
  below: "breach below warn line",
  both: "breach outside warn lines",
} as const;

export function ChartLegend({ xTitle, yTitle, items, docked, breachKey }: { xTitle?: string; yTitle?: string; items: LegendItem[]; docked?: boolean; breachKey?: "above" | "below" | "both" | null }) {
  if (!xTitle && !yTitle && items.length === 0) return null;
  // Docked: single-line caption bar above the chart (zero plot overlap).
  // Floating (default): top-right overlay inside the plot.
  if (docked) {
    return (
      <div className="mb-1 flex w-full items-center gap-x-3 gap-y-0.5 overflow-hidden whitespace-nowrap rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1 text-xs shadow-sm dark:border-ink-700 dark:bg-ink-800/95">
        {xTitle && <span className="shrink-0 text-slate-500 dark:text-ink-300">X · <span className="font-semibold text-slate-700 dark:text-ink-100">{xTitle}</span></span>}
        {yTitle && <span className="shrink-0 text-slate-500 dark:text-ink-300">Y · <span className="font-semibold text-slate-700 dark:text-ink-100">{yTitle}</span></span>}
        {items.slice(0, 6).map((it, i) => (
          <span key={i} className="tnum flex min-w-0 items-center gap-1.5 text-slate-600 dark:text-ink-300">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: it.color }} />
            <span className="truncate">{it.label}</span>
            {it.unit && <span className="shrink-0 pl-1 text-slate-400">({it.unit})</span>}
          </span>
        ))}
        {breachKey && (
          <span className="flex shrink-0 items-center gap-1.5 text-slate-500 dark:text-ink-300">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "#ef4444" }} />
            <span>{BREACH_TEXT[breachKey]}</span>
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="pointer-events-none absolute right-2 top-2 z-10 max-w-44 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 text-[11px] shadow-lg dark:border-ink-700 dark:bg-ink-800/95">
      {xTitle && <div className="text-slate-500 dark:text-ink-300">X · <span className="font-semibold text-slate-700 dark:text-ink-100">{xTitle}</span></div>}
      {yTitle && <div className="text-slate-500 dark:text-ink-300">Y · <span className="font-semibold text-slate-700 dark:text-ink-100">{yTitle}</span></div>}
      {items.slice(0, 6).map((it, i) => (
          <div key={i} className="tnum flex items-center gap-1.5 text-slate-600 dark:text-ink-300">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: it.color }} />
            <span className="truncate">{it.label}</span>
            {it.unit && <span className="shrink-0 pl-1 text-slate-400">({it.unit})</span>}
          </div>
        ))}
        {breachKey && (
          <div className="flex items-center gap-1.5 text-slate-500 dark:text-ink-300">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: "#ef4444" }} />
            <span>{BREACH_TEXT[breachKey]}</span>
          </div>
        )}
    </div>
  );
}

/** Small sparkline thumbnail for card tiles / lists. */
export function ChartThumbnail({ rows, x, yCols, type }: { rows: Record<string, unknown>[]; x: string; yCols: string[]; type: ChartType }) {
  if (rows.length === 0 || type === "table" || yCols.length === 0) {
    return <div className="flex h-10 w-24 items-center justify-center rounded bg-slate-100 text-[10px] text-slate-400 dark:bg-ink-800">{type === "table" ? "table" : "no data"}</div>;
  }
  return (
    <div className="h-10 w-24 overflow-hidden rounded bg-slate-50 dark:bg-ink-800/60">
      <Chart rows={rows} x={x} yCols={yCols.slice(0, 2)} type={type} height={40} compact />
    </div>
  );
}

/* ---------------- multi-resolution previews ---------------- */

export type Resolution = "hourly" | "daily" | "weekly" | "monthly" | "yearly";

export const RESOLUTIONS: Resolution[] = ["hourly", "daily", "weekly", "monthly", "yearly"];

/** Axis title per resolution for temporal X (daily data titled "hour" is nonsense). */
export const RESOLUTION_X_LABEL: Record<Resolution, string> = {
  hourly: "Hour",
  daily: "Day",
  weekly: "Week",
  monthly: "Month",
  yearly: "Year",
};

/** Sample window per resolution (preview rollups bucket the fetched rows). */
export function windowForResolution(r: Resolution, now: Date = new Date()): { from: string; to: string } {
  const days = { hourly: 1, daily: 7, weekly: 30, monthly: 90, yearly: 365 }[r];
  return { from: new Date(now.getTime() - days * 86400 * 1000).toISOString(), to: now.toISOString() };
}

function isCountLike(col: string): boolean {
  return /count|pcs|qty|quantity|samples|total/i.test(col);
}

function bucketKey(d: Date, r: Resolution): string {
  const t = d;
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, "0");
  const day = String(t.getUTCDate()).padStart(2, "0");
  if (r === "daily") return `${y}-${m}-${day}`;
  if (r === "monthly" || r === "yearly") return `${y}-${m}-01`;
  // weekly: Monday start (UTC)
  const dow = (t.getUTCDay() + 6) % 7;
  const mon = new Date(Date.UTC(y, t.getUTCMonth(), t.getUTCDate() - dow));
  return mon.toISOString().slice(0, 10);
}

/**
 * Preview rollup: bucket hourly rows into coarser resolutions. Count-like
 * columns sum, the rest average; X becomes the bucket-start date. The chat
 * path serves the same shapes via SQL regroup; this keeps previews honest
 * without new storage.
 */
export function bucketRows(
  rows: Record<string, unknown>[],
  xCol: string,
  yCols: string[],
  resolution: Resolution
): Record<string, unknown>[] {
  if (resolution === "hourly" || rows.length === 0) return rows;
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const t = new Date(String(r[xCol] ?? ""));
    if (isNaN(t.getTime())) return rows; // non-temporal X: can't bucket
    const k = bucketKey(t, resolution);
    const g = groups.get(k) ?? [];
    g.push(r);
    groups.set(k, g);
  }
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
