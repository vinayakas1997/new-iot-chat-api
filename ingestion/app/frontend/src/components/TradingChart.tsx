import { useEffect, useRef } from "react";
import {
  AreaSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { SERIES_COLORS, fmtTick, ChartLegend, breachKeyFor } from "./Chart";

/**
 * TradingView rendering (lightweight-charts, Apache-2.0) for temporal
 * line/area series plus distribution histograms: black background,
 * canvas-crisp lines, smart time axis, crosshair, threshold price line,
 * breach markers. Used everywhere a full-size temporal chart appears;
 * bars / categorical / tables stay on our SVG renderer, thumbnails stay
 * SVG (canvas per thumbnail is waste). Histogram bins render as
 * HistogramSeries with bin-range axis labels (peak bin amber).
 */

const BG = "#0b0e13"; // ink-950: always black, both app themes
const GRID = "#1c2230";
const TEXT = "#b6bfd4";

function toEpoch(v: unknown): UTCTimestamp | null {
  if (v == null) return null;
  const t = Date.parse(String(v));
  return isNaN(t) ? null : (Math.floor(t / 1000) as UTCTimestamp);
}

function seriesData(
  rows: Record<string, unknown>[],
  x: string,
  col: string
): { time: UTCTimestamp; value: number }[] {
  const seen = new Map<number, number>();
  for (const r of rows) {
    const t = toEpoch(r[x]);
    const v = r[col] == null || r[col] === "" ? NaN : Number(r[col]);
    if (t == null || isNaN(v)) continue;
    seen.set(t, v); // dedupe: last wins (bucketed rows are unique anyway)
  }
  return [...seen.entries()]
    .sort(([a], [b]) => a - b)
    .map(([time, value]) => ({ time: time as UTCTimestamp, value }));
}

/**
 * Distribution bins for histogram mode: equal-width buckets over one
 * numeric column. Times are synthetic ordinals (i+1); the real bin-range
 * labels travel alongside and are printed via tickMarkFormatter, so the
 * time axis never shows misleading dates.
 */
function histogramBins(
  rows: Record<string, unknown>[],
  col: string,
): { data: { time: UTCTimestamp; value: number; color: string }[]; labels: string[] } {
  const vals: number[] = [];
  for (const r of rows) {
    const v = r[col] == null || r[col] === "" ? NaN : Number(r[col]);
    if (!isNaN(v)) vals.push(v);
  }
  if (vals.length < 2) return { data: [], labels: [] };
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
  const peak = Math.max(...counts);
  const labels = counts.map((_, i) => `${fmtTick(mn + i * w)}–${fmtTick(mn + (i + 1) * w)}`);
  const data = counts.map((value, i) => ({
    time: (i + 1) as UTCTimestamp,
    value,
    color: value === peak ? "#f59e0b" : SERIES_COLORS[0],
  }));
  return { data, labels };
}

export function TradingChart({ rows, x, yCols, type, title, threshold, thresholdConditions, height = 260, units, series, xTitle, yTitle, legendDocked }: {
  rows: Record<string, unknown>[];
  x: string;
  yCols: string[];
  type: "line" | "area" | "histogram";
  title?: string;
  threshold?: number | null;
  /** Direction-aware warn lines; wins over `threshold` when non-empty. */
  thresholdConditions?: { column: string; op: string; value: number; label?: string; comment?: string }[];
  height?: number;
  units?: string;
  /** Per-series legend metadata (unit/color optional); falls back to column
   *  names + palette order when absent (matches the SVG legend). */
  series?: { column: string; label: string; unit?: string; color?: string }[];
  /** Axis captions for the standing legend (TV axes carry numbers only). */
  xTitle?: string;
  yTitle?: string;
  /** Docked single-line legend above the plot; default is the floating overlay. */
  legendDocked?: boolean;
}) {
  const serieMeta = (col: string) => series?.find((s) => s.column === col);
  const serieLabel = (col: string) => serieMeta(col)?.label ?? col;
  const hostRef = useRef<HTMLDivElement>(null);
  const key = JSON.stringify({ rows, x, yCols, type, threshold, thresholdConditions, height, units, series });
  // Standing legend rows: X/Y captions + per-series color key. Histogram
  // plots bin counts, so its single row reads "count". Per-series unit +
  // color mirror the SVG legend row-for-row.
  const legendItems = type === "histogram"
    ? [{ label: serieLabel(yCols[0] ?? x), color: SERIES_COLORS[0], unit: "count" }]
    : yCols.slice(0, 6).map((col, ci) => ({
        label: serieLabel(col),
        color: serieMeta(col)?.color || SERIES_COLORS[ci % SERIES_COLORS.length],
        unit: serieMeta(col)?.unit || units,
      }));

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Rebuild per dataset (user-initiated changes, never streaming).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const data = JSON.parse(key) as { rows: Record<string, unknown>[]; x: string; yCols: string[]; type: "line" | "area" | "histogram"; threshold: number | null; thresholdConditions?: { column: string; op: string; value: number; label?: string; comment?: string }[]; units?: string };
    const chart: IChartApi = createChart(host, {
      width: host.clientWidth || 600,
      height,
      layout: {
        background: { type: ColorType.Solid, color: BG },
        textColor: TEXT,
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: GRID },
        horzLines: { color: GRID },
      },
      crosshair: {
        vertLine: { color: "#3d4a68", labelBackgroundColor: "#2a3347" },
        horzLine: { color: "#3d4a68", labelBackgroundColor: "#2a3347" },
      },
      // Top margin: peaks autoscale below the top-right legend overlay.
      leftPriceScale: { visible: true, borderColor: GRID, scaleMargins: { top: 0.18, bottom: 0.08 } },
      rightPriceScale: { visible: false },
      timeScale: { borderColor: GRID, timeVisible: true, secondsVisible: false },
    });

    if (data.type === "histogram") {
      // Distribution: bin the value column, one HistogramSeries. Threshold
      // lines are skipped — a warn level on *counts* is meaningless.
      const vcol = data.yCols[0] ?? data.x;
      const { data: bins, labels } = histogramBins(data.rows, vcol);
      chart.applyOptions({
        timeScale: { tickMarkFormatter: (t: number) => labels[t - 1] ?? "" },
      } as never);
      if (bins.length > 0) {
        // No series title: the library pane legend would duplicate our
        // docked bar — the plot stays clean, warn-line titles unaffected.
        const series = chart.addSeries(HistogramSeries, {
          priceFormat: { type: "price", precision: 0, minMove: 1 },
          priceScaleId: "left",
          title: "",
        } as never);
        series.setData(bins);
      }
      chart.timeScale().fitContent();
      const ro = new ResizeObserver(() => {
        if (host.clientWidth > 0) chart.applyOptions({ width: host.clientWidth });
      });
      ro.observe(host);
      return () => {
        ro.disconnect();
        chart.remove();
      };
    }
    data.yCols.slice(0, 6).forEach((col, ci) => {
      const color = SERIES_COLORS[ci % SERIES_COLORS.length];
      const legend = serieLabel(col);
      const series = data.type === "area"
        ? chart.addSeries(AreaSeries, {
            lineColor: color,
            topColor: `${color}59`,
            bottomColor: `${color}0a`,
            lineWidth: 2,
            priceFormat: { type: "price", precision: 2, minMove: 0.01 },
            priceScaleId: "left",
            title: "",
          } as never)
        : chart.addSeries(LineSeries, {
            color,
            lineWidth: 2,
            priceFormat: { type: "price", precision: 2, minMove: 0.01 },
            priceScaleId: "left",
            title: "",
          } as never);
      const pts = seriesData(data.rows, data.x, col);
      if (pts.length === 0) {
        chart.removeSeries(series);
        return;
      }
      series.setData(pts);
      // Warn lines: per-direction conditions win; legacy single threshold
      // behaves as one above-line. Markers redden on each line's own side.
      const tcs = (data.thresholdConditions?.length
        ? data.thresholdConditions.map((c) => ({ op: c.op === "<=" ? "<=" : ">=", value: c.value }))
        : data.threshold != null ? [{ op: ">=", value: data.threshold }] : []) as { op: string; value: number }[];
      const breaches: { time: (typeof pts)[number]["time"]; position: "aboveBar" | "belowBar"; color: string; shape: "circle"; text: string }[] = [];
      for (const tc of tcs) {
        series.createPriceLine({
          price: tc.value,
          color: "#f59e0b",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: data.units ? `warn ${tc.value} ${data.units}` : `warn ${tc.value}`,
        });
        for (const p of pts) {
          const hit = tc.op === "<=" ? p.value <= tc.value : p.value >= tc.value;
          if (hit) breaches.push({ time: p.time, position: tc.op === "<=" ? "belowBar" : "aboveBar", color: "#ef4444", shape: "circle", text: "" });
        }
      }
      if (breaches.length > 0) createSeriesMarkers(series, breaches);
    });

    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => {
      if (host.clientWidth > 0) chart.applyOptions({ width: host.clientWidth });
    });
    ro.observe(host);
    return () => {
      ro.disconnect();
      chart.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Effective warn-line directions (mirrors the SVG conds): breach key reads
  // from these so the legend explains itself with no extra props.
  const tvConds = thresholdConditions?.length
    ? thresholdConditions
    : threshold != null ? [{ column: "", op: ">=" as const }] : [];
  const tvBreachKey = breachKeyFor(tvConds);
  return (
    <div>
      {title && <div className="mb-1 text-xs font-semibold text-slate-500">{title}</div>}
      {legendDocked && <ChartLegend xTitle={xTitle} yTitle={yTitle} items={legendItems} docked breachKey={tvBreachKey} />}
      <div className="relative">
        <div ref={hostRef} style={{ height }} className="w-full overflow-hidden rounded-lg" />
        {!legendDocked && <ChartLegend xTitle={xTitle} yTitle={yTitle} items={legendItems} breachKey={tvBreachKey} />}
      </div>
      <div className="mt-1 text-[10px] text-slate-500">Charting by TradingView Lightweight Charts™</div>
    </div>
  );
}

/** Temporal line/area with ≥1 plottable point → TradingView; else SVG.
 *  Histogram (distribution, binned client-side) also renders on TradingView
 *  once 2+ numeric values exist — the time axis shows bin-range labels. */
export function isTradingEligible(
  rows: Record<string, unknown>[],
  x: string,
  yCols: string[],
  type: string
): boolean {
  if (type === "histogram") {
    if (rows.length === 0) return false;
    const col = yCols[0] ?? x;
    let n = 0;
    for (const r of rows) {
      const v = r[col];
      if (v != null && v !== "" && !isNaN(Number(v)) && ++n >= 2) return true;
    }
    return false;
  }
  if (type !== "line" && type !== "area") return false;
  if (rows.length === 0 || yCols.length === 0) return false;
  return rows.some((r) => toEpoch(r[x]) != null && yCols.some((c) => {
    const v = r[c];
    return v != null && v !== "" && !isNaN(Number(v));
  }));
}
