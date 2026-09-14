import { useEffect, useState } from "react";
import { bankApi, cardApi, type BankPlan, type BankPreview, type Card } from "../lib/api";
import { AlertBanner, StatusChip } from "./chips";

const inp = "mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-ink-700";

type SuggestKind = "entities" | "missions" | "mental-model" | "directives";

function planFromPreview(p: BankPreview): BankPlan {
  const d = p.draft as Partial<BankPlan> | undefined;
  return {
    missions: d?.missions ?? { ...p.missions },
    extractionMode: d?.extractionMode ?? p.extractionMode,
    entityLabels: d?.entityLabels ?? JSON.parse(JSON.stringify(p.entityLabels)) as BankPlan["entityLabels"],
    directives: d?.directives ?? JSON.parse(JSON.stringify(p.directives)) as BankPlan["directives"],
    disposition: d?.disposition ?? { ...p.disposition },
    observations: d?.observations ?? { ...p.observations },
    mentalModel: d?.mentalModel ?? { ...p.mentalModel },
  };
}

/** Push-to-Hindsight preview drawer: review AI-drafted bank config, edit, save draft or push. */
export function PushToHindsight({ lineId, lineName, onClose, onPushed }: {
  lineId: string;
  lineName: string;
  onClose: () => void;
  onPushed: () => void;
}) {
  const [preview, setPreview] = useState<BankPreview | null>(null);
  const [plan, setPlan] = useState<BankPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState<SuggestKind | null>(null);
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [result, setResult] = useState<{ bankId: string; directivesCreated: number; mentalModelOp: string | null; warnings: string[] } | null>(null);
  const [lineCards, setLineCards] = useState<Card[] | null>(null);

  useEffect(() => {
    bankApi.preview(lineId).then((p) => {
      setPreview(p);
      setPlan(planFromPreview(p));
    }).catch((e) => setError((e as Error).message));
    cardApi.listCards().then((all) => setLineCards(all.filter((c) => c.lineId === lineId))).catch(() => setLineCards([]));
  }, [lineId]);

  async function onSuggest(kind: SuggestKind) {
    if (!plan) return;
    setSuggesting(kind);
    setError(null);
    try {
      const r = await bankApi.suggest(lineId, kind);
      const j = r.parsed as Record<string, unknown> | null;
      if (!j) { setError("AI returned non-JSON — try again"); return; }
      if (kind === "entities" && Array.isArray(j.groups)) {
        const groups = (j.groups as Record<string, unknown>[]).map((g) => ({
          key: String(g.key ?? "metric"),
          description: String(g.description ?? ""),
          type: "value" as const,
          values: Array.isArray(g.values) ? (g.values as Record<string, unknown>[]).map((v) => ({ value: String(v.value ?? ""), description: String(v.description ?? "") })).filter((v) => v.value) : [],
          tag: g.tag !== false,
        })).filter((g) => g.key && g.values.length > 0);
        if (groups.length) setPlan({ ...plan, entityLabels: groups });
        else setError("AI returned no usable groups — try again");
      } else if (kind === "missions" && j.retain && j.observations && j.reflect) {
        setPlan({ ...plan, missions: { retain: String(j.retain), observations: String(j.observations), reflect: String(j.reflect) } });
      } else if (kind === "mental-model" && (j.name || j.source_query)) {
        setPlan({ ...plan, mentalModel: { name: String(j.name ?? plan.mentalModel.name), source_query: String(j.source_query ?? plan.mentalModel.source_query) } });
      } else if (kind === "directives" && Array.isArray(j.directives)) {
        const ds = (j.directives as Record<string, unknown>[]).map((d) => ({ name: String(d.name ?? ""), content: String(d.content ?? ""), tags: [] as string[] })).filter((d) => d.name && d.content);
        if (ds.length) setPlan({ ...plan, directives: ds });
        else setError("AI returned no usable directives — try again");
      } else {
        setError("AI returned unexpected shape — try again");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSuggesting(null);
    }
  }

  async function onSaveDraft() {
    if (!plan) return;
    setSaving(true);
    setError(null);
    try {
      await bankApi.saveDraft(lineId, plan);
      onPushed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function onPush() {
    if (!plan) return;
    if (!confirm(`Create/configure bank for "${lineId}" in Hindsight?`)) return;
    setPushing(true);
    setError(null);
    setResult(null);
    try {
      const r = await bankApi.push(lineId, plan);
      setResult(r);
      onPushed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPushing(false);
    }
  }

  function setGroupValues(gi: number, text: string) {
    if (!plan) return;
    const values = text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const i = l.indexOf("|");
      return i < 0 ? { value: l, description: "" } : { value: l.slice(0, i).trim(), description: l.slice(i + 1).trim() };
    }).filter((v) => v.value);
    const groups = plan.entityLabels.map((g, i) => (i === gi ? { ...g, values } : g));
    setPlan({ ...plan, entityLabels: groups });
  }

  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-black/60" onClick={onClose}>
      <div className="max-h-screen w-full max-w-2xl overflow-auto bg-white p-6 dark:bg-ink-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold">Push to Hindsight</h2>
          {preview?.ready && <StatusChip tone="ok">bank ready</StatusChip>}
          {preview?.draftSaved && <StatusChip tone="mute">draft restored</StatusChip>}
          <button onClick={onClose} className="ml-auto rounded-lg px-3 py-1 text-sm">✕ close</button>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Line <span className="font-mono">{lineId}</span> ({lineName}) → bank <span className="font-mono">bank:line-{lineId}</span>.
          Review everything below — nothing is applied until <b>Save &amp; push</b>.
        </p>

        {error && <div className="mt-4"><AlertBanner tone="bad" title="Request failed" detail={error} /></div>}
        {!preview && !error && <div className="mt-6 text-sm text-slate-400">loading preview…</div>}

        {result && (
          <div className="mt-4 rounded-xl border border-state-ok/50 p-4 text-sm">
            <div className="font-semibold text-state-ok">Pushed: <span className="font-mono">{result.bankId}</span></div>
            <div className="mt-1 text-slate-500">{result.directivesCreated} directive(s) created · mental-model op: <span className="font-mono">{result.mentalModelOp ?? "—"}</span></div>
            {result.warnings.map((w) => <div key={w} className="mt-1 text-state-warn">{w}</div>)}
          </div>
        )}

        {plan && preview && (
          <div className="mt-4 flex flex-col gap-5">
            {!preview.hindsightConfigured && (
              <AlertBanner tone="bad" title="Hindsight not configured" detail="Set the Hindsight URL in AI Services before pushing." />
            )}

            <div className="text-xs uppercase tracking-widest text-slate-400">
              source columns · {preview.tables.map((t) => t.table).join(", ") || "—"}
            </div>

            <div className="rounded-lg bg-slate-100 p-2 text-xs dark:bg-ink-800">
              <span className="uppercase tracking-widest text-slate-400">cards feeding this bank · </span>
              {lineCards === null && <span className="text-slate-400">loading…</span>}
              {lineCards !== null && lineCards.length === 0 && <span className="text-slate-400">none yet</span>}
              {lineCards !== null && lineCards.map((c) => (
                <span key={c.id} className="mr-2 inline-flex items-center gap-1">
                  <span className="font-medium">{c.name}</span>
                  <span className="tnum text-slate-400">v{c.version}</span>
                  <StatusChip tone={c.status === "live" ? "ok" : "mute"}>{c.status}</StatusChip>
                  {c.lastTest
                    ? <span className={c.lastTest.ok ? "text-state-ok" : "text-state-bad"}>{c.lastTest.ok ? "green" : "red"}</span>
                    : <span className="text-slate-400">untested</span>}
                </span>
              ))}
            </div>

            <section>
              <div className="mb-1 flex items-center">
                <span className="text-sm font-semibold">Missions (prompts)</span>
                <button onClick={() => void onSuggest("missions")} disabled={suggesting === "missions"} className="ml-auto text-xs text-accent-500 disabled:opacity-50">
                  {suggesting === "missions" ? "drafting…" : "↻ Re-suggest with AI"}
                </button>
              </div>
              {(["retain", "observations", "reflect"] as const).map((k) => (
                <label key={k} className="mt-2 block text-sm capitalize">{k}
                  <textarea rows={2} value={plan.missions[k]} onChange={(e) => setPlan({ ...plan, missions: { ...plan.missions, [k]: e.target.value } })} className={inp} />
                </label>
              ))}
              <label className="mt-2 block text-sm">Extraction mode
                <select value={plan.extractionMode} onChange={(e) => setPlan({ ...plan, extractionMode: e.target.value as "concise" | "verbose" })} className={inp}>
                  <option value="concise">concise — only facts worth remembering</option>
                  <option value="verbose">verbose — more detail, more tokens</option>
                </select>
              </label>
            </section>

            <section>
              <div className="mb-1 flex items-center">
                <span className="text-sm font-semibold">LLM entities (controlled vocabulary)</span>
                <button onClick={() => void onSuggest("entities")} disabled={suggesting === "entities"} className="ml-auto text-xs text-accent-500 disabled:opacity-50">
                  {suggesting === "entities" ? "drafting…" : "↻ Re-suggest with AI"}
                </button>
              </div>
              {plan.entityLabels.map((g, gi) => (
                <div key={gi} className="mt-2 rounded-lg border border-slate-200 p-2 dark:border-ink-700">
                  <div className="flex gap-2">
                    <input value={g.key} onChange={(e) => setPlan({ ...plan, entityLabels: plan.entityLabels.map((x, i) => (i === gi ? { ...x, key: e.target.value } : x)) })} placeholder="group key" className="w-32 rounded border border-slate-300 bg-transparent px-2 py-1 font-mono text-xs dark:border-ink-700" />
                    <input value={g.description} onChange={(e) => setPlan({ ...plan, entityLabels: plan.entityLabels.map((x, i) => (i === gi ? { ...x, description: e.target.value } : x)) })} placeholder="what this dimension means" className="flex-1 rounded border border-slate-300 bg-transparent px-2 py-1 text-xs dark:border-ink-700" />
                    <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={g.tag} onChange={(e) => setPlan({ ...plan, entityLabels: plan.entityLabels.map((x, i) => (i === gi ? { ...x, tag: e.target.checked } : x)) })} className="accent-teal-500" /> tag</label>
                    <button onClick={() => setPlan({ ...plan, entityLabels: plan.entityLabels.filter((_, i) => i !== gi) })} className="text-xs text-state-bad">remove</button>
                  </div>
                  <textarea
                    rows={Math.max(2, g.values.length + 1)}
                    value={g.values.map((v) => (v.description ? `${v.value} | ${v.description}` : v.value)).join("\n")}
                    onChange={(e) => setGroupValues(gi, e.target.value)}
                    placeholder={"one per line: value | description"}
                    className="mt-1 w-full rounded border border-slate-300 bg-transparent px-2 py-1 font-mono text-xs dark:border-ink-700"
                  />
                </div>
              ))}
              <button onClick={() => setPlan({ ...plan, entityLabels: [...plan.entityLabels, { key: "", description: "", type: "value", values: [], tag: true }] })} className="mt-1 text-xs text-accent-500">+ add group</button>
            </section>

            <section>
              <div className="mb-1 flex items-center">
                <span className="text-sm font-semibold">Directives (hard rules)</span>
                <button onClick={() => void onSuggest("directives")} disabled={suggesting === "directives"} className="ml-auto text-xs text-accent-500 disabled:opacity-50">
                  {suggesting === "directives" ? "drafting…" : "↻ Re-suggest with AI"}
                </button>
              </div>
              {plan.directives.map((d, i) => (
                <div key={i} className="mt-2 rounded-lg border border-slate-200 p-2 dark:border-ink-700">
                  <div className="flex gap-2">
                    <input value={d.name} onChange={(e) => setPlan({ ...plan, directives: plan.directives.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} placeholder="rule name" className="w-44 rounded border border-slate-300 bg-transparent px-2 py-1 text-xs dark:border-ink-700" />
                    <button onClick={() => setPlan({ ...plan, directives: plan.directives.filter((_, j) => j !== i) })} className="ml-auto text-xs text-state-bad">remove</button>
                  </div>
                  <textarea rows={2} value={d.content} onChange={(e) => setPlan({ ...plan, directives: plan.directives.map((x, j) => (j === i ? { ...x, content: e.target.value } : x)) })} placeholder="rule text" className="mt-1 w-full rounded border border-slate-300 bg-transparent px-2 py-1 text-xs dark:border-ink-700" />
                </div>
              ))}
              <button onClick={() => setPlan({ ...plan, directives: [...plan.directives, { name: "", content: "", tags: [] }] })} className="mt-1 text-xs text-accent-500">+ add directive</button>
            </section>

            <section>
              <div className="mb-1 flex items-center">
                <span className="text-sm font-semibold">Mental-model seed</span>
                <button onClick={() => void onSuggest("mental-model")} disabled={suggesting === "mental-model"} className="ml-auto text-xs text-accent-500 disabled:opacity-50">
                  {suggesting === "mental-model" ? "drafting…" : "↻ Re-suggest with AI"}
                </button>
              </div>
              <label className="block text-sm">Name<input value={plan.mentalModel.name} onChange={(e) => setPlan({ ...plan, mentalModel: { ...plan.mentalModel, name: e.target.value } })} className={inp} /></label>
              <label className="mt-2 block text-sm">Source question<textarea rows={2} value={plan.mentalModel.source_query} onChange={(e) => setPlan({ ...plan, mentalModel: { ...plan.mentalModel, source_query: e.target.value } })} className={inp} /></label>
            </section>

            <section className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={plan.observations.enabled} onChange={(e) => setPlan({ ...plan, observations: { ...plan.observations, enabled: e.target.checked } })} className="accent-teal-500" /> observations</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={plan.observations.autoConsolidate} onChange={(e) => setPlan({ ...plan, observations: { ...plan.observations, autoConsolidate: e.target.checked } })} className="accent-teal-500" /> auto-consolidate</label>
              {(["skepticism", "literalism", "empathy"] as const).map((k) => (
                <label key={k} className="flex items-center gap-2 capitalize">{k}
                  <select value={plan.disposition[k]} onChange={(e) => setPlan({ ...plan, disposition: { ...plan.disposition, [k]: Number(e.target.value) } })} className="rounded border border-slate-300 bg-transparent px-2 py-1 dark:border-ink-700">
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
              ))}
            </section>

            <div className="flex justify-end gap-2 pb-4">
              <button onClick={onSaveDraft} disabled={saving} className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-ink-700 disabled:opacity-50">
                {saving ? "saving…" : "Save draft"}
              </button>
              <button onClick={() => void onPush()} disabled={pushing || !preview.hindsightConfigured} title={preview.hindsightConfigured ? "Create/configure the bank in Hindsight" : "Set the Hindsight URL in AI Services first"} className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                {pushing ? "pushing…" : preview.ready ? "Save & re-push" : "Save & push"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
