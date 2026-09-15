import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Brain, Eye, Layers, Pencil, Pause, Play, Plus, Save, Search } from "lucide-react";
import { api, bankApi, cardApi, type BankOverviewEntry, type Connection, type Line, type TableRef } from "../lib/api";
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
        await api.createLine(draft);
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
        <Btn variant="primary" icon={Plus} onClick={() => openForm()}>
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
                      return <span className="mr-2 inline-flex"><Btn variant="ghost" icon={Brain} onClick={() => setPushLine(l)} title={`bank:line-${l.id} ready — reopen to review or re-push`} className="!text-state-ok">bank ✓</Btn></span>;
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
                    ? <Btn variant="ghost" icon={Pause} onClick={() => void onDeregister(l)} className="!text-state-warn">deregister</Btn>
                    : <Btn variant="ghost" icon={Play} onClick={() => void api.reregisterLine(l.id).then(() => refresh())} className="!text-state-ok">re-register</Btn>}
                </td>
              </tr>
              {openId === l.id && (
                <tr key={`${l.id}-detail`}>
                  <td colSpan={6} className="border-b border-slate-200 bg-slate-50/60 px-4 py-4 dark:border-ink-800 dark:bg-ink-900/50">
                    <div className="text-xs uppercase tracking-wider text-slate-400">member tables · <span className="tnum">{l.memberTables.length}</span></div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {l.memberTables.map((t) => <StatusChip key={t} tone="accent"><FormattedText text={t} highlightTables /></StatusChip>)}
                      {l.memberTables.length === 0 && <span className="text-sm text-slate-400">none — this line ingests nothing until tables are assigned</span>}
                    </div>
                    <Link to={`/setter/history?line=${l.id}`} className="mt-3 inline-block text-sm text-accent-500">view history →</Link>
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
          action={<Btn variant="primary" icon={Plus} onClick={() => openForm()}>Register your first line</Btn>}
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
                    return (
                      <label key={key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-100 dark:hover:bg-ink-800">
                        <input type="checkbox" checked={draft.memberTables.includes(key)} onChange={() => toggleTable(key)} className="accent-teal-500" />
                        <span className="text-slate-400">{t.schema}.</span>{t.name}
                      </label>
                    );
                  })}
                  {pickTables.length === 0 && <div className="p-2 text-sm text-slate-400">pick a connection to list its tables…</div>}
                </div>
              </div>
              <div className="mt-1 flex justify-end gap-2">
                <button onClick={() => setShowForm(false)} className="rounded-lg px-4 py-2 text-sm text-slate-500 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:hover:bg-ink-800">cancel</button>
                <Btn variant="primary" icon={Save} onClick={() => void onSave()}>Save</Btn>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
