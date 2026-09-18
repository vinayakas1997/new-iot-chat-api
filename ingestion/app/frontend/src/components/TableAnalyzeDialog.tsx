import { useEffect, useRef, useState } from "react";
import { Download, Eye, FileUp, HelpCircle, Save, Search, Sparkles, BookmarkPlus } from "lucide-react";
import { api, columnTemplateApi } from "../lib/api";
import { AlertBanner, StatusChip } from "./chips";
import { Btn, Spinner } from "./ui";

type Mode = "view" | "edit";

interface Col {
  name: string;
  type: string;
  nullable: boolean;
  description?: string;
  meaning: string;
  datatype: string;
  sampleValues?: string[];
}

export function TableAnalyzeDialog({ mode, lineId, schema, table, connectionId, initialMeanings, onClose, onSaved, onSaveDraft }: {
  mode: Mode;
  lineId: string;
  schema: string;
  table: string;
  /** For draft (line not yet created) — connection-scoped analyze, no DB persistence */
  connectionId?: string;
  initialMeanings?: Record<string, string>;
  onClose: () => void;
  onSaved?: () => void;
  onSaveDraft?: (cols: { name: string; meaning: string; datatype: string }[]) => void;
}) {
  const [cols, setCols] = useState<Col[] | null>(null);
  const [sample, setSample] = useState<{ columns: string[]; rows: Record<string, unknown>[] } | null>(null);
  const [analyzed, setAnalyzed] = useState<{ total: number; filled: number; analyzed: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [filling, setFilling] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [templates, setTemplates] = useState<{ id: string; name: string; columns: { name: string; meaning: string; datatype: string }[] }[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateStatus, setTemplateStatus] = useState<string | null>(null);
  const [activeSample, setActiveSample] = useState<Col | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [fillingCol, setFillingCol] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isDraft = !lineId && !!connectionId;
  const isNew = !lineId && !connectionId;
  const tableKey = `${schema}.${table}`;

  async function load(editDraft = false) {
    if (isNew) { setLoading(false); setError("Save the line first — column meanings are stored per line. Create the line, then Analyze."); return; }
    setLoading(true); setError(null);
    try {
      let r: { columns: Col[]; sample: { columns: string[]; rows: Record<string, unknown>[] }; analyzed: { total: number; filled: number; analyzed: boolean } };
      if (isDraft) {
        const dr = await api.analyzeTableDraft(connectionId!, schema, table);
        if (initialMeanings) {
          dr.columns = dr.columns.map((c) => initialMeanings[c.name.toLowerCase()] != null ? { ...c, meaning: initialMeanings[c.name.toLowerCase()]! } : c);
          dr.analyzed = { total: dr.columns.length, filled: dr.columns.filter((c) => c.meaning.trim()).length, analyzed: dr.columns.length > 0 && dr.columns.every((c) => c.meaning.trim()) };
        }
        r = dr as unknown as typeof r;
      } else {
        r = editDraft
          ? await api.analyzeTable(lineId, schema, table)
          : await api.tableColumns(lineId, schema, table);
      }
      setCols(r.columns as Col[]);
      setSample(r.sample);
      setAnalyzed(r.analyzed);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(mode === "edit"); }, [lineId, schema, table, mode]);
  useEffect(() => { if (mode === "edit") columnTemplateApi.list().then(setTemplates).catch(() => {}); }, [mode]);

  const emptyCount = cols ? cols.filter((c) => !c.meaning.trim()).length : 0;

  function setMeaning(name: string, meaning: string) {
    setCols((prev) => prev ? prev.map((c) => c.name === name ? { ...c, meaning } : c) : prev);
  }

  async function onLlmFill() {
    if (!cols || isNew) return;
    const empties = cols.filter((c) => !c.meaning.trim()).map((c) => c.name);
    if (empties.length === 0) return;
    setFilling(true); setError(null);
    try {
      const r = isDraft
        ? await api.llmFillTableDraft(connectionId!, schema, table, empties)
        : await api.llmFillTable(lineId, schema, table, empties);
      const byName = new Map(r.drafted.map((d) => [d.name.toLowerCase(), d.meaning]));
      setCols((prev) => prev ? prev.map((c) => byName.has(c.name.toLowerCase()) ? { ...c, meaning: byName.get(c.name.toLowerCase())! } : c) : prev);
      if (r.drafted.length === 0) setError("LLM returned no drafts — check AI Services or fill manually.");
    } catch (e) { setError((e as Error).message); }
    finally { setFilling(false); }
  }

  async function onLlmFillOne(colName: string) {
    if (!cols || isNew) return;
    setFillingCol(colName); setError(null);
    try {
      const r = isDraft
        ? await api.llmFillTableDraft(connectionId!, schema, table, [colName])
        : await api.llmFillTable(lineId, schema, table, [colName]);
      const byName = new Map(r.drafted.map((d) => [d.name.toLowerCase(), d.meaning]));
      setCols((prev) => prev ? prev.map((c) => byName.has(c.name.toLowerCase()) ? { ...c, meaning: byName.get(c.name.toLowerCase())! } : c) : prev);
      if (r.drafted.length === 0) setError(`LLM returned no draft for ${colName}`);
    } catch (e) { setError((e as Error).message); }
    finally { setFillingCol(null); }
  }

  async function onAnalyze() {
    setAnalyzing(true); setError(null);
    try {
      const r = isDraft
        ? await api.analyzeTableDraft(connectionId!, schema, table)
        : await api.analyzeTable(lineId, schema, table);
      let cols2 = r.columns as Col[];
      if (isDraft && initialMeanings) {
        cols2 = cols2.map((c) => initialMeanings[c.name.toLowerCase()] != null ? { ...c, meaning: initialMeanings[c.name.toLowerCase()]! } : c);
      }
      setCols(cols2);
      setSample(r.sample);
      if (isDraft) {
        const filled = cols2.filter((c) => c.meaning.trim()).length;
        setAnalyzed({ total: cols2.length, filled, analyzed: cols2.length > 0 && filled === cols2.length });
      } else setAnalyzed(r.analyzed);
    } catch (e) { setError((e as Error).message); }
    finally { setAnalyzing(false); }
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f || !cols) return;
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) return;
      const start = lines[0]?.toLowerCase().startsWith("name,") || lines[0]?.toLowerCase().startsWith("column,") ? 1 : 0;
      const byName = new Map<string, string>();
      const positional: string[] = [];
      let hasNamed = false;
      const colNames = new Set(cols.map((c) => c.name.toLowerCase()));
      for (let i = start; i < lines.length; i++) {
        const idx = lines[i].indexOf(",");
        if (idx === -1) {
          positional.push(lines[i].replace(/^"|"$/g, "").trim());
          continue;
        }
        const left = lines[i].slice(0, idx).trim().replace(/^"|"$/g, "");
        const right = lines[i].slice(idx + 1).trim().replace(/^"|"$/g, "");
        if (colNames.has(left.toLowerCase())) {
          byName.set(left.toLowerCase(), right);
          hasNamed = true;
        } else {
          positional.push(right);
        }
      }
      if (hasNamed) {
        setCols((prev) => prev ? prev.map((c) => byName.has(c.name.toLowerCase()) ? { ...c, meaning: byName.get(c.name.toLowerCase())! } : c) : prev);
      } else if (positional.length > 0) {
        setCols((prev) => prev ? prev.map((c, i) => i < positional.length && positional[i] ? { ...c, meaning: positional[i] } : c) : prev);
      }
      if (fileRef.current) fileRef.current.value = "";
    };
    reader.onerror = () => setError("Failed to read defs file");
    reader.readAsText(f);
  }

  function onDownloadDefs() {
    if (!cols) return;
    const header = "name,meaning";
    const esc = (s: string) => s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    const csv = [header, ...cols.map((c) => `${esc(c.name)},${esc(c.meaning || "")}`)].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${table}_defs.csv`; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function onDownloadReference() {
    if (!cols) return;
    const header = "name,meaning";
    const csv = [header, ...cols.map((c) => `${c.name},`)].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${table}_reference.csv`; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  async function onSave() {
    if (!cols || isNew) return;
    if (isDraft) {
      onSaveDraft?.(cols.map((c) => ({ name: c.name, meaning: c.meaning, datatype: c.type })));
      onClose();
      return;
    }
    setSaving(true); setError(null);
    try {
      await api.saveTableColumns(lineId, schema, table, cols.map((c) => ({ name: c.name, meaning: c.meaning, datatype: c.type })));
      onSaved?.();
      onClose();
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <div className="anim-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm md:p-6" onClick={() => { setShowHelp(false); onClose(); }}>
      <div className="anim-pop-in flex max-h-[85vh] w-[78vw] max-w-[78vw] flex-col overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-2xl dark:border-ink-700 dark:bg-ink-900" onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 border-b border-slate-200 px-6 py-4 dark:border-ink-800">
          <div className="flex items-center justify-between">
            <h2 className="text-[17px] font-bold tracking-tight text-ink-900 dark:text-ink-100">{mode === "edit" ? "Analyze" : "Details"} — {tableKey}</h2>
            <button onClick={onClose} className="rounded-lg px-3 py-1 text-sm glass-pill glass-pill--close">close</button>
          </div>
          {analyzed && (
            <div className="mt-1 flex items-center gap-2 text-xs">
              <StatusChip tone={analyzed.analyzed ? "ok" : "mute"}>{analyzed.analyzed ? "Analyzed" : `${analyzed.filled}/${analyzed.total} meanings`}</StatusChip>
              {sample && <span className="text-slate-400">{sample.rows.length} sample rows · {cols?.length ?? 0} cols</span>}
              {fileName && <span className="text-slate-400">· {fileName}</span>}
            </div>
          )}
          {error && <div className="mt-3"><AlertBanner tone="bad" title="Request failed" detail={error} /></div>}
          {loading && <div className="mt-3 flex items-center gap-2 text-sm text-slate-400"><Spinner /> Loading columns…</div>}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {!loading && cols && (
            <>
              {mode === "edit" && (
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={onPickFile} />
                  <span className="flex flex-col items-start gap-0.5">
                    <Btn size="sm" icon={FileUp} onClick={() => fileRef.current?.click()} title="Upload CSV: name,meaning (header required — see help below)" className="glass-pill glass-pill--blue">Upload defs file</Btn>
                    <button onClick={() => setShowHelp((v) => !v)} title="How to format defs file" className="inline-flex items-center gap-1 text-[11px] font-medium leading-none text-state-warn hover:text-amber-600 dark:text-amber-400">
                      <HelpCircle size={11} className="shrink-0" /> help
                    </button>
                  </span>
                  <span className="relative">
                    {showHelp && (
                      <div className="absolute left-0 top-8 z-20 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-ink-700 dark:bg-ink-900" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-ink-900 dark:text-ink-100">Defs file format</span>
                          <button onClick={() => setShowHelp(false)} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-ink-200">✕</button>
                        </div>
                        <p className="mt-1 text-[11.5px] leading-snug text-slate-500 dark:text-ink-400">Header must be <span className="font-mono font-semibold text-ink-700 dark:text-ink-200">name,meaning</span>. One row per column, any order — matched by name.</p>
                        <div className="mt-2 rounded-lg bg-slate-50 p-2 font-mono text-[11px] dark:bg-ink-800">
                          <div className="text-slate-400">name,meaning</div>
                          <div>ts,Event timestamp UTC</div>
                          <div>temp_c,Temperature °C</div>
                        </div>
                        <Btn size="sm" icon={Download} onClick={onDownloadReference} className="mt-2 w-full glass-pill glass-pill--neutral">Download reference file</Btn>
                        <p className="mt-1.5 text-[11px] text-slate-400">Download, fill meanings, then Upload — interchanged rows still map correctly.</p>
                      </div>
                    )}
                  </span>
                  <Btn size="sm" onClick={() => void onLlmFill()} loading={filling} disabled={filling || emptyCount === 0} title={emptyCount === 0 ? "All meanings filled" : `Fill ${emptyCount} empty via LLM`} className="glass-pill glass-pill--amber"><span className="robot-glow inline-flex"><Sparkles size={13} /></span>LLM fill empty{emptyCount > 0 ? ` (${emptyCount})` : ""}</Btn>
                  <Btn size="sm" icon={Search} onClick={() => void onAnalyze()} loading={analyzing} disabled={analyzing} title="Re-introspect table — sample values + LLM drafts for empties" className="glass-pill glass-pill--neutral">Re-analyze</Btn>
                  {emptyCount > 0 && <span className="text-xs font-medium text-state-warn">{emptyCount} meaning{emptyCount === 1 ? "" : "s"} empty — amber rows must be filled before saving.</span>}
                </div>
              )}
              {mode === "edit" && (
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/50 p-2 dark:border-ink-800 dark:bg-ink-800/30">
                  <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Template name — min 2 chars" className={`w-44 rounded-lg border px-2 py-1 text-sm dark:bg-ink-900 ${!templateName.trim() ? "border-state-warn/60 bg-state-warn/5 placeholder:text-state-warn/60" : "border-slate-300 bg-white dark:border-ink-700"}`} />
                  {(() => {
                    const saveDisabled = templateSaving || !templateName.trim() || !cols;
                    return (
                      <Btn size="sm" icon={BookmarkPlus} loading={templateSaving} disabled={saveDisabled} onClick={async () => {
                    if (!cols || !templateName.trim()) return;
                    setTemplateSaving(true); setTemplateStatus(null);
                    try {
                      const t = await columnTemplateApi.create(templateName.trim(), cols.filter((c) => c.meaning.trim()).map((c) => ({ name: c.name, meaning: c.meaning, datatype: c.type })));
                      setTemplates((prev) => [t, ...prev]); setTemplateName(""); setTemplateStatus(`Saved "${t.name}"`);
                    } catch (e) { setTemplateStatus((e as Error).message); }
                    finally { setTemplateSaving(false); }
                  }} className={saveDisabled ? "glass-pill glass-pill--neutral opacity-40" : "glass-pill glass-pill--blue"} title={templateSaving ? "Saving…" : !cols ? "Loading columns…" : !templateName.trim() ? "Enter template name (min 2 chars) to save" : "Save current meanings as reusable template"}>Save template</Btn>
                    );
                  })()}
                  <select onChange={(e) => {
                    const id = e.target.value; if (!id) return;
                    const t = templates.find((x) => x.id === id); if (!t || !cols) return;
                    const byName = new Map(t.columns.map((c) => [c.name.toLowerCase(), c.meaning]));
                    setCols((prev) => prev ? prev.map((c) => byName.has(c.name.toLowerCase()) ? { ...c, meaning: byName.get(c.name.toLowerCase())! } : c) : prev);
                    setTemplateStatus(`Applied "${t.name}"`);
                    e.target.value = "";
                  }} defaultValue="" className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm dark:border-ink-700 dark:bg-ink-900">
                    <option value="">{templates.length > 0 ? "Select template…" : "No templates"}</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.columns.length} cols)</option>)}
                  </select>
                  {(() => {
                    if (!cols || templates.length === 0) return null;
                    const matches = templates.filter((t) => t.columns.some((tc) => cols.some((c) => c.name.toLowerCase() === tc.name.toLowerCase())));
                    if (matches.length === 0) return null;
                    return <span className="rounded-full bg-accent-500/10 px-2 py-0.5 text-[11px] text-accent-500 ring-1 ring-accent-500/30">{matches.length} matching template{matches.length === 1 ? "" : "s"} — {matches[0].name} {matches[0].columns.filter((tc) => cols.some((c) => c.name.toLowerCase() === tc.name.toLowerCase())).length}/{cols.length} cols</span>;
                  })()}
                  {!templateName.trim() && cols && <span className="text-[11px] font-medium text-state-warn">Enter template name — 2+ characters needed</span>}
                  {templateStatus && <span className="text-xs text-state-ok">{templateStatus}</span>}
                </div>
              )}

              <div className="mb-2 flex items-center justify-end">
                <Btn size="sm" icon={Download} onClick={onDownloadDefs} disabled={!cols || cols.length === 0} title="Download this table's name,meaning CSV" className="glass-pill glass-pill--neutral">Download table defs</Btn>
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-ink-800">
                <div className="max-h-[62vh] overflow-y-auto">
                  <table className="w-full table-fixed text-[14px]">
                    <colgroup><col style={{ width: "18%" }} /><col style={{ width: "18%" }} /><col style={{ width: "54%" }} /><col style={{ width: "10%" }} /></colgroup>
                    <thead className="sticky top-0 bg-slate-50 text-[11.5px] uppercase tracking-wider text-slate-400 dark:bg-ink-800/80">
                      <tr><th className="px-3.5 py-3 text-left font-semibold">Name</th><th className="px-3.5 py-3 text-left font-semibold">Type</th><th className="px-3.5 py-3 text-left font-semibold">Meaning {mode === "edit" && <span className="font-normal normal-case tracking-normal">(one sentence, units if known)</span>}</th><th className="px-2 py-3 text-center font-semibold">Actions</th></tr>
                    </thead>
                    <tbody>
                      {cols.map((c) => (
                        <tr key={c.name} className="border-t border-slate-200/40 hover:bg-slate-50/50 dark:border-ink-800/40 dark:hover:bg-white/[0.02]">
                          <td className="break-words px-3.5 py-2.5 font-mono text-[13px]">{c.name}</td>
                          <td className="px-3.5 py-2.5"><span className="whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11.5px] text-slate-500 dark:border-ink-700 dark:bg-white/[0.06] dark:text-ink-400">{c.type}</span></td>
                          <td className="px-3.5 py-2.5">
                            {mode === "view" ? (
                              <span className="text-[13.5px] text-slate-700 dark:text-ink-200">{c.meaning || <span className="text-slate-400">—</span>}</span>
                            ) : (
                              <input value={c.meaning} onChange={(e) => setMeaning(c.name, e.target.value)} placeholder="Meaning — e.g. average temperature in °C" className={`w-full rounded-lg border bg-white px-3 py-2 text-[13.5px] focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20 dark:bg-ink-900 ${!c.meaning.trim() ? "border-state-warn/60 bg-state-warn/5" : "border-slate-300 dark:border-ink-700"}`} />
                            )}
                          </td>
                          <td className="px-1.5 py-2.5 text-center">
                            <span className="inline-flex items-center justify-center gap-0.5">
                              <button onClick={() => void onLlmFillOne(c.name)} disabled={!!fillingCol || !!filling} title={fillingCol === c.name ? "LLM analysing…" : `Re-analyse "${c.name}" with LLM`} className={`rounded p-1.5 ${fillingCol === c.name ? "text-state-warn" : "text-amber-500/70 hover:bg-amber-500/10 hover:text-amber-600 dark:text-amber-400/70 dark:hover:bg-amber-500/10"}`}>
                                {fillingCol === c.name ? <Spinner size={12} /> : <span className="robot-glow inline-flex"><Sparkles size={11} /></span>}
                              </button>
                              {c.sampleValues && c.sampleValues.length > 0 ? (
                                <button onClick={() => setActiveSample(c)} title={`View samples for ${c.name}`} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-ink-400 dark:hover:bg-ink-700 dark:hover:text-ink-200">
                                  <Eye size={13} />
                                </button>
                              ) : (
                                <span className="inline-flex h-[28px] w-[28px] items-center justify-center text-[11px] text-slate-300">—</span>
                              )}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {activeSample && (
                <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4" onClick={() => setActiveSample(null)}>
                  <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-4 shadow-xl dark:border-ink-700 dark:bg-ink-900" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-mono text-sm font-semibold">{activeSample.name} <span className="font-sans text-xs font-normal text-slate-400">{activeSample.type}</span></span>
                      <button onClick={() => setActiveSample(null)} className="rounded px-2 py-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-ink-800">✕</button>
                    </div>
                    <div className="mt-3 space-y-1.5">
                      {activeSample.sampleValues!.map((v, i) => (
                        <div key={i} className="rounded-lg bg-slate-50 px-2.5 py-1.5 font-mono text-[12px] dark:bg-ink-800">{String(v)}</div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-200 bg-slate-50/50 px-6 py-3 dark:border-ink-800 dark:bg-ink-900/50">
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm glass-pill glass-pill--close">close</button>
            {mode === "edit" && <Btn variant="primary" icon={Save} onClick={() => void onSave()} loading={saving} disabled={saving || emptyCount > 0 || (isNew && !isDraft)} title={emptyCount > 0 ? "Fill all meanings first" : isNew && !isDraft ? "Save the line first" : isDraft ? "Save to draft — persists when you register the line" : "Save meanings for this table"} className="glass-pill glass-pill--blue">{isDraft ? "Save to draft" : "Save meanings"}</Btn>}
          </div>
        </div>
      </div>
    </div>
  );
}
