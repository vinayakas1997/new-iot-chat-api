import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import type { ChartType, TestResult } from "../lib/api";
import { bucketRows, Chart, formatTimeFull, numericColumns, RESOLUTIONS, RESOLUTION_X_LABEL, type Resolution } from "./Chart";
import { isTradingEligible, TradingChart } from "./TradingChart";
import { StatusChip } from "./chips";
import { Btn, Segmented, Spinner } from "./ui";

export interface PreviewItem {
  key: string;
  chartType: ChartType;
  xColumn: string;
  yColumns: string[];
  title: string;
  rationale?: string;
  conditions?: string;
  /** Extra badges (auto top-N, merged, AI...). */
  badges?: { text: string; tone: "ok" | "accent" | "violet" }[];
  /** Checkbox state. Undefined = analyse-only, no checkbox. */
  checked?: boolean;
  onToggle?: (on: boolean) => void;
  threshold?: number | null;
  xLabel?: string;
  yLabel?: string;
  units?: string;
}

/**
 * Separate chart-preview screen: 90% viewport. Data section first (stats +
 * paginated table at the current resolution), charts below with the
 * explanation under each. Data-source agnostic — the caller feeds
 * { items, sample }; Refresh re-samples so everything updates with new
 * values. Table-type suggestions are excluded (purely charts here); exact
 * values live behind "View table" in Details. Selections persist
 * server-side, so revisiting anytime shows prior state.
 */
const PAGE_SIZE = 15;

