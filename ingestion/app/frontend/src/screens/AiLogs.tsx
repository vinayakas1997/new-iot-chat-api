import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw, Search } from "lucide-react";
import { aiLogsApi, api, llmReasonText, type Line, type LlmCallRecord, type LlmCallStats } from "../lib/api";
import { AlertBanner, StatusChip } from "../components/chips";
import { Btn } from "../components/ui";

const PAGE = 50;

const ROUTES = [
  { v: "", label: "all sources" },
  { v: "recommend-template", label: "recommend · feature" },
  { v: "recommend-card", label: "recommend · card" },
  { v: "optimize-charts", label: "optimize · line" },
  { v: "banks-suggest", label: "banks · suggest" },
  { v: "tick-extract", label: "tick · extract" },
];

function routeLabel(route: string): string {
  return ROUTES.find((r) => r.v === route)?.label ?? route;
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function contextOf(c: LlmCallRecord): string {
  return c.cardId ?? c.lineId ?? c.templateId ?? "—";
}

/** F6: every backend AI call. Verdict: is the LLM healthy, and why did each call end the way it did? */
export function AiLogs() {
  const [stats, setStats] = useState<LlmCallStats | null>(null);
  const [rows, setRows] = useState<LlmCallRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [route, setRoute] = useState("");
  const [line, setLine] = useState("");
  const [date, setDate] = useState("");
  const [ok, setOk] = useState<"all" | "true" | "false">("all");
  const [q, setQ] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listLines().then(setLines).catch(() => setLines([]));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setAppliedQ(q);
      setPage(0);
    }, 400);
    return () => clearTimeout(t);
  }, [q]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [s, l] = await Promise.all([
        aiLogsApi.stats(),
        aiLogsApi.list({
          route: route || undefined,
          line: line || undefined,
          date: date || undefined,
          ok,
          q: appliedQ || undefined,
          limit: PAGE,
          offset: page * PAGE,
        }),
      ]);
      setStats(s);
      setRows(l.rows);
      setTotal(l.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, line, date, ok, appliedQ, page]);

  function resetPage() {
    setPage(0);
  }

  const sel = "rounded-lg border border-slate-300 bg-transparent px-2 py-1.5 text-sm dark:border-ink-700";
  const from = total === 0 ? 0 : page * PAGE + 1;
  const to = Math.min(total, page * PAGE + PAGE);

  return (
    <div>
      <h1 className="text-2xl font-bold">AI Logs</h1>
      <p className="mt-1 text-sm text-slate-500">
        {stats ? (
          <>
            <span className="tnum font-semibold text-slate-700 dark:text-ink-100">{stats.last24h}</span> calls in 24h
            {stats.okRate != null && (
              <> · <span className="tnum font-semibold text-slate-700 dark:text-ink-100">{Math.round(stats.okRate * 100)}%</span> ok</>
            )} · avg <span className="tnum">{fmtMs(stats.avgLatencyMs)}</span> ·{" "}
            <span className="tnum">{stats.retries24h}</span> retries · retaining{" "}
            <span className="tnum">{stats.retained}/{stats.cap}</span>
          </>
        ) : (
          "every backend AI call, success or failure — expand a row for tries, prompt, response and reason"
        )}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => { setDate(e.target.value); resetPage(); }}
          className={sel}
          title="Filter by date (UTC)"
        />
        <select value={line} onChange={(e) => { setLine(e.target.value); resetPage(); }} className={sel} title="Filter by line">
          <option value="">all lines</option>
          {lines.map((l) => (
            <option key={l.id} value={l.id}>{l.name} · {l.id}</option>
          ))}
        </select>
        <select value={route} onChange={(e) => { setRoute(e.target.value); resetPage(); }} className={sel} title="Filter by source">
          {ROUTES.map((r) => (
            <option key={r.v} value={r.v}>{r.label}</option>
          ))}
        </select>
        <select value={ok} onChange={(e) => { setOk(e.target.value as "all" | "true" | "false"); resetPage(); }} className={sel} title="Filter by outcome">
          <option value="all">ok + failed</option>
          <option value="true">ok only</option>
          <option value="false">failed only</option>
        </select>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="model, reason, card…"
            className="rounded-lg border border-slate-300 bg-transparent py-1.5 pl-8 pr-2 text-sm dark:border-ink-700"
          />
        </div>
        <Btn size="sm" icon={RefreshCw} onClick={() => void load()} loading={loading} disabled={loading} title="Reload from the server">
          Refresh
        </Btn>
        <span className="tnum ml-auto text-xs text-slate-400">{loading ? "loading…" : `${from}–${to} of ${total}`}</span>
      </div>

      {error && <div className="mt-3"><AlertBanner tone="bad" title="Could not load AI logs" detail={error} /></div>}

      <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-ink-800">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-400 dark:border-ink-800">
              <th className="w-8 px-2 py-2"></th>
              <th className="px-3 py-2">time</th>
              <th className="px-3 py-2">source</th>
              <th className="px-3 py-2">context</th>
              <th className="px-3 py-2">model</th>
              <th className="px-3 py-2 text-right">tries</th>
              <th className="px-3 py-2 text-right">taken</th>
              <th className="px-3 py-2">outcome</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const isOpen = !!open[c.id];
              return (
                <Fragment key={c.id}>
                  <tr
                    key={c.id}
                    onClick={() => setOpen((o) => ({ ...o, [c.id]: !o[c.id] }))}
                    className="cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-ink-800 dark:hover:bg-ink-900/50"
                  >
                    <td className="px-2 py-2.5 text-slate-400">
                      {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </td>
                    <td className="tnum whitespace-nowrap px-3 py-2.5 text-xs">{new Date(c.at).toLocaleString()}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{routeLabel(c.route)}</td>
                    <td className="max-w-48 truncate px-3 py-2.5 font-mono text-xs" title={contextOf(c)}>{contextOf(c)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-500">{c.model || "—"}</td>
                    <td className="tnum px-3 py-2.5 text-right">
                      {c.attempts > 0 ? (
                        <span className={c.attempts > 1 ? "font-semibold text-state-warn" : ""} title={c.attempts > 1 ? "needed retries" : "first try ok"}>
                          {c.attempts}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="tnum px-3 py-2.5 text-right">{c.attempts > 0 ? fmtMs(c.latencyMs) : "—"}</td>
                    <td className="px-3 py-2.5">
                      {c.success ? (
                        <StatusChip tone="ok">ok</StatusChip>
                      ) : (
                        <span title={llmReasonText(c.reason)}>
                          <StatusChip tone="bad">{c.reason ?? "failed"}</StatusChip>
                        </span>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr key={`${c.id}-detail`} className="border-b border-slate-200 bg-slate-50/70 dark:border-ink-800 dark:bg-ink-900/40">
                      <td></td>
                      <td colSpan={7} className="px-3 py-3">
                        {!c.success && (
                          <div className="mb-2 text-sm">
                            <span className="font-medium text-state-bad">Why it failed: </span>
                            <span className="text-slate-600 dark:text-ink-200">{llmReasonText(c.reason)}</span>
                          </div>
                        )}
                        <div className="mb-1 text-xs uppercase tracking-widest text-slate-400">tries · {c.attempts} attempt{c.attempts === 1 ? "" : "s"} · {fmtMs(c.latencyMs)} total</div>
                        {c.attemptsJson.length === 0 && <div className="text-xs text-slate-400">no attempts — the call never reached the model.</div>}
                        <div className="flex flex-col gap-1">
                          {c.attemptsJson.map((a, i) => (
                            <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="tnum w-14 text-slate-400">try {a.n}</span>
                              <StatusChip tone={a.outcome === "ok" ? "ok" : a.outcome === "rejected" ? "warn" : "bad"}>{a.outcome}</StatusChip>
                              <span className="tnum text-slate-500">{fmtMs(a.latencyMs)}</span>
                              {a.temperature != null && <span className="tnum text-slate-400" title="Sampling temperature — rises per retry to break repetition loops">t={a.temperature.toFixed(1)}</span>}
                              <span className="break-all font-mono text-slate-600 dark:text-ink-300">{a.detail}</span>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 grid gap-2 lg:grid-cols-2">
                          <div>
                            <div className="mb-1 text-xs uppercase tracking-widest text-slate-400">prompt</div>
                            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-100 p-2.5 font-mono text-xs leading-relaxed dark:bg-ink-800">{c.prompt || "(none)"}</pre>
                          </div>
                          <div>
                            <div className="mb-1 text-xs uppercase tracking-widest text-slate-400">raw response · last try</div>
                            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-100 p-2.5 font-mono text-xs leading-relaxed dark:bg-ink-800">{c.responseText || "(empty — the model returned nothing)"}</pre>
                          </div>
                        </div>
                        {c.parsedJson != null && (
                          <div className="mt-2">
                            <div className="mb-1 text-xs uppercase tracking-widest text-slate-400">parsed result</div>
                            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-100 p-2.5 font-mono text-xs leading-relaxed dark:bg-ink-800">
                              {typeof c.parsedJson === "string" ? c.parsedJson : JSON.stringify(c.parsedJson, null, 1)}
                            </pre>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-sm text-slate-400">
                  no AI calls match — trigger a recommend, a bank suggest, or wait for the next tick
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        <Btn size="sm" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>← newer</Btn>
        <span className="tnum text-xs text-slate-400">page {page + 1}{total > 0 && ` · ${Math.ceil(total / PAGE)}`}</span>
        <Btn size="sm" disabled={loading || to >= total} onClick={() => setPage((p) => p + 1)}>older →</Btn>
      </div>
    </div>
  );
}
