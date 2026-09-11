import { useEffect, useState } from "react";
import { AlertBanner, StatusChip } from "../components/chips";

interface HsStatus {
  configured: boolean;
  live: boolean;
  latencyMs: number | null;
  lastWrite: string | null;
  lastError: string | null;
  url?: string;
}

/** F5: status hero + deep link. Verdict: is Hindsight live? */
export function Hindsight() {
  const [st, setSt] = useState<HsStatus | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const r = await fetch("/api/ingest/hindsight/status");
      const body = (await r.json()) as HsStatus;
      setSt(body);
      if (body.url) setUrl(body.url);
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
      <h1 className="text-2xl font-bold">
        {st == null ? "Is Hindsight live?" : st.live ? "Hindsight is live" : "Hindsight is down"}
      </h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-ink-400">live means working, not just pingable</p>

      {error && <div className="mt-4"><AlertBanner tone="bad" title="Request failed" detail={error} /></div>}

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
            <a href={st.url} target="_blank" rel="noreferrer" className="mt-6 inline-block rounded-lg bg-accent-500 px-6 py-3 font-semibold text-white">
              Open Hindsight's own UI →
            </a>
          )}
        </div>
      )}

      <div className="mt-6 max-w-2xl rounded-xl border border-slate-200 p-4 dark:border-ink-800">
        <div className="text-sm font-semibold">Hindsight UI URL (setting, per environment)</div>
        <div className="mt-2 flex gap-2">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hindsight.example.com" className="flex-1 rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-ink-700" />
          <button onClick={() => void save()} className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white">Save</button>
          <button onClick={() => void refresh()} className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-ink-700">Recheck</button>
        </div>
      </div>
    </div>
  );
}
