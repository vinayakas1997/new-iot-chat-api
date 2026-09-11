import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Connection, type Line, type TableRef } from "../lib/api";
import { AlertBanner, StatusChip } from "../components/chips";

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

  async function refresh() {
    try {
      const [l, c] = await Promise.all([api.listLines(), api.listConnections()]);
      setRows(l);
      setConns(c.filter((x) => x.enabled));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => void refresh(), []);

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
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by line, or by table name…"
          className="w-80 rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-ink-700"
        />
        <select
          value={connFilter}
          onChange={(e) => setConnFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-ink-700"
        >
          <option value="">all connections</option>
          {conns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <button onClick={() => openForm()} className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white">
          Register line
        </button>
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
                <td className="py-2.5 pr-4"><span className="font-mono font-medium">{l.id}</span> <span className="text-slate-500">{l.name}</span></td>
                <td className="py-2.5 pr-4 text-slate-500 dark:text-ink-400">{l.connectionLabel}</td>
                <td className="tnum py-2.5 pr-4 text-slate-500 dark:text-ink-400">{l.memberTables.length}</td>
                <td className="py-2.5 pr-4">
                  {l.active ? <StatusChip tone="ok">ingesting</StatusChip> : <StatusChip tone="mute">deregistered</StatusChip>}
                </td>
                <td className="tnum py-2.5 pr-4 text-slate-500 dark:text-ink-400">
                  {l.lastTick ? new Date(l.lastTick).toLocaleString() : "—"}
                </td>
                <td className="py-2.5" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => openForm(l)} className="mr-3 text-accent-500">edit</button>
                  {l.active
                    ? <button onClick={() => void onDeregister(l)} className="text-state-warn">deregister</button>
                    : <button onClick={() => void api.reregisterLine(l.id).then(() => refresh())} className="text-state-ok">re-register</button>}
                </td>
              </tr>
              {openId === l.id && (
                <tr key={`${l.id}-detail`}>
                  <td colSpan={6} className="border-b border-slate-200 bg-slate-50/60 px-4 py-4 dark:border-ink-800 dark:bg-ink-900/50">
                    <div className="text-xs uppercase tracking-wider text-slate-400">member tables · <span className="tnum">{l.memberTables.length}</span></div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {l.memberTables.map((t) => <StatusChip key={t} tone="accent">{t}</StatusChip>)}
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
        <div className="mt-8 rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-ink-700">
          <div className="font-semibold">No lines registered</div>
          <p className="mt-1 text-sm text-slate-500">Register your first production line to let the pipeline ingest for it.</p>
          <button onClick={() => openForm()} className="mt-4 rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white">Register your first line</button>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/60" onClick={() => setShowForm(false)}>
          <div className="max-h-[90vh] w-[32rem] overflow-auto rounded-xl bg-white p-6 dark:bg-ink-900" onClick={(e) => e.stopPropagation()}>
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
                <button onClick={() => setShowForm(false)} className="rounded-lg px-4 py-2 text-sm">cancel</button>
                <button onClick={() => void onSave()} className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
