import { useEffect, useState } from "react";
import { History as HistoryIcon, Play, Save } from "lucide-react";
import { playgroundApi, type Line, type PlaygroundResult, type QueryHistoryEntry, type LineColumn } from "../lib/api";
import { AlertBanner, StatusChip } from "../components/chips";
import { Btn } from "../components/ui";

export function Playground() {
  const [lines, setLines] = useState<Line[]>([]);
  const [lineId, setLineId] = useState("");
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<QueryHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [lineCols, setLineCols] = useState<LineColumn[]>([]);
  const [showSave, setShowSave] = useState(false);
  const [saveDraft, setSaveDraft] = useState({ name: "", tables: "", granularity: "hourly", unit: "", extractHint: "" });

  useEffect(() => {
    import("../lib/api").then(({ api }) => api.listLines().then((l) => {
      const active = l.filter((x) => x.active);
      setLines(active);
      if (active.length > 0 && !lineId) setLineId(active[0].id);
    }));
  }, []);

  useEffect(() => {
    if (lineId) {
      playgroundApi.history(lineId).then(setHistory).catch(() => {});
      playgroundApi.columns(lineId).then((r) => setLineCols(r.columns)).catch(() => setLineCols([]));
    }
  }, [lineId]);

  async function onRun() {
    if (!lineId || !sql.trim()) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const r = await playgroundApi.run(lineId, sql);
      setResult(r);
      const h = await playgroundApi.history(lineId);
      setHistory(h);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  function onRerun(entry: QueryHistoryEntry) {
    setSql(entry.sql);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">SQL Playground</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-ink-400">
        write and execute read-only queries against your line's tables · results capped at 100 rows
      </p>

      {error && <div className="mt-4"><AlertBanner tone="bad" title="Query failed" detail={error} /></div>}

      <div className="mt-4 flex gap-3">
        <label className="block text-sm">
          Line
          <select
            value={lineId}
            onChange={(e) => setLineId(e.target.value)}
            className="mt-1 w-64 rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-ink-700"
          >
            {lines.map((l) => <option key={l.id} value={l.id}>{l.id} — {l.name}</option>)}
          </select>
        </label>
        {lineCols.length > 0 && (
          <div className="flex flex-wrap items-end gap-1 text-xs text-slate-400 dark:text-ink-500">
            {lineCols.slice(0, 12).map((c) => (
              <button
                key={`${c.table}.${c.name}`}
                onClick={() => setSql((s) => s ? `${s} ${c.name}` : c.name)}
                className="rounded border border-slate-200 px-1.5 py-0.5 hover:bg-slate-100 dark:border-ink-700 dark:hover:bg-ink-800"
                title={`${c.table} · ${c.type}`}
              >
                {c.name}
              </button>
            ))}
            {lineCols.length > 12 && <span className="text-slate-400">+{lineCols.length - 12} more</span>}
          </div>
        )}
      </div>

      <div className="mt-3">
        <textarea
          rows={6}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          placeholder="SELECT * FROM readings_temp LIMIT 50"
          className="w-full rounded-lg border border-slate-300 bg-transparent p-3 font-mono text-sm dark:border-ink-700"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onRun(); }}
        />
        <div className="mt-1 flex items-center gap-3 text-xs text-slate-400 dark:text-ink-500">
          <span>Ctrl+Enter to run</span>
          <span>·</span>
          <span>SELECT/WITH/SHOW/EXPLAIN only</span>
          <span>·</span>
          <span>no multi-statement</span>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <Btn
          variant="primary"
          icon={Play}
          onClick={() => void onRun()}
          loading={running}
          disabled={running || !lineId || !sql.trim()}
        >
          {running ? "running…" : "Run query"}
        </Btn>
        {result && (
          <Btn
            icon={Save}
            onClick={() => {
              const line = lines.find((l) => l.id === lineId);
              setSaveDraft({ name: "", tables: line?.memberTables.join(", ") ?? "", granularity: "hourly", unit: "", extractHint: "" });
              setShowSave(true);
            }}
          >
            Save as card
          </Btn>
        )}
        <Btn
          icon={HistoryIcon}
          onClick={() => setShowHistory(!showHistory)}
          className="ml-auto"
        >
          History ({history.length})
        </Btn>
      </div>

      {result && (
        <div className="mt-4 overflow-auto rounded-xl border border-slate-200 dark:border-ink-800">
          <div className="border-b border-slate-200 px-4 py-2 text-sm dark:border-ink-800">
            <span className="tnum font-semibold">{result.rowCount}</span> rows
            {result.capped && <span className="ml-2 text-state-warn">capped to 100</span>}
            <span className="ml-2 text-slate-400">{result.durationMs}ms</span>
          </div>
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-ink-800">
                {result.columns.map((c) => <th key={c} className="px-3 py-2 font-semibold">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100 dark:border-ink-800">
                  {result.columns.map((c) => <td key={c} className="px-3 py-1.5">{String(r[c] ?? "")}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result && result.rows.length === 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-ink-700">
          <div className="text-sm text-slate-500">Query returned 0 rows</div>
        </div>
      )}

      {showHistory && (
        <div className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-ink-800">
          <div className="text-sm font-semibold">Recent queries</div>
          {history.length === 0 && <div className="mt-2 text-sm text-slate-400">No history yet</div>}
          {history.map((h) => (
            <div
              key={h.id}
              className="mt-2 flex cursor-pointer items-center gap-2 rounded-lg border border-slate-100 p-2 text-xs hover:bg-slate-50 dark:border-ink-800 dark:hover:bg-ink-800/50"
              onClick={() => onRerun(h)}
            >
              <StatusChip tone={h.ok ? "ok" : "bad"}>{h.ok ? "ok" : "fail"}</StatusChip>
              <span className="tnum text-slate-400">{h.rowCount != null ? `${h.rowCount} rows` : "—"}</span>
              <span className="tnum text-slate-400">{h.durationMs != null ? `${h.durationMs}ms` : "—"}</span>
              <span className="truncate font-mono text-slate-500">{h.sql.slice(0, 80)}</span>
              <span className="ml-auto text-slate-400">{new Date(h.createdAt).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}

      {showSave && (
        <Modal title="Save as card (dormant)" onClose={() => setShowSave(false)}>
          <Field label="Card name">
            <input value={saveDraft.name} onChange={(e) => setSaveDraft({ ...saveDraft, name: e.target.value })} className={inp} />
          </Field>
          <Field label="Tables (comma-separated, must be line members)">
            <input value={saveDraft.tables} onChange={(e) => setSaveDraft({ ...saveDraft, tables: e.target.value })} className={`${inp} font-mono`} />
          </Field>
          <div className="flex gap-3">
            <Field label="Granularity">
              <select value={saveDraft.granularity} onChange={(e) => setSaveDraft({ ...saveDraft, granularity: e.target.value })} className={inp}>
                <option value="hourly">hourly</option>
                <option value="shift">shift</option>
                <option value="daily">daily</option>
              </select>
            </Field>
            <Field label="Unit">
              <input value={saveDraft.unit} onChange={(e) => setSaveDraft({ ...saveDraft, unit: e.target.value })} placeholder="°C, pcs…" className={inp} />
            </Field>
          </div>
          <Field label="Extraction hint">
            <textarea rows={2} value={saveDraft.extractHint} onChange={(e) => setSaveDraft({ ...saveDraft, extractHint: e.target.value })} className={inp} />
          </Field>
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setShowSave(false)} className="rounded-lg px-4 py-2 text-sm text-slate-500 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:hover:bg-ink-800">cancel</button>
            <Btn
              variant="primary"
              icon={Save}
              onClick={() => void (async () => {
                if (!saveDraft.name.trim()) return;
                const { cardApi } = await import("../lib/api");
                await cardApi.createCard({
                  lineId, name: saveDraft.name,
                  tables: saveDraft.tables.split(",").map((s) => s.trim()).filter(Boolean),
                  sql, granularity: saveDraft.granularity,
                  unit: saveDraft.unit, extractHint: saveDraft.extractHint,
                });
                setShowSave(false);
                setSql("");
                setResult(null);
              })()}
              disabled={!saveDraft.name.trim()}
            >
              Save dormant card
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

const inp = "mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-ink-700";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm">{label}<span className="block">{children}</span></label>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="anim-fade-in fixed inset-0 z-10 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="anim-pop-in max-h-[90vh] w-[36rem] overflow-auto rounded-xl bg-white p-6 dark:bg-ink-900" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">{title}</h2>
        <div className="mt-4 flex flex-col gap-3">{children}</div>
      </div>
    </div>
  );
}