function fmtCell(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "number") return Number(v.toFixed(3)).toString();
  const t = Date.parse(String(v));
  if (!isNaN(t) && /[T\-:]/.test(String(v))) return formatTimeFull(t);
  return String(v);
}
export function ChartPreviewModal({ title, subtitle, items, sample, sampledAt, loadingSample, sampleError, summary, resolution, onResolutionChange, onRefresh, onClose }: {
  title: string;
  subtitle?: string;
  items: PreviewItem[];
  sample: TestResult | null;
  sampledAt: string | null;
  loadingSample: boolean;
  sampleError?: string | null;
  summary?: string;
  resolution: Resolution;
  onResolutionChange: (r: Resolution) => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const toneCls: Record<string, string> = {
    ok: "bg-state-ok/10 text-state-ok ring-state-ok/30",
    accent: "bg-accent-500/10 text-accent-500 ring-accent-500/30",
    violet: "bg-violet-500/10 text-violet-400 ring-violet-500/30",
  };
  const charts = items.filter((i) => i.chartType !== "table");
  const tableCount = items.length - charts.length;
  const hasRows = !loadingSample && !sampleError && sample && sample.rows.length > 0;
  const [dataOpen, setDataOpen] = useState(true);
  const [page, setPage] = useState(0);
  // Reset paging whenever the underlying rows or resolution change.
  useEffect(() => { setPage(0); }, [sample, resolution]);

  // Data-table rows: raw sample at hourly, bucketed above (same rows the
  // charts draw, so table and charts always agree). Bucketing needs an X:
  // first temporal column wins, else the first column.
  const cols = sample?.columns ?? [];
  const dataX = (() => {
    if (!sample || sample.rows.length === 0) return cols[0] ?? "";
    const first = sample.rows[0];
    return cols.find((c) => {
      const v = first[c];
      return v != null && !isNaN(Date.parse(String(v)));
    }) ?? cols[0] ?? "";
  })();
  const dataY = sample ? numericColumns(sample.rows, cols).filter((c) => c !== dataX) : [];
  const dataRows = sample && hasRows
    ? resolution === "hourly" ? sample.rows : bucketRows(sample.rows, dataX, dataY, resolution)
    : [];
  const dataCols = resolution === "hourly" && sample ? sample.columns : [dataX, ...dataY].filter(Boolean);
  const stats = dataY.slice(0, 8).map((c) => {
    const vals = dataRows.map((r) => Number(r[c])).filter((v) => !isNaN(v));
    if (vals.length === 0) return null;
    return {
      col: c,
      min: Math.min(...vals),
      max: Math.max(...vals),
      avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    };
  }).filter((s): s is NonNullable<typeof s> => s != null);
  const pages = Math.max(Math.ceil(dataRows.length / PAGE_SIZE), 1);
  const safePage = Math.min(page, pages - 1);
  const pageRows = dataRows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const fmtNum = (v: number) => Number(v.toFixed(3)).toString();

  return (
    <div className="anim-fade-in fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="anim-pop-in flex max-h-[92vh] w-[90vw] max-w-7xl flex-col overflow-hidden rounded-xl bg-white dark:bg-ink-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-5 py-3 dark:border-ink-800">
          <div>
            <h2 className="text-base font-bold">{title}</h2>
            {subtitle && <div className="text-xs text-slate-400">{subtitle}</div>}
          </div>
          {summary && <span className="text-xs text-slate-400">{summary}</span>}
          <div className="ml-auto flex items-center gap-2">
            <Segmented
              value={resolution}
              onChange={(v) => onResolutionChange(v as Resolution)}
              options={RESOLUTIONS.map((r) => ({ value: r, label: r }))} 
            />
            {sampledAt && <span className="tnum text-xs text-slate-400">sampled {new Date(sampledAt).toLocaleTimeString()}</span>}
            <Btn size="sm" icon={RefreshCw} onClick={onRefresh} loading={loadingSample} disabled={loadingSample} title="Re-run the sample query — every chart re-renders with fresh values." className="glass-pill glass-pill--neutral">
              Refresh data
            </Btn>
            <button onClick={onClose} aria-label="close preview" className="rounded-lg p-1.5 text-slate-400 glass-pill glass-pill--close"><X size={16} /></button>
          </div>
        </div>

        <div className="overflow-auto px-5 py-4">
          {loadingSample && (
            <div className="flex items-center gap-2 py-10 text-sm text-slate-400"><Spinner /> Sampling fresh rows…</div>
          )}
          {!loadingSample && (sampleError || !sample || sample.rows.length === 0) && (
            <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-ink-700">
              {sampleError ?? "No sample rows — nothing to render yet."}
            </div>
          )}
          {hasRows && charts.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-ink-700">
              No plottable charts here{tableCount > 0 ? ` — ${tableCount} table suggestion${tableCount === 1 ? "" : "s"} available via “View table” in Details for exact values.` : "."}
            </div>
          )}
          {hasRows && (
            <section className="mb-5 rounded-xl border border-slate-200 dark:border-ink-800">
              <button onClick={() => setDataOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60">
                <span className="text-slate-400">{dataOpen ? "▾" : "▸"}</span>
                <span className="text-sm font-bold">Data — {resolution}</span>
                <span className="tnum text-xs text-slate-400">{dataRows.length} rows{resolution !== "hourly" ? " (bucketed)" : ""}</span>
                <span className="ml-auto text-xs text-slate-400">{dataOpen ? "collapse" : "expand"}</span>
              </button>
              {dataOpen && (
                <div className="border-t border-slate-100 px-4 py-3 dark:border-ink-800">
                  {stats.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {stats.map((s) => (
                        <span key={s.col} className="tnum inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 dark:bg-ink-800 dark:text-ink-300">
                          <span className="font-semibold">{s.col}</span>
                          <span className="text-slate-400">min <span className="text-slate-600 dark:text-ink-300">{fmtNum(s.min)}</span></span>
                          <span className="text-slate-400">max <span className="text-slate-600 dark:text-ink-300">{fmtNum(s.max)}</span></span>
                          <span className="text-slate-400">avg <span className="font-semibold text-accent-500">{fmtNum(s.avg)}</span></span>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="overflow-auto rounded-lg border border-slate-100 dark:border-ink-800">
                    <table className="tnum w-full text-xs">
                      <thead className="bg-slate-50 dark:bg-ink-800/60">
                        <tr className="text-left text-slate-400">
                          {dataCols.map((c) => <th key={c} className="whitespace-nowrap px-2.5 py-1.5 font-medium">{c}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.map((r, i) => (
                          <tr key={i} className="border-t border-slate-100 text-slate-600 odd:bg-slate-50/50 dark:border-ink-800/60 dark:text-ink-300 dark:odd:bg-ink-800/30">
                            {dataCols.map((c) => <td key={c} className="whitespace-nowrap px-2.5 py-1">{fmtCell(r[c])}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                    <button disabled={safePage === 0} onClick={() => setPage(safePage - 1)} className="rounded px-2 py-1 ring-1 ring-slate-200 transition-colors enabled:hover:bg-slate-100 disabled:opacity-40 dark:ring-ink-700 dark:enabled:hover:bg-ink-800 glass-pill glass-pill--neutral">← prev</button>
                    <span className="tnum">page {safePage + 1} of {pages}</span>
                    <button disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)} className="rounded px-2 py-1 ring-1 ring-slate-200 transition-colors enabled:hover:bg-slate-100 disabled:opacity-40 dark:ring-ink-700 dark:enabled:hover:bg-ink-800 glass-pill glass-pill--neutral">next →</button>
                    {resolution !== "hourly" && <span className="ml-auto">non-numeric columns hidden when bucketed</span>}
                  </div>
                </div>
              )}
            </section>
          )}
          {hasRows && tableCount > 0 && charts.length > 0 && (
            <div className="mb-3 text-xs text-slate-400">{tableCount} table suggestion{tableCount === 1 ? "" : "s"} hidden from this view — exact values via “View table” in Details.</div>
          )}
          {hasRows && charts.map((it) => {
            const rows = bucketRows(sample.rows, it.xColumn, it.yColumns, resolution);
            const resSuffix = resolution === "hourly" ? "" : ` · ${resolution}`;
            // Temporal X takes the resolution title (Hour/Day/Week/Month);
            // categorical X keeps the column name.
            const firstX = sample.rows[0]?.[it.xColumn];
            const temporalX = firstX != null && !isNaN(Date.parse(String(firstX)));
            const xTitle = temporalX ? RESOLUTION_X_LABEL[resolution] : (it.xLabel ?? it.xColumn);
            return (
              <section key={it.key} className="anim-pop-in mb-5 rounded-xl border border-slate-200 p-4 dark:border-ink-800">
                <div className="flex flex-wrap items-center gap-2">
                  {it.checked !== undefined && (
                    <input
                      type="checkbox"
                      checked={it.checked}
                      onChange={() => it.onToggle?.(!it.checked)}
                      title="Include this chart"
                      className="h-4 w-4 shrink-0 accent-teal-500"
                    />
                  )}
                  <StatusChip tone="accent">{it.chartType}</StatusChip>
                  {(it.badges ?? []).map((b) => (
                    <span key={b.text} className={`rounded-full px-1.5 py-px text-[10px] ring-1 ${toneCls[b.tone]}`}>{b.text}</span>
                  ))}
                  <span className="font-semibold">{it.title}{resSuffix}</span>
                  <span className="tnum text-xs text-slate-400">x:{it.xColumn} y:{it.yColumns.join(",") || "—"}</span>
                </div>
                <div className="mt-2">
                  {isTradingEligible(rows, it.xColumn, it.yColumns, it.chartType) ? (
                    <TradingChart
                      rows={rows}
                      x={it.xColumn}
                      yCols={it.yColumns}
                      type={it.chartType as "line" | "area"}
                      threshold={it.threshold}
                      height={260}
                      units={it.units}
                    />
                  ) : (
                    <Chart
                      rows={rows}
                      x={it.xColumn}
                      yCols={it.yColumns}
                      type={it.chartType}
                      threshold={it.threshold}
                      height={260}
                      xLabel={xTitle}
                      yLabel={it.yLabel ?? (it.yColumns.length > 0 ? it.yColumns.join(", ") : undefined)}
                      grafana
                      units={it.units}
                    />
                  )}
                </div>
                {(it.rationale || it.conditions) && (
                  <div className="mt-2 border-t border-slate-100 pt-2 dark:border-ink-800">
                    <div className="text-[11px] uppercase tracking-widest text-slate-400">why this chart</div>
                    {it.rationale && <p className="mt-0.5 text-sm text-slate-600 dark:text-ink-300">{it.rationale}</p>}
                    {it.conditions && <p className="mt-0.5 text-sm text-accent-500/90">◷ {it.conditions}</p>}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
