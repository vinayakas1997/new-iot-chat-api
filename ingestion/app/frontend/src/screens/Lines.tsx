import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Brain, Check, Eye, FileUp, Layers, Pencil, Pause, Play, Plus, Save, Search, Sparkles, Trash2 } from "lucide-react";
import { api, bankApi, cardApi, globalTableApi, type BankOverviewEntry, type Connection, type Line, type TableRef } from "../lib/api";
import { TableAnalyzeDialog } from "../components/TableAnalyzeDialog";
import { AlertBanner, StatusChip } from "../components/chips";
import { PushToHindsight } from "../components/PushToHindsight";
import { LinePreview } from "../components/LinePreview";
import { FormattedText } from "../components/FormattedText";
import { Btn, EmptyState } from "../components/ui";

type Draft = { id: string; name: string; connectionId: string; memberTables: string[] };

/** F2: table-first registry. Verdict top-left: which lines are in the pipeline? */
export function Lines() {
  const [rows, setRows] = useState<Line[]>([]);
  const [conns, setConns] = useState<Connection[]>([]);
  const [q, setQ] = useState("");
  const [connFilter, setConnFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Line | null>(null);
  const [draft, setDraft] = useState<Draft>({ id: "", name: "", connectionId: "", memberTables: [] });
  const [pickTables, setPickTables] = useState<TableRef[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [unassigned, setUnassigned] = useState<Record<string, string[]>>({});
  const [banks, setBanks] = useState<Record<string, BankOverviewEntry>>({});
  const [greenByLine, setGreenByLine] = useState<Record<string, number>>({});
  const [pushLine, setPushLine] = useState<Line | null>(null);
  const [previewLine, setPreviewLine] = useState<Line | null>(null);
  const [analyzeTable, setAnalyzeTable] = useState<TableRef | null>(null);
  const [detailTable, setDetailTable] = useState<TableRef | null>(null);
  const [columnMeta, setColumnMeta] = useState<Record<string, { total: number; filled: number; analyzed: boolean }>>({});
  const [openMeta, setOpenMeta] = useState<Record<string, { total: number; filled: number; analyzed: boolean }>>({});
  const [viewTarget, setViewTarget] = useState<{ lineId: string; schema: string; table: string } | null>(null);
  const [expandedAnalyze, setExpandedAnalyze] = useState<{ lineId: string; schema: string; table: string } | null>(null);
  // Draft meanings for Register line before the line row exists — key "schema.table" lower, value is the last saved columns from Analyze
  const [draftMeanings, setDraftMeanings] = useState<Record<string, { name: string; meaning: string; datatype: string }[]>>({});
  const [globalMeta, setGlobalMeta] = useState<Record<string, { total: number; filled: number; analyzed: boolean; sourceLineId: string; sourceLineName: string; columns: { name: string; meaning: string; datatype: string }[] }>>({});
  const [params, setParams] = useSearchParams();

  async function refresh() {
    try {
      const [l, c] = await Promise.all([api.listLines(), api.listConnections()]);
      setRows(l);
      setConns(c.filter((x) => x.enabled));
      cardApi.listCards().then((cards) => {
        const g: Record<string, number> = {};
        for (const card of cards) {
          if (card.lastTest?.ok) g[card.lineId] = (g[card.lineId] ?? 0) + 1;
        }
        setGreenByLine(g);
      }).catch(() => {});
      bankApi.overview().then((o) => {
        const m: Record<string, BankOverviewEntry> = {};
        for (const b of o.banks) m[b.lineId] = b;
        setBanks(m);
      }).catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => void refresh(), []);

  // Column meanings meta for the line being edited (Analyzed badges)
  async function refreshColumnMeta(lineId: string) {
    if (!lineId) { setColumnMeta({}); return; }
    try {
      const r = await api.columnMeta(lineId);
      const m: Record<string, { total: number; filled: number; analyzed: boolean }> = {};
      for (const row of r.meta) {
        const k = row.tableName.toLowerCase();
        if (!m[k]) m[k] = { total: 0, filled: 0, analyzed: false };
        m[k].total++;
        if (row.meaning.trim()) m[k].filled++;
      }
      for (const k of Object.keys(m)) m[k].analyzed = m[k].total > 0 && m[k].filled === m[k].total;
      setColumnMeta(m);
    } catch { /* meta is best-effort */ }
  }
  useEffect(() => {
    if (showForm && editing) { void refreshColumnMeta(editing.id); setDraftMeanings({}); }
    if (showForm && !editing) { setColumnMeta({}); setDraftMeanings({}); }
  }, [showForm, editing]);

  useEffect(() => {
    if (!openId) { setOpenMeta({}); return; }
    (async () => {
      try {
        const r = await api.columnMeta(openId);
        const m: Record<string, { total: number; filled: number; analyzed: boolean }> = {};
        for (const row of r.meta) {
          const k = row.tableName.toLowerCase();
          if (!m[k]) m[k] = { total: 0, filled: 0, analyzed: false };
          m[k].total++;
          if (row.meaning.trim()) m[k].filled++;
        }
        for (const k of Object.keys(m)) m[k].analyzed = m[k].total > 0 && m[k].filled === m[k].total;
        setOpenMeta(m);
      } catch { setOpenMeta({}); }
    })();
  }, [openId]);

  // Deep link from template tiles (?edit=<lineId>): open the line's edit form once rows arrive.
  useEffect(() => {
    const id = params.get("edit");
    if (!id || rows.length === 0) return;
    const l = rows.find((x) => x.id === id);
    setParams({}, { replace: true });
    if (l) openForm(l);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const filtered = rows.filter((l) => {
    if (connFilter && l.connectionId !== connFilter) return false;
    if (q && !`${l.id} ${l.name} ${l.memberTables.join(" ")}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  const activeCount = rows.filter((l) => l.active).length;

  async function loadPickTables(connectionId: string) {
    setPickTables([]);
    if (!connectionId) return;
    try {
      const r = await api.listTables(connectionId);
      setPickTables(r.tables);
      const u = await api.unassignedTables(connectionId);
      setUnassigned((m) => ({ ...m, [connectionId]: u.unassigned }));
      // Globally analysed lookup — same DB, same table name → reuse analysed state for new Line B
      try {
        const g = await globalTableApi.meta(connectionId);
        const m: Record<string, { total: number; filled: number; analyzed: boolean; sourceLineId: string; sourceLineName: string; columns: { name: string; meaning: string; datatype: string }[] }> = {};
        for (const x of g.meta) m[x.tableName.toLowerCase()] = { total: x.total, filled: x.filled, analyzed: x.analyzed, sourceLineId: x.sourceLineId, sourceLineName: x.sourceLineName, columns: x.columns };
        setGlobalMeta(m);
      } catch { setGlobalMeta({}); }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function openForm(l?: Line) {
    setEditing(l ?? null);
    const d = l
      ? { id: l.id, name: l.name, connectionId: l.connectionId, memberTables: [...l.memberTables] }
      : { id: "", name: "", connectionId: conns[0]?.id ?? "", memberTables: [] };
    setDraft(d);
    setShowForm(true);
    void loadPickTables(d.connectionId);
  }

  function toggleTable(t: string) {
    setDraft((d) => ({
      ...d,
      memberTables: d.memberTables.includes(t)
        ? d.memberTables.filter((x) => x !== t)
        : [...d.memberTables, t],
    }));
  }

  async function onSave() {
    setError(null);
    try {
      if (editing) {
        await api.updateLine(editing.id, { name: draft.name, connectionId: draft.connectionId, memberTables: draft.memberTables });
      } else {
        if (!draft.id.trim()) throw new Error("Line id is required");
        const created = await api.createLine(draft);
        // Flush draft meanings (collected before the line row existed) into the new line's meta — only for selected tables.
        for (const [k, cols] of Object.entries(draftMeanings)) {
          if (!draft.memberTables.map((x) => x.toLowerCase()).includes(k)) continue;
          const [sch, tbl] = k.includes(".") ? k.split(".", 2) as [string, string] : ["public", k];
          try { await api.saveTableColumns(created.id, sch, tbl, cols); } catch (e) { setError(`Saved line but failed to save meanings for ${k}: ${(e as Error).message}`); }
        }
        setDraftMeanings({});
      }
      setShowForm(false);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onDeregister(l: Line) {
    if (!confirm(`Deregister "${l.id}"? Ticks stop; history stays visible.`)) return;
    await api.deregisterLine(l.id);
    await refresh();
  }

  async function onDelete(l: Line) {
    if (!confirm(`Delete line "${l.id}" — "${l.name}"? This removes its table grouping and column meanings. Blocked while cards still reference it.`)) return;
    try {
      await api.deleteLine(l.id);
      if (openId === l.id) setOpenId(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">
        {activeCount} line{activeCount === 1 ? "" : "s"} in the pipeline
      </h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-ink-400">
        setter-defined groupings over plant tables · unregistered tables ingest nothing
      </p>

      {error && <div className="mt-4"><AlertBanner tone="bad" title="Request failed" detail={error} /></div>}

      <div className="mt-6 flex items-center gap-3">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by line, or by table name…"
            className="w-80 rounded-lg border border-slate-300 bg-transparent py-2 pl-9 pr-3 text-sm focus:border-accent-500 focus:outline-none dark:border-ink-700"
          />
        </div>
        <select
          value={connFilter}
          onChange={(e) => setConnFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-ink-700"
        >
          <option value="">all connections</option>
          {conns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <Btn variant="primary" icon={Plus} onClick={() => openForm()} className="glass-pill glass-pill--blue">
          Register line
        </Btn>
      </div>

      <table className="mt-4 w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-400 dark:border-ink-800 dark:text-ink-600">
            <th className="py-2 pr-4">Line</th>
            <th className="py-2 pr-4">Connection</th>
            <th className="py-2 pr-4">Tables</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4">Last tick</th>
            <th className="py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((l) => (
            <>
              <tr
                key={l.id}
                onClick={() => setOpenId(openId === l.id ? null : l.id)}
                className="cursor-pointer border-b border-slate-100 hover:bg-slate-50 dark:border-ink-800 dark:hover:bg-ink-900"
              >
                <td className="py-2.5 pr-4"><span className="font-mono font-medium">{l.id}</span> <FormattedText text={l.name} lineName={l.name} /></td>
                <td className="py-2.5 pr-4 text-slate-500 dark:text-ink-400">{l.connectionLabel}</td>
                <td className="tnum py-2.5 pr-4 text-slate-500 dark:text-ink-400">{l.memberTables.length}</td>
                <td className="py-2.5 pr-4">
                  {l.active ? <StatusChip tone="ok">ingesting</StatusChip> : <StatusChip tone="mute">deregistered</StatusChip>}
                </td>
                <td className="tnum py-2.5 pr-4 text-slate-500 dark:text-ink-400">
                  {l.lastTick ? new Date(l.lastTick).toLocaleString() : "—"}
                </td>
                <td className="py-2.5" onClick={(e) => e.stopPropagation()}>
                  <span className="mr-2 inline-flex"><Btn variant="ghost" icon={Pencil} onClick={() => openForm(l)}>edit</Btn></span>
                  <span className="mr-2 inline-flex"><Btn variant="ghost" icon={Eye} onClick={() => setPreviewLine(l)} title="Preview a feature's charts on this line's data — same template, this line's numbers">preview</Btn></span>
                  {(() => {
                    const b = banks[l.id];
                    const green = greenByLine[l.id] ?? 0;
                    if (b?.ready) {
                      return <span className="mr-2 inline-flex"><Btn variant="ok" icon={Brain} onClick={() => setPushLine(l)} title={`bank:line-${l.id} ready — reopen to review or re-push`} className="glass-pill glass-pill--ok">bank ✓</Btn></span>;
                    }
                    return (
                      <span className="mr-2 inline-flex">
                        <Btn
                          variant="ghost"
                          icon={Brain}
                          onClick={() => setPushLine(l)}
                          disabled={green === 0}
                          title={green === 0 ? "Needs at least one tested-green card before pushing to Hindsight" : `Preview bank:line-${l.id} and push to Hindsight`}
                        >
                          → hindsight
                        </Btn>
                      </span>
                    );
                  })()}
                  {l.active
                    ? <Btn variant="warn" icon={Pause} onClick={() => void onDeregister(l)} className="glass-pill glass-pill--amber">deregister</Btn>
                    : <Btn variant="ok" icon={Play} onClick={() => void api.reregisterLine(l.id).then(() => refresh())} className="glass-pill glass-pill--ok">re-register</Btn>}
                  <Btn variant="bad" icon={Trash2} onClick={() => void onDelete(l)} title="Delete this line — blocked while cards reference it" className="ml-2 glass-pill glass-pill--bad">delete</Btn>
                </td>
              </tr>
              {openId === l.id && (
                <tr key={`${l.id}-detail`}>
                  <td colSpan={6} className="border-b border-slate-200 bg-slate-50/60 px-4 py-4 dark:border-ink-800 dark:bg-ink-900/50">
                    <div className="text-xs uppercase tracking-wider text-slate-400">member tables · <span className="tnum">{l.memberTables.length}</span></div>
                    <div className="mt-2 flex flex-col gap-1.5">
                      {l.memberTables.map((t) => {
                        const meta = openMeta[t.toLowerCase()];
                        const analyzed = meta?.analyzed ?? false;
                        const hasAny = (meta?.total ?? 0) > 0;
                        const [sch, tbl] = t.includes(".") ? t.split(".", 2) as [string, string] : ["public", t];
                        return (
                          <div key={t} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-ink-800 dark:bg-ink-800/40">
                            <StatusChip tone="accent"><FormattedText text={t} highlightTables /></StatusChip>
                            {hasAny && (
                              analyzed
                                ? <span className="inline-flex items-center gap-1 rounded-full bg-state-ok/10 px-1.5 py-px text-[10px] font-medium text-state-ok ring-1 ring-state-ok/30"><Check size={10} />Analyzed {meta.filled}/{meta.total}</span>
                                : <span className="inline-flex items-center gap-1 rounded-full bg-state-warn/10 px-1.5 py-px text-[10px] font-medium text-state-warn ring-1 ring-state-warn/30">{meta.filled}/{meta.total} meanings</span>
                            )}
                            {!hasAny && <span className="text-xs text-slate-400">not analyzed</span>}
                            <span className="ml-auto inline-flex items-center gap-1">
                              {!analyzed ? (
                                <Btn variant="warn" icon={Search} onClick={() => setExpandedAnalyze({ lineId: l.id, schema: sch, table: tbl })} title="Analyze — draft meanings for this table" className="glass-pill glass-pill--amber">Analyze</Btn>
                              ) : (
                                <Btn icon={Pencil} onClick={() => setExpandedAnalyze({ lineId: l.id, schema: sch, table: tbl })} title="Edit — re-open Analyze to change meanings (same view as first time)" className="glass-pill glass-pill--neutral">Edit</Btn>
                              )}
                              <Btn icon={Eye} onClick={() => setViewTarget({ lineId: l.id, schema: sch, table: tbl })} title="View details — columns, meanings, sample" className="glass-pill glass-pill--neutral">view details</Btn>
                            </span>
                          </div>
                        );
                      })}
                      {l.memberTables.length === 0 && <span className="text-sm text-slate-400">none — this line ingests nothing until tables are assigned</span>}
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <Link to={`/setter/history?line=${l.id}`} className="text-sm text-accent-500">view history →</Link>
                      <button onClick={() => openForm(l)} className="text-sm text-slate-500 hover:text-accent-500">edit line →</button>
                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
      {filtered.length === 0 && (
        <EmptyState
          icon={Layers}
          title="No lines registered"
          body="Register your first production line to let the pipeline ingest for it."
          action={<Btn variant="primary" icon={Plus} onClick={() => openForm()} className="glass-pill glass-pill--blue">Register your first line</Btn>}
        />
      )}

      {pushLine && (
        <PushToHindsight
          lineId={pushLine.id}
          lineName={pushLine.name}
          onClose={() => setPushLine(null)}
          onPushed={() => void refresh()}
        />
      )}

      {previewLine && (
        <LinePreview
          line={previewLine}
          onClose={() => setPreviewLine(null)}
        />
      )}

      {detailTable && (() => {
        const isDraftLine = !editing;
        const lineId = editing?.id ?? draft.id;
        const sch = detailTable.schema; const tbl = detailTable.name;
        const lower = `${sch}.${tbl}`.toLowerCase();
        const draftMap = draftMeanings[lower] ? Object.fromEntries(draftMeanings[lower].map((c) => [c.name.toLowerCase(), c.meaning])) : undefined;
        return (
          <TableAnalyzeDialog mode="view" lineId={isDraftLine ? "" : lineId} schema={sch} table={tbl} connectionId={isDraftLine ? draft.connectionId : undefined} initialMeanings={isDraftLine ? draftMap : undefined} onClose={() => setDetailTable(null)} />
        );
      })()}

      {analyzeTable && (() => {
        const isDraftLine = !editing;
        const lineId = editing?.id ?? draft.id;
        const sch = analyzeTable.schema; const tbl = analyzeTable.name;
        const lower = `${sch}.${tbl}`.toLowerCase();
        const draftMap = draftMeanings[lower] ? Object.fromEntries(draftMeanings[lower].map((c) => [c.name.toLowerCase(), c.meaning])) : undefined;
        return (
          <TableAnalyzeDialog mode="edit" lineId={isDraftLine ? "" : lineId} schema={sch} table={tbl} connectionId={isDraftLine ? draft.connectionId : undefined} initialMeanings={draftMap} onClose={() => setAnalyzeTable(null)} onSaved={() => { if (!isDraftLine) { void refreshColumnMeta(lineId); void refresh(); } }} onSaveDraft={(cols) => setDraftMeanings((m) => ({ ...m, [lower]: cols }))} />
        );
      })()}

      {viewTarget && (
        <TableAnalyzeDialog mode="view" lineId={viewTarget.lineId} schema={viewTarget.schema} table={viewTarget.table} onClose={() => setViewTarget(null)} />
      )}

      {expandedAnalyze && (
        <TableAnalyzeDialog mode="edit" lineId={expandedAnalyze.lineId} schema={expandedAnalyze.schema} table={expandedAnalyze.table} onClose={() => setExpandedAnalyze(null)} onSaved={() => { if (expandedAnalyze) { (async () => { try { const r = await api.columnMeta(expandedAnalyze.lineId); const m: Record<string, { total: number; filled: number; analyzed: boolean }> = {}; for (const row of r.meta) { const k = row.tableName.toLowerCase(); if (!m[k]) m[k] = { total: 0, filled: 0, analyzed: false }; m[k].total++; if (row.meaning.trim()) m[k].filled++; } for (const k of Object.keys(m)) m[k].analyzed = m[k].total > 0 && m[k].filled === m[k].total; setOpenMeta(m); } catch {} })(); } void refresh(); }} />
      )}

      {showForm && (
        <div className="anim-fade-in fixed inset-0 flex items-center justify-center bg-black/60" onClick={() => setShowForm(false)}>
          <div className="anim-pop-in max-h-[90vh] w-[32rem] overflow-auto rounded-xl bg-white p-6 dark:bg-ink-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold">{editing ? `Edit ${editing.id}` : "Register line"}</h2>
            <div className="mt-4 flex flex-col gap-3">
              {!editing && (
                <label className="text-sm">Line id (your naming, e.g. line-1)
                  <input value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 font-mono dark:border-ink-700" />
                </label>
              )}
              <label className="text-sm">Display name<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-ink-700" /></label>
              <label className="text-sm">Connection
                <select
                  value={draft.connectionId}
                  onChange={(e) => { setDraft({ ...draft, connectionId: e.target.value, memberTables: [] }); void loadPickTables(e.target.value); }}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-ink-700"
                >
                  {conns.map((c) => <option key={c.id} value={c.id}>{c.label} ({c.type})</option>)}
                </select>
              </label>
              <div className="text-sm">
                <div className="mb-1">Member tables · <span className="tnum">{draft.memberTables.length}</span> selected</div>
                {unassigned[draft.connectionId]?.length ? (
                  <div className="mb-2 text-xs text-state-warn">unassigned in this DB: {unassigned[draft.connectionId].join(", ")}</div>
                ) : null}
                <div className="max-h-56 overflow-auto rounded-lg border border-slate-200 p-2 dark:border-ink-800">
                  {pickTables.map((t) => {
                    const key = `${t.schema}.${t.name}`;
                    const selected = draft.memberTables.includes(key);
                    const lower = key.toLowerCase();
                    const draftCols = draftMeanings[lower];
                    const global = !editing ? globalMeta[lower] : undefined;
                    const draftMeta = draftCols ? { total: draftCols.length, filled: draftCols.filter((c) => c.meaning.trim()).length, analyzed: draftCols.length > 0 && draftCols.every((c) => c.meaning.trim()) } : undefined;
                    const meta = editing ? columnMeta[lower] : draftMeta ?? (global?.analyzed ? global : undefined);
                    const analyzed = meta?.analyzed ?? false;
                    const hasAny = (meta?.total ?? 0) > 0;
                    const isGlobal = !editing && !draftCols && !!global?.analyzed;
                    return (
                      <div key={key} className="flex items-center gap-1 rounded px-2 py-1 text-sm hover:bg-slate-100 dark:hover:bg-ink-800">
                        <label className="flex flex-1 cursor-pointer items-center gap-2">
                          <input type="checkbox" checked={selected} onChange={() => toggleTable(key)} className="accent-teal-500" />
                          <span className="text-slate-400">{t.schema}.</span>{t.name}
                        </label>
                        <span className="ml-auto inline-flex items-center gap-1">
                          {hasAny && analyzed && (
                            <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-medium ring-1 ${isGlobal ? "bg-ic-blue/10 text-ic-blue ring-ic-blue/30" : "bg-state-ok/10 text-state-ok ring-state-ok/30"}`} title={isGlobal ? `Globally analysed in ${global?.sourceLineName} — tick + Edit to reuse` : undefined}>
                              <Check size={10} />Analyzed{isGlobal ? ` · ${global?.sourceLineName}` : ""}
                            </span>
                          )}
                          {hasAny && !analyzed && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-state-warn/10 px-1.5 py-px text-[10px] font-medium text-state-warn ring-1 ring-state-warn/30">{meta!.filled}/{meta!.total} meanings</span>
                          )}
                          {isGlobal && !selected ? (
                            <Btn size="sm" icon={Sparkles} onClick={() => { setDraftMeanings((m) => ({ ...m, [lower]: global!.columns })); setDraft((d) => ({ ...d, memberTables: d.memberTables.includes(key) ? d.memberTables : [...d.memberTables, key] })); }} title={`Use meanings from ${global?.sourceLineName}`} className="glass-pill glass-pill--blue">Use</Btn>
                          ) : selected ? (
                            <>
                              {analyzed ? (
                                <Btn icon={Pencil} onClick={() => { if (isGlobal && !draftCols) setDraftMeanings((m) => ({ ...m, [lower]: global!.columns })); setAnalyzeTable(t); }} title="Edit — re-open Analyze to change meanings (same as first time)" className="glass-pill glass-pill--neutral">Edit</Btn>
                              ) : (
                                <Btn variant="warn" icon={Search} onClick={() => setAnalyzeTable(t)} title={hasAny ? "Continue analyzing — fill missing meanings" : "Analyze — introspect columns & draft meanings"} className="glass-pill glass-pill--amber">Analyze</Btn>
                              )}
                              <Btn icon={Eye} onClick={() => setDetailTable(t)} title="Details — columns & meanings" className="glass-pill glass-pill--neutral" />
                            </>
                          ) : null}
                        </span>
                      </div>
                    );
                  })}
                  {pickTables.length === 0 && <div className="p-2 text-sm text-slate-400">pick a connection to list its tables…</div>}
                </div>
              </div>
              <div className="mt-1 flex justify-end gap-2">
                <button onClick={() => setShowForm(false)} className="rounded-lg px-4 py-2 text-sm text-slate-500 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:hover:bg-ink-800">cancel</button>
                <Btn variant="primary" icon={Save} onClick={() => void onSave()} className="glass-pill glass-pill--blue">Save</Btn>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
