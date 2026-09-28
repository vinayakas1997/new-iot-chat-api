import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Hourglass, Pause, Play, Search, StepForward } from "lucide-react";
import { api, prefillApi, type Line, type PrefillStatus } from "../lib/api";
import { AlertBanner, StatusChip } from "../components/chips";
import { EmptyState } from "../components/ui";
import { Btn, Spinner } from "../components/ui";

/** Reference cadence: expected live calls/day per stream (the 288/24/1 math). */
const CALLS_PER_DAY: Record<string, number> = { "5min": 288, hourly: 24, daily: 1, weekly: 1 / 7, monthly: 1 / 30 };

function fmtEta(sec: number): string {
  if (sec <= 0) return "—";
  if (sec < 90) return `≈${Math.round(sec)}s`;
  const m = Math.round(sec / 60);
  if (m < 90) return `≈${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `≈${h}h ${m % 60}m`;
  return `≈${Math.round(h / 24)}d`;
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const STATE_TONE: Record<string, "ok" | "warn" | "mute" | "bad" | "accent"> = {
  walking: "accent",
  "caught-up": "ok",
  paused: "warn",
  off: "mute",
  error: "bad",
};

/**
 * F8 Prefill — the pre-fill job face. Live ticks own freshness (F7); this
 * screen owns history: per-line → per-card → per-resolution progress, call
 * budgets, ETAs, walker controls. Live always preempts; prefill eats idle.
 */
export function Prefill() {
  const [params, setParams] = useSearchParams();
  const [lines, setLines] = useState<Line[]>([]);
  const [q, setQ] = useState("");
  const [lineId, setLineId] = useState(params.get("line") ?? "");
  const [status, setStatus] = useState<PrefillStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listLines().then(setLines).catch((e) => setError((e as Error).message));
  }, []);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    try {
      setStatus(await prefillApi.status(id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  function selectLine(id: string) {
    setLineId(id);
    setParams(id ? { line: id } : {});
    setStatus(null);
    setError(null);
    void load(id);
  }

  useEffect(() => {
    const preset = params.get("line");
    if (preset) void load(preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live view of a background job: refresh while open.
  useEffect(() => {
    if (!lineId) return;
    const t = setInterval(() => void load(lineId), 15000);
    return () => clearInterval(t);
  }, [lineId, load]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (lineId) await load(lineId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const matches = lines.filter((l) => `${l.id} ${l.name}`.toLowerCase().includes(q.toLowerCase()));
  const totals = (status?.cards ?? []).reduce(
    (a, c) => {
      for (const s of c.streams) {
        a.remaining += s.chunksRemaining;
        a.eta = Math.max(a.eta, s.etaSec);
        if (s.state === "walking") a.walking++;
      }
      return a;
    },
    { remaining: 0, eta: 0, walking: 0 }
  );

  return (
    <div>
      <h1 className="flex items-center gap-2 text-2xl font-bold">
        <Hourglass size={22} className="text-accent-500" /> Pre-fill
      </h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-ink-400">history drains here — live data always preempts, pre-fill eats idle</p>

      {error && <div className="mt-4"><AlertBanner tone="bad" title="Request failed" detail={error} /></div>}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search line by name…"
            className="w-80 rounded-lg border border-slate-300 bg-transparent py-2 pl-9 pr-3 text-sm focus:border-accent-500 focus:outline-none dark:border-ink-700"
          />
        </div>
        {lineId && status && (
          <>
            <StatusChip tone={status.walker.enabled ? (totals.walking > 0 ? "accent" : "ok") : "mute"}>
              walker {status.walker.enabled ? (totals.walking > 0 ? `walking · ${totals.walking} streams` : "caught up") : "disabled"}
            </StatusChip>
            <Btn size="sm" icon={Pause} disabled={busy} onClick={() => void act(() => prefillApi.pause({ lineId }))} title="Hold all cursors — resumable, distinct from opt-out" className="glass-pill glass-pill--neutral">Pause all</Btn>
            <Btn size="sm" icon={Play} disabled={busy} onClick={() => void act(() => prefillApi.resume({ lineId }))} title="Resume the walk from held cursors" className="glass-pill glass-pill--neutral">Resume all</Btn>
            <Btn size="sm" icon={StepForward} disabled={busy} onClick={() => void act(() => prefillApi.pass())} title="Run one walker pass now (1 chunk per resolution) — verification hook" className="glass-pill glass-pill--neutral">Pass now</Btn>
          </>
        )}
      </div>
      {q && (
        <div className="mt-2 flex max-w-xl flex-col gap-1">
          {matches.slice(0, 8).map((l) => (
            <button key={l.id} onClick={() => { setQ(""); selectLine(l.id); }} className="rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-ink-800 glass-pill glass-pill--neutral">
              <span className="font-mono font-medium">{l.id}</span> <span className="text-slate-500">{l.name}</span>
            </button>
          ))}
        </div>
      )}

      {!lineId && (
        <div className="mt-6"><EmptyState icon={Hourglass} title="Pick a line" body="Pre-fill progress, budgets and ETAs land here." /></div>
      )}

      {loading && !status && (
        <div className="mt-6 flex items-center gap-2 text-sm text-slate-400"><Spinner /> Loading…</div>
      )}

      {status && (
        <>
          <div className="tnum mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500 dark:text-ink-400">
            <span title="Expected live calls/day per stream">cadence {Object.entries(CALLS_PER_DAY).filter(([, v]) => v >= 1).map(([k, v]) => `${k}→${v}/d`).join(" · ")}</span>
            <span title="Last 24h">live {status.last24h.live.runs} runs · {fmtMs(status.last24h.live.ms)} · {status.last24h.live.facts} facts</span>
            <span title="Last 24h">pre-fill {status.last24h.prefill.runs} runs · {fmtMs(status.last24h.prefill.ms)} · {status.last24h.prefill.facts} facts</span>
            <span title="Step-1 reads today vs cap — the only knob. Manual presses bypass.">reads {status.readsToday.used}/{status.readsToday.cap} LLM calls</span>
            <span title="Worst case 1 LLM call per remaining chunk">≈{totals.remaining} calls left · ETA {fmtEta(totals.eta)}</span>
          </div>

          <div className="mt-4 flex flex-col gap-4">
            {status.cards.map((c) => (
              <div key={c.cardId} className="rounded-xl border border-slate-200 p-4 dark:border-ink-800">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  <span className="tnum text-xs text-slate-400">{c.granularity} · {c.status}{c.optedOff ? " · pre-fill off" : ""}{c.analysisStart ? ` · since ${c.analysisStart}` : ""}</span>
                  <span className="ml-auto flex gap-1.5">
                    <Btn size="sm" icon={Pause} disabled={busy || c.optedOff} onClick={() => void act(() => prefillApi.pause({ cardId: c.cardId }))} title="Hold this card's cursors" className="glass-pill glass-pill--neutral">Pause</Btn>
                    <Btn size="sm" icon={Play} disabled={busy || c.optedOff} onClick={() => void act(() => prefillApi.resume({ cardId: c.cardId }))} title="Resume this card's walk" className="glass-pill glass-pill--neutral">Resume</Btn>
                  </span>
                </div>
                <div className="mt-3 flex flex-col gap-2">
                  {c.streams.map((s) => {
                    const pct = s.chunksRemaining <= 0 ? 100 : Math.max(0, Math.min(99, Math.round((s.chunksDone / Math.max(1, s.chunksDone + s.chunksRemaining)) * 100)));
                    return (
                      <div key={s.resolution} className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="tnum w-16 shrink-0 font-medium">{s.resolution}</span>
                        <div className="h-2 min-w-24 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-ink-800" title={`${s.chunksDone} chunks done · ${s.chunksRemaining} left`}>
                          <div className="h-full rounded-full bg-accent-500/70" style={{ width: `${pct}%` }} />
                        </div>
                        <StatusChip tone={STATE_TONE[s.state] ?? "mute"}>{s.state}</StatusChip>
                        {!s.inScope && <span className="text-[11px] text-slate-400" title={s.scopeNote ?? "deselected"}>out of scope</span>}
                        <span className="tnum text-slate-400" title="Chunks done / remaining (worst case 1 LLM call each)">
                          {s.chunksDone}✓ · {s.chunksRemaining} left · ≈{s.chunksRemaining} calls
                        </span>
                        <span className="tnum text-slate-400" title={`Measured ${fmtMs(s.msPerChunk)}/chunk at walker pace`}>
                          ETA {fmtEta(s.etaSec)}
                        </span>
                        {s.coverageFrom && <span className="tnum text-slate-400" title="First window ever ingested">from {s.coverageFrom.slice(0, 10)}</span>}
                        {s.lastError && <span className="max-w-xs truncate text-state-bad" title={s.lastError}>{s.lastError}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {status.cards.length === 0 && (
              <div className="mt-2"><EmptyState icon={Hourglass} title="No cards" body="Register template cards on this line first." /></div>
            )}
          </div>

          <div className="tnum mt-6 rounded-xl border border-slate-200 p-4 text-xs text-slate-500 dark:border-ink-800 dark:text-ink-400">
            <div className="font-bold text-slate-600 dark:text-ink-200">Scheduler — live first, always</div>
            <div className="mt-1">live every 5 min · walker every {Math.round(status.walker.intervalMs / 1000)}s · 1 chunk per resolution per pass · walker stands down while a live tick runs (finishes its chunk, never killed mid-write)</div>
            <div className="mt-1">kill-switches: walker {status.walker.enabled ? "on" : "off (PREFILL_ENABLED=false)"} · live ticker independent (TICK_ENABLED) · per-card opt-out via analysisStart “off” · pause holds cursors, resumable</div>
          </div>
        </>
      )}
    </div>
  );
}
