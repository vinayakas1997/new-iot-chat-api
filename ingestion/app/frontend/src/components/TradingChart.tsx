import { useEffect, useRef } from "react";
import {
  AreaSeries,
  ColorType,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { SERIES_COLORS } from "./Chart";

/**
 * TradingView rendering (lightweight-charts, Apache-2.0) for temporal
 * line/area series: black background, canvas-crisp lines, smart time axis,
 * crosshair, threshold price line, breach markers. Used everywhere a
 * full-size temporal chart appears; bars / categorical / tables stay on
 * our SVG renderer, thumbnails stay SVG (canvas per thumbnail is waste).
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

export function TradingChart({ rows, x, yCols, type, title, threshold, height = 260, units }: {
  rows: Record<string, unknown>[];
  x: string;
  yCols: string[];
  type: "line" | "area";
  title?: string;
  threshold?: number | null;
  height?: number;
  units?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const key = JSON.stringify({ rows, x, yCols, type, threshold, height, units });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Rebuild per dataset (user-initiated changes, never streaming).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const data = JSON.parse(key) as { rows: Record<string, unknown>[]; x: string; yCols: string[]; type: "line" | "area"; threshold: number | null; units?: string };
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

    data.yCols.slice(0, 6).forEach((col, ci) => {
      const color = SERIES_COLORS[ci % SERIES_COLORS.length];
      const series = data.type === "area"
        ? chart.addSeries(AreaSeries, {
            lineColor: color,
            topColor: `${color}59`,
            bottomColor: `${color}0a`,
            lineWidth: 2,
            priceFormat: { type: "price", precision: 2, minMove: 0.01 },
            priceScaleId: "left",
          } as never)
        : chart.addSeries(LineSeries, {
            color,
            lineWidth: 2,
            priceFormat: { type: "price", precision: 2, minMove: 0.01 },
            priceScaleId: "left",
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
      <div ref={hostRef} style={{ height }} className="w-full overflow-hidden rounded-lg" />
      <div className="mt-1 text-[10px] text-slate-500">Charting by TradingView Lightweight Charts™</div>
    </div>
  );
}

/** Temporal line/area with ≥1 plottable point → TradingView; else SVG. */
export function isTradingEligible(
  rows: Record<string, unknown>[],
  x: string,
  yCols: string[],
  type: string
): boolean {
  if (type !== "line" && type !== "area") return false;
  if (rows.length === 0 || yCols.length === 0) return false;
  return rows.some((r) => toEpoch(r[x]) != null && yCols.some((c) => {
    const v = r[c];
    return v != null && v !== "" && !isNaN(Number(v));
  }));
}
