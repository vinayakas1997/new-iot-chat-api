import { useEffect, useState } from "react";
import { ExternalLink, Plug, Power, RefreshCw, Rocket, Save, Trash2 } from "lucide-react";
import { AlertBanner, StatusChip } from "../components/chips";
import { bankApi, type BankOverviewEntry } from "../lib/api";
import { FormattedText } from "../components/FormattedText";
import { Btn } from "../components/ui";

interface HsStatus {
  configured: boolean;
  live: boolean;
  latencyMs: number | null;
  lastWrite: string | null;
  lastError: string | null;
  url?: string;
}

interface LlmProvider {
  id: string;
  label: string;
  baseUrl: string;
  hasKey: boolean;
  activeModel: string;
  isActive: boolean;
  lastOk: string | null;
  lastError: string | null;
}

interface DetectOut {
  ok: boolean;
  latencyMs: number | null;
  models: string[];
  error: string | null;
}

/** F5 + F6: AI services. Verdicts: is Hindsight live? is the LLM live? */
export function Hindsight() {
  const [st, setSt] = useState<HsStatus | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const [llmLabel, setLlmLabel] = useState("");
  const [llmBase, setLlmBase] = useState("");
  const [llmKey, setLlmKey] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState<DetectOut | null>(null);
  const [picked, setPicked] = useState("");
  const [banks, setBanks] = useState<BankOverviewEntry[]>([]);

  async function refresh() {
    try {
      const [hs, llm] = await Promise.all([
        fetch("/api/ingest/hindsight/status").then((r) => r.json() as Promise<HsStatus>),
        fetch("/api/ingest/llm").then((r) => r.json() as Promise<LlmProvider[]>),
      ]);
      setSt(hs);
      if (hs.url) setUrl(hs.url);
      setProviders(llm);
      bankApi.overview().then((o) => setBanks(o.banks)).catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => void refresh(), []);

  async function save() {
    setError(null);
    try {
      const r = await fetch("/api/ingest/hindsight/url", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error ?? "save failed");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">AI Services</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-ink-400">outbound AI the platform depends on · live means working, not just pingable</p>

      {error && <div className="mt-4"><AlertBanner tone="bad" title="Request failed" detail={error} /></div>}

      <h2 className="mt-6 text-sm font-bold uppercase tracking-widest text-slate-400">Hindsight memory</h2>

      {st && (
        <div className="mt-6 max-w-2xl rounded-2xl border border-slate-200 p-8 text-center dark:border-ink-800">
          <StatusChip tone={st.live ? "ok" : st.configured ? "bad" : "mute"}>
            {st.live ? "● LIVE" : st.configured ? "● UNREACHABLE" : "● NOT CONFIGURED"}
          </StatusChip>
          <div className="tnum mt-4 flex justify-center gap-8 text-sm">
            <div><div className="text-2xl font-bold">{st.latencyMs != null ? `${st.latencyMs}ms` : "—"}</div><div className="text-slate-400">latency</div></div>
            <div><div className="text-2xl font-bold">{st.lastWrite ? new Date(st.lastWrite).toLocaleDateString() : "—"}</div><div className="text-slate-400">last fact write</div></div>
          </div>
          {st.lastError && <div className="mt-4"><AlertBanner tone="bad" title="Last error" detail={st.lastError} /></div>}
          {st.live && st.url && (
            <a href={st.url} target="_blank" rel="noreferrer" className="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-accent-500 px-6 py-3 font-semibold text-white transition-all duration-150 hover:bg-accent-400 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60">
              Open Hindsight's own UI <ExternalLink size={14} />
            </a>
          )}
        </div>
      )}

      <div className="mt-4 max-w-2xl rounded-xl border border-slate-200 p-4 dark:border-ink-800">
        <div className="text-sm font-semibold">Hindsight UI URL (setting, per environment)</div>
        <div className="mt-2 flex gap-2">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hindsight.example.com" className="flex-1 rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-ink-700" />
          <Btn variant="primary" icon={Save} onClick={() => void save()}>Save</Btn>
          <Btn icon={RefreshCw} onClick={() => void refresh()}>Recheck</Btn>
        </div>
      </div>

      <h2 className="mt-8 text-sm font-bold uppercase tracking-widest text-slate-400">Line banks</h2>
      {banks.length === 0 && <div className="mt-2 text-sm text-slate-400">no lines yet — register one in F2, then push it from the Lines tab.</div>}
      {banks.map((b) => (
        <div key={b.lineId} className="mt-2 flex max-w-2xl items-center gap-3 rounded-xl border border-slate-200 px-4 py-2 text-sm dark:border-ink-800">
          <FormattedText text={b.bankId} bankId={b.bankId} />
          <FormattedText text={b.lineName} lineName={b.lineName} />
          <span className="ml-auto flex items-center gap-2">
            <StatusChip tone={b.ready ? "ok" : b.draftSaved ? "mute" : "mute"}>{b.ready ? "ready" : b.draftSaved ? "draft" : "pending"}</StatusChip>
            <span className="tnum text-xs text-slate-400">{b.greenCards}/{b.cards} green</span>
          </span>
        </div>
      ))}

      <h2 className="mt-8 text-sm font-bold uppercase tracking-widest text-slate-400">LLM for extraction</h2>
      {providers.filter((p) => p.isActive).map((p) => (
        <div key={p.id} className="mt-4 max-w-2xl rounded-2xl border border-slate-200 p-6 text-center dark:border-ink-800">
          <StatusChip tone="ok">● LIVE · {p.activeModel}</StatusChip>
          <div className="mt-2 text-sm text-slate-500">{p.label} · {p.baseUrl}</div>
          {p.lastError && <div className="mt-3"><AlertBanner tone="bad" title="Last error" detail={p.lastError} /></div>}
          <Btn
            variant="warn"
            icon={Power}
            onClick={() => void (async () => {
              setError(null);
              try {
                await fetch(`/api/ingest/llm/${p.id}/deactivate`, { method: "POST" });
                await refresh();
              } catch (e) { setError((e as Error).message); }
            })()}
            className="mt-4"
          >
            Deactivate
          </Btn>
        </div>
      ))}
      {providers.filter((p) => !p.isActive).map((p) => (
        <div key={p.id} className="mt-2 flex max-w-2xl items-center gap-3 rounded-xl border border-slate-200 px-4 py-2 text-sm dark:border-ink-800">
          <span className="font-medium">{p.label}</span>
          <span className="text-slate-400">{p.baseUrl}</span>
          {p.lastError && <span className="text-state-bad">{p.lastError}</span>}
          <Btn
            variant="ghostBad"
            icon={Trash2}
            onClick={() => void (async () => {
              if (!confirm(`Delete provider "${p.label}"?`)) return;
              await fetch(`/api/ingest/llm/${p.id}`, { method: "DELETE" });
              await refresh();
            })()}
            className="ml-auto"
          >
            delete
          </Btn>
        </div>
      ))}

      <div className="mt-4 max-w-2xl rounded-xl border border-slate-200 p-4 dark:border-ink-800">
        <div className="text-sm font-semibold">Connect an OpenAI-compatible LLM</div>
        <div className="mt-2 flex gap-2">
          <input value={llmLabel} onChange={(e) => setLlmLabel(e.target.value)} placeholder="label" className="w-36 rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-ink-700" />
          <input value={llmBase} onChange={(e) => setLlmBase(e.target.value)} placeholder="http://host:port" className="flex-1 rounded-lg border border-slate-300 bg-transparent px-3 py-2 font-mono text-sm dark:border-ink-700" />
          <input value={llmKey} onChange={(e) => setLlmKey(e.target.value)} type="password" placeholder="API key (optional)" className="w-44 rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-ink-700" />
          <Btn
            icon={Plug}
            onClick={() => void (async () => {
              setError(null); setDetected(null); setDetecting(true);
              try {
                const r = await fetch("/api/ingest/llm/detect", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ baseUrl: llmBase, apiKey: llmKey }),
                });
                const body = (await r.json()) as DetectOut;
                if (!r.ok) throw new Error(body.error ?? "detect failed");
                setDetected(body);
                setPicked(body.models.length === 1 ? body.models[0] : "");
              } catch (e) { setError((e as Error).message); }
              finally { setDetecting(false); }
            })()}
            loading={detecting}
            disabled={detecting}
          >
            {detecting ? "…" : "Connect"}
          </Btn>
        </div>
        {detected?.ok && (
          <div className="mt-3 rounded-lg bg-slate-100 p-3 text-sm dark:bg-ink-900">
            <div className="text-state-ok">reachable · <span className="tnum">{detected.latencyMs}ms</span> · {detected.models.length} model{detected.models.length === 1 ? "" : "s"} detected</div>
            <div className="mt-2 flex gap-2">
              <select value={picked} onChange={(e) => setPicked(e.target.value)} className="flex-1 rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-ink-700">
                <option value="">pick the active model…</option>
                {detected.models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <Btn
                variant="primary"
                icon={Rocket}
                onClick={() => void (async () => {
                  setError(null);
                  try {
                    const r = await fetch("/api/ingest/llm/activate", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ label: llmLabel || llmBase, baseUrl: llmBase, apiKey: llmKey, model: picked }),
                    });
                    const body = await r.json();
                    if (!r.ok) throw new Error((body as { error?: string }).error ?? "activate failed");
                    setDetected(null); setPicked(""); setLlmLabel(""); setLlmBase(""); setLlmKey("");
                    await refresh();
                  } catch (e) { setError((e as Error).message); }
                })()}
                disabled={!picked}
              >
                Save + activate
              </Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
