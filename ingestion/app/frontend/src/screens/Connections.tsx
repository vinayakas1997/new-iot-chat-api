import { useEffect, useState } from "react";
import { Activity, Database, FlaskConical, Pencil, Plus, Save, Search, Trash2 } from "lucide-react";
import { api, type Connection, type TableDetail, type TableRef } from "../lib/api";
import { AlertBanner, StatusChip } from "../components/chips";
import { Btn, EmptyState } from "../components/ui";

type Draft = {
  label: string;
  type: "postgres" | "mysql";
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
};

const EMPTY: Draft = { label: "", type: "postgres", host: "", port: "", database: "", username: "", password: "" };

function healthOf(c: Connection): { tone: "ok" | "bad" | "mute"; text: string } {
  if (!c.enabled) return { tone: "mute", text: "disabled" };
  if (!c.lastCheck) return { tone: "mute", text: "never checked" };
  return c.lastCheck.ok
    ? { tone: "ok", text: `${c.lastCheck.tableCount ?? "?"} tables` }
    : { tone: "bad", text: "failing" };
}

/** F1: table-first registry (Stripe pattern). Verdict top-left: connections healthy? */
export function Connections() {
  const [rows, setRows] = useState<Connection[]>([]);
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Connection | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tables, setTables] = useState<TableRef[] | null>(null);
  const [detail, setDetail] = useState<TableDetail | null>(null);
  const [detailKey, setDetailKey] = useState("");

  async function refresh() {
    try {
      setRows(await api.listConnections());
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => void refresh(), []);

  const failing = rows.filter((c) => c.enabled && c.lastCheck && !c.lastCheck.ok);
  const filtered = rows.filter((c) =>
    `${c.label} ${c.host} ${c.database}`.toLowerCase().includes(q.toLowerCase())
  );

  function openForm(c?: Connection) {
    setEditing(c ?? null);
    setDraft(
      c
        ? { label: c.label, type: c.type, host: c.host, port: String(c.port), database: c.database, username: c.username, password: "" }
        : EMPTY
    );
    setTestMsg(null);
    setShowForm(true);
  }

  async function onTest() {
    setTesting(true);
    setTestMsg(null);
    try {
      const payload = editing ? { id: editing.id } : { ...draft, port: draft.port ? Number(draft.port) : undefined };
      const r = await api.testConnection(payload);
      setTestMsg(`OK · ${r.latencyMs} ms · ${r.tableCount} tables`);
    } catch (e) {
      setTestMsg(`FAILED · ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  }

  async function onSave() {
    setError(null);
    try {
      const body = { ...draft, port: draft.port ? Number(draft.port) : undefined };
      if (editing) {
        const patch = { ...body };
        if (!patch.password) delete (patch as Record<string, unknown>).password;
        await api.updateConnection(editing.id, patch);
      } else {
        await api.createConnection(body);
      }
      setShowForm(false);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onDelete(c: Connection) {
    if (!confirm(`Delete connection "${c.label}"? Lines bound to it would lose their source.`)) return;
    await api.deleteConnection(c.id);
    if (openId === c.id) setOpenId(null);
    await refresh();
  }

  async function onCheck(c: Connection) {
    setCheckingId(c.id);
    setError(null);
    try {
      await api.testConnection({ id: c.id });
      await refresh();
    } catch (e) {
      await refresh();
      setError((e as Error).message);
    } finally {
      setCheckingId(null);
    }
  }

  async function openRow(c: Connection) {
    if (openId === c.id) {
      setOpenId(null);
      return;
    }
    setOpenId(c.id);
    setTables(null);
    setDetail(null);
    try {
      const r = await api.listTables(c.id);
      setTables(r.tables);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function openTable(c: Connection, t: TableRef) {
    const key = `${t.schema}.${t.name}`;
    setDetailKey(key);
    setDetail(null);
    try {
      setDetail(await api.describeTable(c.id, t.schema, t.name));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">
        {failing.length === 0 ? "All connections healthy" : `${failing.length} connection${failing.length > 1 ? "s" : ""} failing`}
      </h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-ink-400">
        <span className="tnum font-semibold text-slate-800 dark:text-ink-100">{rows.length}</span> connections · poller watches continuously
      </p>

      {failing.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          {failing.map((c) => (
            <AlertBanner key={c.id} tone="bad" title={`${c.label} is failing`} detail={c.lastCheck?.error ?? undefined} />
          ))}
        </div>
      )}
      {error && (
        <div className="mt-4">
          <AlertBanner tone="bad" title="Request failed" detail={error} />
        </div>
      )}

      <div className="mt-6 flex items-center gap-3">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, host, database…"
            className="w-80 rounded-lg border border-slate-300 bg-transparent py-2 pl-9 pr-3 text-sm focus:border-accent-500 focus:outline-none dark:border-ink-700"
          />
        </div>
        <Btn variant="primary" icon={Plus} onClick={() => openForm()} className="glass-pill glass-pill--blue">
          Add connection
        </Btn>
      </div>

      <table className="mt-4 w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-400 dark:border-ink-800 dark:text-ink-600">
            <th className="py-2 pr-4">Label</th>
            <th className="py-2 pr-4">Type</th>
            <th className="py-2 pr-4">Host</th>
            <th className="py-2 pr-4">Database</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4">Last check</th>
            <th className="py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((c) => {
            const h = healthOf(c);
            const open = openId === c.id;
            return (
              <>
                <tr
                  key={c.id}
                  onClick={() => void openRow(c)}
                  className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 dark:border-ink-800 dark:hover:bg-ink-900 ${open ? "bg-slate-50 dark:bg-ink-900" : ""}`}
                >
                  <td className="py-2.5 pr-4 font-medium">{c.label}</td>
                  <td className="py-2.5 pr-4 text-slate-500 dark:text-ink-400">{c.type}</td>
                  <td className="py-2.5 pr-4 text-slate-500 dark:text-ink-400">{c.host}:{c.port}</td>
                  <td className="py-2.5 pr-4 text-slate-500 dark:text-ink-400">{c.database}</td>
                  <td className="py-2.5 pr-4"><StatusChip tone={h.tone}>{h.text}</StatusChip></td>
                  <td className="tnum py-2.5 pr-4 text-slate-500 dark:text-ink-400">
                    {c.lastCheck ? new Date(c.lastCheck.at).toLocaleTimeString() : "—"}
                  </td>
                  <td className="py-2.5" onClick={(e) => e.stopPropagation()}>
                    <span className="mr-2 inline-flex">
                      <Btn
                        variant="ghost"
                        icon={Activity}
                        onClick={() => void onCheck(c)}
                        disabled={checkingId === c.id}
                        loading={checkingId === c.id}
                        title="Probe now and update status immediately (no wait for poller)"
                      >
                        {checkingId === c.id ? "checking…" : "check"}
                      </Btn>
                    </span>
                    <span className="mr-2 inline-flex"><Btn variant="ghost" icon={Pencil} onClick={() => openForm(c)}>edit</Btn></span>
                    <Btn variant="ghostBad" icon={Trash2} onClick={() => void onDelete(c)} className="glass-pill glass-pill--bad">delete</Btn>
                  </td>
                </tr>
                {open && (
                  <tr key={`${c.id}-detail`}>
                    <td colSpan={7} className="border-b border-slate-200 bg-slate-50/60 px-4 py-4 dark:border-ink-800 dark:bg-ink-900/50">
                      {!tables && <div className="text-sm text-slate-400">loading tables…</div>}
                      {tables && tables.length === 0 && <div className="text-sm text-slate-400">no tables found</div>}
                      {tables && tables.length > 0 && (
                        <div className="flex gap-6">
                          <div className="w-64 shrink-0">
                            <div className="mb-2 text-xs uppercase tracking-wider text-slate-400">tables · <span className="tnum">{tables.length}</span></div>
                            <div className="flex max-h-72 flex-col gap-1 overflow-auto">
                              {tables.map((t) => (
                                <button
                                  key={`${t.schema}.${t.name}`}
                                  onClick={() => void openTable(c, t)}
                                  className={`rounded px-2 py-1 text-left text-sm ${detailKey === `${t.schema}.${t.name}` ? "bg-accent-500/15 text-accent-500" : "hover:bg-slate-200/60 dark:hover:bg-ink-800"}`}
                                >
                                  <span className="text-slate-400">{t.schema}.</span>{t.name}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="min-w-0 flex-1">
                            {!detail && detailKey && <div className="text-sm text-slate-400">loading…</div>}
                            {detail && (
                              <div>
                                <div className="font-semibold">{detail.schema}.{detail.name} <span className="tnum ml-2 text-sm font-normal text-slate-400">{detail.rowCount ?? "?"} rows</span></div>
                                {detail.primaryKey.length > 0 && <div className="mt-1 text-xs text-slate-400">PK: {detail.primaryKey.join(", ")}</div>}
                                <table className="mt-2 w-full text-left text-sm">
                                  <thead><tr className="text-xs text-slate-400"><th className="py-1 pr-4">column</th><th className="py-1 pr-4">type</th><th className="py-1">null</th></tr></thead>
                                  <tbody>
                                    {detail.columns.map((col) => (
                                      <tr key={col.name} className="border-t border-slate-100 dark:border-ink-800">
                                        <td className="py-1 pr-4 font-mono text-xs">{col.name}</td>
                                        <td className="py-1 pr-4 text-slate-500 dark:text-ink-400">{col.type}</td>
                                        <td className="py-1 text-slate-500">{col.nullable ? "yes" : "no"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                <div className="mb-1 mt-3 text-xs uppercase tracking-wider text-slate-400">sample · 20 rows max</div>
                                <div className="overflow-auto rounded border border-slate-200 dark:border-ink-800">
                                  <table className="w-full text-left font-mono text-xs">
                                    <thead><tr>{detail.sample.columns.map((x) => <th key={x} className="border-b border-slate-200 px-2 py-1 dark:border-ink-800">{x}</th>)}</tr></thead>
                                    <tbody>
                                      {detail.sample.rows.map((r, i) => (
                                        <tr key={i} className="border-t border-slate-100 dark:border-ink-800">
                                          {detail.sample.columns.map((x) => <td key={x} className="px-2 py-1">{String(r[x] ?? "")}</td>)}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
      {filtered.length === 0 && (
        <EmptyState
          icon={Database}
          title="No connections yet"
          body="Add your first plant database to let the pipeline read from it."
          action={<Btn variant="primary" icon={Plus} onClick={() => openForm()} className="glass-pill glass-pill--blue">Add your first connection</Btn>}
        />
      )}

      {showForm && (
        <div className="anim-fade-in fixed inset-0 flex items-center justify-center bg-black/60" onClick={() => setShowForm(false)}>
          <div className="anim-pop-in w-[28rem] rounded-xl bg-white p-6 dark:bg-ink-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold">{editing ? "Edit connection" : "Add connection"}</h2>
            <div className="mt-4 flex flex-col gap-3">
              <label className="text-sm">Label<input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-ink-700" /></label>
              <div className="flex gap-3">
                <label className="flex-1 text-sm">Type
                  <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as Draft["type"] })} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-ink-700">
                    <option value="postgres">postgres</option>
                    <option value="mysql">mysql</option>
                  </select>
                </label>
                <label className="flex-1 text-sm">Host<input value={draft.host} onChange={(e) => setDraft({ ...draft, host: e.target.value })} placeholder="db.plant.local" className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-ink-700" /></label>
                <label className="w-24 text-sm">Port<input value={draft.port} onChange={(e) => setDraft({ ...draft, port: e.target.value })} placeholder="auto" className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-ink-700" /></label>
              </div>
              <label className="text-sm">Database<input value={draft.database} onChange={(e) => setDraft({ ...draft, database: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-ink-700" /></label>
              <div className="flex gap-3">
                <label className="flex-1 text-sm">Username<input value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-ink-700" /></label>
                <label className="flex-1 text-sm">Password<input type="password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} placeholder={editing ? "(unchanged)" : ""} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-ink-700" /></label>
              </div>
              {testMsg && <div className={`text-sm ${testMsg.startsWith("OK") ? "text-state-ok" : "text-state-bad"}`}>{testMsg}</div>}
              <div className="mt-1 flex justify-between">
                <Btn icon={FlaskConical} onClick={() => void onTest()} loading={testing} disabled={testing} className="glass-pill glass-pill--neutral">
                  {testing ? "testing…" : "Test (no save)"}
                </Btn>
                <div className="flex gap-2">
                  <button onClick={() => setShowForm(false)} className="rounded-lg px-4 py-2 text-sm glass-pill glass-pill--close">cancel</button>
                  <Btn variant="primary" icon={Save} onClick={() => void onSave()} className="glass-pill glass-pill--blue">Save</Btn>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
