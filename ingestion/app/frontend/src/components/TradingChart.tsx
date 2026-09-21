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
import { SERIES_COLORS, fmtTick, ChartLegend } from "./Chart";

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

export function TradingChart({ rows, x, yCols, type, title, threshold, height = 260, units, series, xTitle, yTitle }: {
  rows: Record<string, unknown>[];
  x: string;
  yCols: string[];
  type: "line" | "area" | "histogram";
  title?: string;
  threshold?: number | null;
  height?: number;
  units?: string;
  /** Per-series legend labels (falls back to column names when absent). */
  series?: { column: string; label: string }[];
  /** Axis captions for the standing legend (TV axes carry numbers only). */
  xTitle?: string;
  yTitle?: string;
}) {
  const serieLabel = (col: string) => series?.find((s) => s.column === col)?.label ?? col;
  const hostRef = useRef<HTMLDivElement>(null);
  const key = JSON.stringify({ rows, x, yCols, type, threshold, height, units, series });
  // Standing legend rows: X/Y captions + per-series color key. Histogram
  // plots bin counts, so its single row reads "count".
  const legendItems = type === "histogram"
    ? [{ label: serieLabel(yCols[0] ?? x), color: SERIES_COLORS[0], unit: "count" }]
    : yCols.slice(0, 6).map((col, ci) => ({
        label: serieLabel(col),
        color: SERIES_COLORS[ci % SERIES_COLORS.length],
        unit: units,
      }));

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Rebuild per dataset (user-initiated changes, never streaming).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const data = JSON.parse(key) as { rows: Record<string, unknown>[]; x: string; yCols: string[]; type: "line" | "area" | "histogram"; threshold: number | null; units?: string };
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
      leftPriceScale: { visible: true, borderColor: GRID },
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
        const series = chart.addSeries(HistogramSeries, {
          priceFormat: { type: "price", precision: 0, minMove: 1 },
          priceScaleId: "left",
          title: data.yCols[0] ?? data.x,
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
            title: legend,
          } as never)
        : chart.addSeries(LineSeries, {
            color,
            lineWidth: 2,
            priceFormat: { type: "price", precision: 2, minMove: 0.01 },
            priceScaleId: "left",
            title: legend,
          } as never);
      const pts = seriesData(data.rows, data.x, col);
      if (pts.length === 0) {
        chart.removeSeries(series);
        return;
      }
      series.setData(pts);
      if (data.threshold != null) {
        series.createPriceLine({
          price: data.threshold,
          color: "#f59e0b",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: data.units ? `warn ${data.threshold} ${data.units}` : `warn ${data.threshold}`,
        });
        const breaches = pts
          .filter((p) => p.value >= (data.threshold as number))
          .map((p) => ({ time: p.time, position: "aboveBar" as const, color: "#ef4444", shape: "circle" as const, text: "" }));
        if (breaches.length > 0) createSeriesMarkers(series, breaches);
      }
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

  return (
    <div>
      {title && <div className="mb-1 text-xs font-semibold text-slate-500">{title}</div>}
      <div className="relative">
        <div ref={hostRef} style={{ height }} className="w-full overflow-hidden rounded-lg" />
        <ChartLegend xTitle={xTitle} yTitle={yTitle} items={legendItems} />
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
