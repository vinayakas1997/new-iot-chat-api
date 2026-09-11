import { useEffect, useState } from "react";
import { cardApi, api, type Card, type CardTemplate, type Line, type ReapplyResult, type TestResult } from "../lib/api";
import { AlertBanner, StatusChip } from "../components/chips";

/** F3: template library + per-line card copies. Verdict: which cards are live, and on what? */
export function Cards() {
  const [tab, setTab] = useState<"cards" | "templates">("cards");
  const [cards, setCards] = useState<Card[]>([]);
  const [templates, setTemplates] = useState<CardTemplate[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testOut, setTestOut] = useState<Record<string, TestResult>>({});
  const [reapplyOut, setReapplyOut] = useState<ReapplyResult | null>(null);
  const [showTplForm, setShowTplForm] = useState(false);
  const [tplDraft, setTplDraft] = useState({ name: "", description: "", sqlTemplate: "", granularity: "hourly", unit: "", extractHint: "" });
  const [instTpl, setInstTpl] = useState<CardTemplate | null>(null);
  const [instLine, setInstLine] = useState("");
  const [showCardForm, setShowCardForm] = useState(false);
  const [cardDraft, setCardDraft] = useState({ lineId: "", name: "", tables: "", sql: "", granularity: "hourly", unit: "", extractHint: "", threshold: "" });
  const [editCard, setEditCard] = useState<Card | null>(null);

  async function refresh() {
    try {
      const [c, t, l] = await Promise.all([cardApi.listCards(), cardApi.listTemplates(), api.listLines()]);
      setCards(c);
      setTemplates(t);
      setLines(l.filter((x) => x.active));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => void refresh(), []);

  const liveCount = cards.filter((c) => c.status === "live").length;

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onTest(c: Card) {
    setTestingId(c.id);
    setError(null);
    try {
      const r = await cardApi.testCard(c.id);
      setTestOut((m) => ({ ...m, [c.id]: r }));
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      await refresh();
    } finally {
      setTestingId(null);
    }
  }

  function canActivate(c: Card) {
    return c.status === "dormant" && c.sql.trim().length > 0;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">
        <span className="tnum">{liveCount}</span> card{liveCount === 1 ? "" : "s"} live
      </h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-ink-400">
        one context per card · live cards untouchable · dormant cards free to change
      </p>

      {error && <div className="mt-4"><AlertBanner tone="bad" title="Request failed" detail={error} /></div>}

      <div className="mt-6 flex gap-2">
        {(["cards", "templates"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === t ? "bg-accent-500/15 text-accent-500" : "text-slate-500"}`}
          >
            {t === "cards" ? `Cards (${cards.length})` : `Template library (${templates.length})`}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          {tab === "cards"
            ? <button onClick={() => { setEditCard(null); setCardDraft({ lineId: lines[0]?.id ?? "", name: "", tables: "", sql: "", granularity: "hourly", unit: "", extractHint: "", threshold: "" }); setShowCardForm(true); }} className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white">New card</button>
            : <button onClick={() => { setTplDraft({ name: "", description: "", sqlTemplate: "", granularity: "hourly", unit: "", extractHint: "" }); setShowTplForm(true); }} className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white">New template</button>}
        </div>
      </div>

      {tab === "cards" && (
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {cards.map((c) => (
            <div key={c.id} className="rounded-xl border border-slate-200 p-4 dark:border-ink-800">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{c.name}</span>
                <span className="font-mono text-xs text-slate-400">{c.lineId}</span>
                <span className="tnum text-xs text-slate-400">v{c.version}</span>
                <span className="ml-auto"><StatusChip tone={c.status === "live" ? "ok" : "mute"}>{c.status.toUpperCase()}</StatusChip></span>
              </div>
              <div className="mt-1 text-xs text-slate-400">
                {c.granularity}{c.unit ? ` · ${c.unit}` : ""}{c.threshold != null ? ` · warn > ${c.threshold}` : ""} · tables: {c.tables.join(", ") || "—"}
              </div>
              <pre className="mt-2 max-h-28 overflow-auto rounded bg-slate-100 p-2 font-mono text-xs dark:bg-ink-900">{c.sql || "(no SQL yet)"}</pre>
              <div className="mt-1 text-xs">
                {c.lastTest
                  ? <span className={c.lastTest.ok ? "text-state-ok" : "text-state-bad"}>last test {c.lastTest.ok ? "passed" : `failed: ${c.lastTest.error}`} · {new Date(c.lastTest.at).toLocaleTimeString()}</span>
                  : <span className="text-slate-400">never tested — cannot go live</span>}
              </div>
              {testOut[c.id] && (
                <div className="mt-2 overflow-auto rounded border border-slate-200 text-xs dark:border-ink-800">
                  <div className="border-b border-slate-200 px-2 py-1 text-slate-400 dark:border-ink-800">
                    <span className="tnum">{testOut[c.id].rowCount}</span> rows · last 24h window · preview 50
                  </div>
                  <table className="w-full text-left font-mono">
                    <thead><tr>{testOut[c.id].columns.map((x) => <th key={x} className="px-2 py-1">{x}</th>)}</tr></thead>
                    <tbody>
                      {testOut[c.id].rows.map((r, i) => (
                        <tr key={i} className="border-t border-slate-100 dark:border-ink-800">
                          {testOut[c.id].columns.map((x) => <td key={x} className="px-2 py-1">{String(r[x] ?? "")}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                <button onClick={() => void onTest(c)} disabled={testingId === c.id} className="rounded-lg border border-slate-300 px-3 py-1 dark:border-ink-700">
                  {testingId === c.id ? "testing…" : "Test-run"}
                </button>
                {c.status === "dormant" ? (
                  <>
                    <button onClick={() => void act(() => cardApi.activateCard(c.id))} disabled={!canActivate(c)} className="rounded-lg border border-state-ok/50 px-3 py-1 text-state-ok disabled:opacity-40">Go live</button>
                    <button onClick={() => { setEditCard(c); setCardDraft({ lineId: c.lineId, name: c.name, tables: c.tables.join(", "), sql: c.sql, granularity: c.granularity, unit: c.unit, extractHint: c.extractHint, threshold: c.threshold != null ? String(c.threshold) : "" }); setShowCardForm(true); }} className="rounded-lg border border-slate-300 px-3 py-1 dark:border-ink-700">edit</button>
                    <button onClick={() => { if (confirm(`Delete card "${c.name}" on ${c.lineId}?`)) void act(() => cardApi.deleteCard(c.id)); }} className="rounded-lg border border-state-bad/50 px-3 py-1 text-state-bad">delete</button>
                  </>
                ) : (
                  <button onClick={() => void act(() => cardApi.dormantCard(c.id))} className="rounded-lg border border-state-warn/50 px-3 py-1 text-state-warn">take dormant</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {tab === "cards" && cards.length === 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-ink-700">
          <div className="font-semibold">No cards yet</div>
          <p className="mt-1 text-sm text-slate-500">Create a template first, then instantiate it onto a line — or craft a card from scratch.</p>
        </div>
      )}

      {tab === "templates" && (
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {templates.map((t) => (
            <div key={t.id} className="rounded-xl border border-slate-200 p-4 dark:border-ink-800">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{t.name}</span>
                <span className="tnum text-xs text-slate-400">v{t.version}</span>
                <span className="ml-auto text-xs text-slate-400">{t.granularity}{t.unit ? ` · ${t.unit}` : ""}</span>
              </div>
              {t.description && <div className="mt-1 text-sm text-slate-500">{t.description}</div>}
              <pre className="mt-2 max-h-28 overflow-auto rounded bg-slate-100 p-2 font-mono text-xs dark:bg-ink-900">{t.sqlTemplate || "(no SQL template)"}</pre>
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                <button onClick={() => { setInstTpl(t); setInstLine(lines[0]?.id ?? ""); }} className="rounded-lg bg-accent-500 px-3 py-1 font-medium text-white">instantiate → line</button>
                <button onClick={() => { setTplDraft({ name: t.name, description: t.description, sqlTemplate: t.sqlTemplate, granularity: t.granularity, unit: t.unit, extractHint: t.extractHint }); setShowTplForm(true); }} className="rounded-lg border border-slate-300 px-3 py-1 dark:border-ink-700">duplicate</button>
                <button onClick={() => void (async () => {
                  setError(null); setReapplyOut(null);
                  try { setReapplyOut(await cardApi.reapply(t.id, { activate: false })); } catch (e) { setError((e as Error).message); }
                })()} className="rounded-lg border border-slate-300 px-3 py-1 dark:border-ink-700">dry-run re-apply</button>
                <button onClick={() => { if (confirm(`Delete template "${t.name}"? Copies keep working.`)) void act(() => cardApi.deleteTemplate(t.id)); }} className="rounded-lg border border-state-bad/50 px-3 py-1 text-state-bad">delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {reapplyOut && (
        <div className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-ink-800">
          <div className="font-semibold">Re-apply dry-run <span className="tnum font-mono text-xs text-slate-400">{reapplyOut.sqlHash}</span></div>
          {reapplyOut.results.map((r) => (
            <div key={r.cardId} className="mt-1 flex items-center gap-2 text-sm">
              <span className="font-mono">{r.lineId}</span>
              <StatusChip tone={r.status === "green" ? "ok" : r.status === "red" ? "bad" : "mute"}>{r.status}</StatusChip>
              {r.rowCount != null && <span className="tnum text-slate-400">{r.rowCount} rows</span>}
              {r.error && <span className="text-state-bad">{r.error}</span>}
            </div>
          ))}
          <button
            onClick={() => void (async () => {
              setError(null);
              try {
                const tpl = templates.find((t) => t.id === reapplyOut.templateId)!;
                const r = await cardApi.reapply(tpl.id, { activate: true });
                setReapplyOut(r);
                await refresh();
              } catch (e) { setError((e as Error).message); }
            })()}
            className="mt-3 rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white"
          >
            Apply greens live
          </button>
        </div>
      )}

      {showTplForm && (
        <Modal title="New template" onClose={() => setShowTplForm(false)}>
          <Field label="Name"><input value={tplDraft.name} onChange={(e) => setTplDraft({ ...tplDraft, name: e.target.value })} className={inp} /></Field>
          <Field label="Description"><input value={tplDraft.description} onChange={(e) => setTplDraft({ ...tplDraft, description: e.target.value })} className={inp} /></Field>
          <Field label="SQL template ({{from}} / {{to}} for windowed test-runs)"><textarea rows={5} value={tplDraft.sqlTemplate} onChange={(e) => setTplDraft({ ...tplDraft, sqlTemplate: e.target.value })} className={`${inp} font-mono`} /></Field>
          <div className="flex gap-3">
            <Field label="Granularity">
              <select value={tplDraft.granularity} onChange={(e) => setTplDraft({ ...tplDraft, granularity: e.target.value })} className={inp}>
                <option value="hourly">hourly</option><option value="shift">shift</option><option value="daily">daily</option>
              </select>
            </Field>
            <Field label="Unit"><input value={tplDraft.unit} onChange={(e) => setTplDraft({ ...tplDraft, unit: e.target.value })} placeholder="°C, pcs…" className={inp} /></Field>
          </div>
          <Field label="Extraction hint (for the AI extractor)"><textarea rows={2} value={tplDraft.extractHint} onChange={(e) => setTplDraft({ ...tplDraft, extractHint: e.target.value })} className={inp} /></Field>
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setShowTplForm(false)} className="rounded-lg px-4 py-2 text-sm">cancel</button>
            <button onClick={() => void act(() => cardApi.createTemplate(tplDraft).then(() => setShowTplForm(false)))} className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white">Save template</button>
          </div>
        </Modal>
      )}

      {instTpl && (
        <Modal title={`Instantiate "${instTpl.name}"`} onClose={() => setInstTpl(null)}>
          <Field label="Target line">
            <select value={instLine} onChange={(e) => setInstLine(e.target.value)} className={inp}>
              {lines.map((l) => <option key={l.id} value={l.id}>{l.id} — {l.name}</option>)}
            </select>
          </Field>
          <p className="text-sm text-slate-500">Creates an independent dormant copy on the line (tables default to the line's members). Test it, then go live.</p>
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setInstTpl(null)} className="rounded-lg px-4 py-2 text-sm">cancel</button>
            <button onClick={() => void act(() => cardApi.instantiate(instTpl.id, { lineId: instLine }).then(() => { setInstTpl(null); setTab("cards"); }))} className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white">Instantiate dormant</button>
          </div>
        </Modal>
      )}

      {showCardForm && (
        <Modal title={editCard ? `Edit ${editCard.name} (dormant)` : "New card (dormant)"} onClose={() => setShowCardForm(false)}>
          {!editCard && (
            <Field label="Line">
              <select value={cardDraft.lineId} onChange={(e) => setCardDraft({ ...cardDraft, lineId: e.target.value })} className={inp}>
                {lines.map((l) => <option key={l.id} value={l.id}>{l.id} — {l.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Name"><input value={cardDraft.name} onChange={(e) => setCardDraft({ ...cardDraft, name: e.target.value })} className={inp} /></Field>
          <Field label="Tables (comma-separated schema.table, must be line members)"><input value={cardDraft.tables} onChange={(e) => setCardDraft({ ...cardDraft, tables: e.target.value })} className={`${inp} font-mono`} /></Field>
          <Field label="SQL"><textarea rows={5} value={cardDraft.sql} onChange={(e) => setCardDraft({ ...cardDraft, sql: e.target.value })} className={`${inp} font-mono`} /></Field>
          <div className="flex gap-3">
            <Field label="Granularity">
              <select value={cardDraft.granularity} onChange={(e) => setCardDraft({ ...cardDraft, granularity: e.target.value })} className={inp}>
                <option value="hourly">hourly</option><option value="shift">shift</option><option value="daily">daily</option>
              </select>
            </Field>
            <Field label="Unit"><input value={cardDraft.unit} onChange={(e) => setCardDraft({ ...cardDraft, unit: e.target.value })} className={inp} /></Field>
            <Field label="Threshold (optional)"><input value={cardDraft.threshold} onChange={(e) => setCardDraft({ ...cardDraft, threshold: e.target.value })} placeholder="warn above…" className={inp} /></Field>
          </div>
          <Field label="Extraction hint"><textarea rows={2} value={cardDraft.extractHint} onChange={(e) => setCardDraft({ ...cardDraft, extractHint: e.target.value })} className={inp} /></Field>
          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => setShowCardForm(false)} className="rounded-lg px-4 py-2 text-sm">cancel</button>
            <button onClick={() => void act(() => {
              const body = {
                name: cardDraft.name,
                tables: cardDraft.tables.split(",").map((s) => s.trim()).filter(Boolean),
                sql: cardDraft.sql, granularity: cardDraft.granularity,
                unit: cardDraft.unit, extractHint: cardDraft.extractHint,
                threshold: cardDraft.threshold === "" ? null : Number(cardDraft.threshold),
              };
              return (editCard
                ? cardApi.updateCard(editCard.id, body)
                : cardApi.createCard({ lineId: cardDraft.lineId, ...body })
              ).then(() => setShowCardForm(false));
            })} className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white">Save dormant</button>
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
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="max-h-[90vh] w-[36rem] overflow-auto rounded-xl bg-white p-6 dark:bg-ink-900" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">{title}</h2>
        <div className="mt-4 flex flex-col gap-3">{children}</div>
      </div>
    </div>
  );
}
