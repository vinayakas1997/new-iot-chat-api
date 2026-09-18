import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import type { CardTemplate, Line, TestResult } from "../lib/api";
import { cardApi, chartApi } from "../lib/api";
import { ChartPreviewModal } from "./ChartPreviewModal";
import { windowForResolution, type Resolution } from "./Chart";
import { Btn, Spinner } from "./ui";
import { matchMember, RemapTables, remapState, sqlTableRefs } from "../screens/Cards";

/**
 * Line-level preview: same template, this line's numbers. Pick a feature,
 * remap its SQL onto the line's tables (same logic as instantiate, under
 * the hood), then open the shared preview screen with the template's
 * suggestions rendered on this line's sample. Analyse-only: selection
 * still lives at template/card level.
 */
export function LinePreview({ line, initialTemplateId, onClose }: { line: Line; initialTemplateId?: string | null; onClose: () => void }) {
  const [templates, setTemplates] = useState<CardTemplate[]>([]);
  const [tplId, setTplId] = useState(initialTemplateId ?? "");
  // Details entry pre-selects the line's template and skips the picker;
  // manual Preview (or an unknown id) falls back to picking.
  const [picking, setPicking] = useState(!initialTemplateId);
  const [map, setMap] = useState<Record<string, string>>({});
  const [sample, setSample] = useState<TestResult | null>(null);
  const [sampledAt, setSampledAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [resolution, setResolution] = useState<Resolution>("hourly");

  useEffect(() => {
    cardApi.listTemplates().then((t) => {
      setTemplates(t);
      // Keep the Details default when it exists; else first template.
      if (!initialTemplateId || !t.some((x) => x.id === initialTemplateId)) {
        if (t.length > 0) setTplId(t[0].id);
        setPicking(true);
      }
    }).catch((e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tpl = templates.find((t) => t.id === tplId) ?? null;
  const refs = tpl ? sqlTableRefs(tpl.sqlTemplate) : [];
  const members = line.memberTables;
  // Same remap as instantiate: explicit map wins, then fuzzy match.
  const ds = tpl ? remapState(tpl.sqlTemplate, members, map) : null;
  const remappedSql = ds?.preview ?? "";
  const missing = refs.filter((r) => !matchMember(r, members) && !map[r.toLowerCase()]);
  const blocked = !tpl || refs.length > 0 && (missing.length > 0 || !remappedSql);

  async function fetchSample(res: Resolution) {
    if (!tpl || blocked) return;
    setLoading(true);
    setError(null);
    try {
      const w = windowForResolution(res);
      setSample(await chartApi.querySample(line.id, remappedSql, w.from, w.to));
      setSampledAt(new Date().toISOString());
    } catch (e) {
      setError((e as Error).message);
      setSample(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadSample() {
    await fetchSample("hourly");
    setModalOpen(true);
  }

  async function refreshSample() {
    await fetchSample(resolution);
  }

  function changeResolution(res: Resolution) {
    setResolution(res);
    void fetchSample(res);
  }

  const sug = tpl?.chartSuggestions ?? [];

  return (
    <>
      {!modalOpen && (
        <div className="anim-fade-in fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
          <div className="anim-pop-in max-h-[90vh] w-[36rem] overflow-auto rounded-xl bg-white p-6 dark:bg-ink-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold">Preview feature on {line.name}</h2>
            <p className="mt-1 text-sm text-slate-500">Same charts, this line's numbers — SQL remapped under the hood.</p>
            {error && <div className="mt-2 text-xs text-state-bad">{error}</div>}
            {picking ? (
              <label className="mt-4 block text-sm">Feature
                <select value={tplId} onChange={(e) => { setTplId(e.target.value); setMap({}); setSample(null); }} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-ink-700">
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.chartSuggestions.length} suggestions)</option>)}
                </select>
              </label>
            ) : (
              <div className="mt-4 flex items-center gap-2 text-sm">
                <span className="text-slate-400">Feature:</span>
                <span className="font-medium">{tpl?.name ?? "—"}</span>
                <span className="tnum text-xs text-slate-400">{tpl ? `${tpl.chartSuggestions.length} suggestions` : ""}</span>
                <button onClick={() => setPicking(true)} className="ml-auto text-xs text-accent-500 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60">change…</button>
              </div>
            )}
            {tpl && refs.length > 0 && (
              <div className="mt-3">
                <RemapTables sql={tpl.sqlTemplate} members={members} map={map} setMap={setMap} />
                {missing.length > 0 && <div className="mt-1 text-xs text-state-warn">Unmapped tables: {missing.join(", ")} — map them above.</div>}
              </div>
            )}
            {tpl && refs.length === 0 && <div className="mt-3 text-xs text-slate-400">No table references in this SQL — runs as-is.</div>}
            {tpl && (
              <div className="mt-3">
                <div className="mb-1 text-xs uppercase tracking-widest text-slate-400">query on {line.id}</div>
                <pre className="max-h-40 overflow-auto rounded-lg bg-slate-100 p-2.5 font-mono text-xs leading-relaxed dark:bg-ink-800">{remappedSql || tpl.sqlTemplate || "(no SQL yet)"}</pre>
              </div>
            )}
            {tpl && sug.length === 0 && <div className="mt-3 text-xs text-state-warn">This feature has no chart suggestions yet — recommend them on its template first.</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm glass-pill glass-pill--close">cancel</button>
              <Btn variant="primary" icon={Eye} onClick={() => void loadSample()} loading={loading} disabled={loading || blocked || sug.length === 0} title={blocked ? "Map every table first" : "Sample this line and open the preview screen"} className="glass-pill glass-pill--blue">
                Open preview
              </Btn>
            </div>
            {loading && !modalOpen && <div className="mt-2 flex items-center gap-2 text-sm text-slate-400"><Spinner /> Sampling {line.id}…</div>}
          </div>
        </div>
      )}
      {modalOpen && tpl && (
        <ChartPreviewModal
          title={`Preview — ${tpl.name} on ${line.name}`}
          subtitle={`${sug.length} suggestions · SQL remapped to ${line.id}'s tables`}
          items={sug.map((s, i) => ({
            key: `${i}`,
            chartType: s.chartType,
            xColumn: s.xColumn,
            yColumns: s.yColumns,
            title: s.title,
            rationale: s.rationale,
            conditions: s.conditions,
            xLabel: s.xColumn,
            yLabel: s.yColumns.length > 0 ? `${s.yColumns.join(", ")}${tpl.unit ? ` (${tpl.unit})` : ""}` : undefined,
            units: tpl.unit || undefined,
          }))}
          sample={sample}
          sampledAt={sampledAt}
          loadingSample={loading}
          sampleError={error}
          summary={`${line.id} sample`}
          resolution={resolution}
          onResolutionChange={changeResolution}
          onRefresh={() => void refreshSample()}
          onClose={() => { setModalOpen(false); onClose(); }}
        />
      )}
    </>
  );
}
