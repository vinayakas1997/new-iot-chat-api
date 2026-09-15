import { useState } from "react";
import { Copy, Sparkles, X } from "lucide-react";
import type { Card, CardTemplate, GraphSpec, Line, TestResult } from "../lib/api";
import { cardApi, chartApi, graphApi } from "../lib/api";
import { StatusChip } from "./chips";
import { FormattedText } from "./FormattedText";
import { Chart } from "./Chart";
import { isTradingEligible, TradingChart } from "./TradingChart";
import { Btn } from "./ui";

/** Read-only card dossier: full SQL, lineage (+drift), test state, graphs, bank. Changes nothing. */
export function CardDetails({ card, template, line, graphs, bankReady, onClose, onGraphsChanged }: {
  card: Card;
  template: CardTemplate | null;
  line: Line | null;
  graphs: GraphSpec[];
  bankReady: boolean;
  onClose: () => void;
  onGraphsChanged: (graphs: GraphSpec[]) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [previewRows, setPreviewRows] = useState<TestResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [recommending, setRecommending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openTable, setOpenTable] = useState<string | null>(null);

  async function copySql() {
    try {
      await navigator.clipboard.writeText(card.sql);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = card.sql;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function loadPreview() {
    setPreviewLoading(true);
    setError(null);
    try {
      setPreviewRows(await cardApi.testCard(card.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function toggleRag(g: GraphSpec, on: boolean) {
    try {
      const updated = await graphApi.update(g.id, { config: { ...g.config, selected_for_rag: on } });
      onGraphsChanged(graphs.map((x) => (x.id === g.id ? updated : x)));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function reRecommend() {
    setRecommending(true);
    setError(null);
    try {
      const r = await chartApi.recommendCard(card.id);
      // Store accepted shape directly: top-2 feed RAG, rest kept unselected.
      const created: GraphSpec[] = [];
      for (let i = 0; i < r.suggestions.length; i++) {
        const c = r.suggestions[i];
        created.push(await graphApi.create(card.id, {
          name: c.title || `Suggested ${c.chartType}`,
          chartType: c.chartType,
          xColumn: c.xColumn,
          yColumns: c.yColumns,
          title: c.title,
          config: {
            source: "ai-recommended",
            selected_for_rag: i < 2,
            rationale: c.rationale,
            conditions: c.conditions,
            units: card.unit || undefined,
            threshold: card.threshold,
          },
        }));
      }
      onGraphsChanged([...created, ...graphs]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRecommending(false);
    }
  }

  async function viewTable(id: string) {
    if (openTable === id) { setOpenTable(null); return; }
    if (!previewRows) {
      setPreviewLoading(true);
      try {
        setPreviewRows(await cardApi.testCard(card.id));
      } catch (e) {
        setError((e as Error).message);
        setPreviewLoading(false);
        return;
      }
      setPreviewLoading(false);
    }
    setOpenTable(id);
  }

  const drift = template && card.templateVersion != null && template.version !== card.templateVersion;
  const chartSpecs = graphs.filter((g) => g.chartType !== "table");
  const tableSpecs = graphs.filter((g) => g.chartType === "table");

  return (
    <div className="anim-fade-in fixed inset-0 z-20 flex justify-end bg-black/60" onClick={onClose}>
      <div className="anim-slide-in-right max-h-screen w-full max-w-2xl overflow-auto bg-white p-6 dark:bg-ink-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold">{card.name}</h2>
          <StatusChip tone={card.status === "live" ? "ok" : "mute"}>{card.status.toUpperCase()}</StatusChip>
          <span className="tnum text-xs text-slate-400">v{card.version}</span>
          <button onClick={onClose} aria-label="close details" className="ml-auto rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:hover:bg-ink-800"><X size={16} /></button>
        </div>

        <div className="mt-4 flex flex-col gap-4 text-sm">
          <section>
            <div className="text-xs uppercase tracking-widest text-slate-400">line &amp; source</div>
            <div className="mt-1">
              <FormattedText text={line?.name ?? card.lineId} lineName={line?.name ?? card.lineId} />{" "}
              <span className="font-mono text-xs text-slate-400">{card.lineId}</span>
            </div>
            <div className="mt-1 text-slate-500">
              {card.granularity}{card.unit ? ` · ${card.unit}` : ""}{card.threshold != null ? ` · warn > ${card.threshold}` : ""}
            </div>
            <div className="mt-1">tables: <FormattedText text={card.tables.join(", ") || "—"} highlightTables /></div>
            <div className="mt-1 text-xs text-slate-400">
              created {new Date(card.createdAt).toLocaleString()} · updated {new Date(card.updatedAt).toLocaleString()}
            </div>
          </section>

          <section>
            <div className="mb-1 flex items-center">
              <span className="text-xs uppercase tracking-widest text-slate-400">sql (full)</span>
              <Btn variant="ghost" size="sm" icon={Copy} onClick={() => void copySql()} className="ml-auto">
                {copied ? "copied ✓" : "copy → playground"}
              </Btn>
            </div>
            <pre className="overflow-auto rounded bg-slate-100 p-3 font-mono text-xs dark:bg-ink-800">{card.sql || "(no SQL yet)"}</pre>
            {card.extractHint && <div className="mt-1 text-xs text-slate-500">extract hint: {card.extractHint}</div>}
          </section>

          <section>
            <div className="text-xs uppercase tracking-widest text-slate-400">lineage</div>
            {template ? (
              <div className="mt-1">
                stamped from <span className="font-medium">{template.name}</span>{" "}
                <span className="tnum text-xs text-slate-400">template v{template.version} · copy taken at v{card.templateVersion ?? "?"}</span>
                {drift && (
                  <div className="mt-1 text-xs text-state-warn">
                    drift: template is now v{template.version}, this copy was taken at v{card.templateVersion} — Check all copies on the template to preview an update.
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-1 text-slate-500">crafted from scratch — no parent template.</div>
            )}
          </section>

          <section>
            <div className="text-xs uppercase tracking-widest text-slate-400">test state (what Go-live checks)</div>
            <div className="mt-1 text-xs">
              {card.lastTest
                ? <span className={card.lastTest.ok ? "text-state-ok" : "text-state-bad"}>
                    last test {card.lastTest.ok ? "passed" : `failed: ${card.lastTest.error}`} · {new Date(card.lastTest.at).toLocaleTimeString()} · hash <span className="font-mono">{card.lastTest.sqlHash}</span>
                  </span>
                : <span className="text-slate-400">never tested — cannot go live</span>}
            </div>
          </section>

          <section>
            <div className="mb-1 flex items-center gap-2">
              <span className="text-xs uppercase tracking-widest text-slate-400">graphs — checked feeds RAG</span>
              <Btn variant="ghost" size="sm" icon={Sparkles} onClick={() => void reRecommend()} loading={recommending} disabled={recommending} className="ml-auto" title="Re-run the one-time recommendation on fresh test data. Adds new specs; never deletes.">
                Re-recommend
              </Btn>
            </div>
            {error && <div className="mb-1 text-xs text-state-bad">{error}</div>}
            {chartSpecs.length === 0 && tableSpecs.length === 0 ? (
              <div className="text-xs text-slate-500">no graphs yet — open the Graph designer or press Re-recommend.</div>
            ) : chartSpecs.length === 0 ? (
              <div className="text-xs text-slate-500">no plottable charts — exact values in Data tables below.</div>
            ) : (
              <div className="flex flex-col gap-2">
                {chartSpecs.map((g) => {
                  const cfg = (g.config ?? {}) as Record<string, unknown>;
                  const rag = cfg.selected_for_rag !== false;
                  return (
                    <div key={g.id} className="rounded-lg border border-slate-200 p-2.5 dark:border-ink-800">
                      <div className="flex items-center gap-2">
                        <input type="checkbox" checked={rag} onChange={() => void toggleRag(g, !rag)} title="Feed this chart to RAG prompts" className="h-4 w-4 accent-teal-500" />
                        <StatusChip tone="accent">{g.chartType}</StatusChip>
                        {cfg.merged === true && <span className="rounded-full bg-violet-500/10 px-1.5 py-px text-[10px] text-violet-400 ring-1 ring-violet-500/30">merged</span>}
                        {(cfg.source as string) === "ai-recommended" && <span className="rounded-full bg-accent-500/10 px-1.5 py-px text-[10px] text-accent-500 ring-1 ring-accent-500/30">AI</span>}
                        <span className="font-medium">{g.name || g.title || "Untitled"}</span>
                        <span className="tnum text-xs text-slate-400">v{g.version}</span>
                      </div>
                      <div className="ml-6 mt-0.5 text-xs text-slate-400">x:{g.xColumn} y:{g.yColumns.join(",") || "—"}</div>
                      {typeof cfg.rationale === "string" && cfg.rationale && <div className="ml-6 mt-0.5 text-xs text-slate-500">{cfg.rationale}</div>}
                      {typeof cfg.conditions === "string" && cfg.conditions && <div className="ml-6 mt-0.5 text-xs text-accent-500/90">◷ {cfg.conditions}</div>}
                      {previewRows && cfg.merged !== true && (
                        <div className="ml-6 mt-1">
                          {isTradingEligible(previewRows.rows, g.xColumn, g.yColumns, g.chartType) ? (
                            <TradingChart rows={previewRows.rows} x={g.xColumn} yCols={g.yColumns} type={g.chartType as "line" | "area"} threshold={card.threshold} height={180} units={card.unit || undefined} />
                          ) : (
                            <Chart rows={previewRows.rows} x={g.xColumn} yCols={g.yColumns} type={g.chartType} threshold={card.threshold} height={140} />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {graphs.length > 0 && !previewRows && (
              <Btn variant="ghost" size="sm" onClick={() => void loadPreview()} loading={previewLoading} disabled={previewLoading} className="mt-2">
                Load chart previews
              </Btn>
            )}
          </section>

          {tableSpecs.length > 0 && (
            <section>
              <div className="text-xs uppercase tracking-widest text-slate-400">data tables — exact values</div>
              <div className="mt-1 flex flex-col gap-1.5">
                {tableSpecs.map((g) => (
                  <div key={g.id} className="rounded-lg border border-slate-200 p-2 dark:border-ink-800">
                    <div className="flex items-center gap-2 text-sm">
                      <StatusChip tone="accent">table</StatusChip>
                      <span className="font-medium">{g.name || g.title || "Untitled"}</span>
                      <Btn variant="ghost" size="sm" onClick={() => void viewTable(g.id)} loading={previewLoading && openTable !== g.id} disabled={previewLoading} className="ml-auto">
                        {openTable === g.id ? "Hide table" : "View table"}
                      </Btn>
                    </div>
                    {openTable === g.id && previewRows && (
                      <div className="mt-1"><Chart rows={previewRows.rows} x={g.xColumn} yCols={[]} type="table" /></div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="text-xs uppercase tracking-widest text-slate-400">attached</div>
            <div className="mt-1 text-xs text-slate-500">
              bank <span className={bankReady ? "text-state-ok" : "text-slate-400"}>{bankReady ? "ready ✓" : "not pushed"}</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
