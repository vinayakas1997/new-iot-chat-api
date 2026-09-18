import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Search, Sparkles } from "lucide-react";
import { api, historyApi, type DayView, type Line, type RunInterpretation } from "../lib/api";
import { AlertBanner, StatusChip } from "../components/chips";
import { Btn } from "../components/ui";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** F4: line-first history. Verdict: did this line ingest clean on this date? */
export function History() {
  const [params, setParams] = useSearchParams();
  const [lines, setLines] = useState<Line[]>([]);
  const [q, setQ] = useState("");
  const [lineId, setLineId] = useState(params.get("line") ?? "");
  const [identity, setIdentity] = useState<(Line & { quietHours: number | null }) | null>(null);
  const [month, setMonth] = useState(today().slice(0, 7));
  const [days, setDays] = useState<Record<string, { runs: number; ok: number; failed: number; rows: number; facts: number }>>({});
  const [date, setDate] = useState(today());
  const [day, setDay] = useState<DayView | null>(null);
  const [interp, setInterp] = useState<RunInterpretation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listLines().then(setLines).catch((e) => setError((e as Error).message));
  }, []);

  async function selectLine(id: string, d = date, m = month) {
    setLineId(id);
    setParams(id ? { line: id } : {});
    setError(null);
    try {
      const [ident, mo, dy] = await Promise.all([
        historyApi.line(id),
        historyApi.month(id, m),
        historyApi.day(id, d),
      ]);
      setIdentity(ident);
      setDays(mo.days);
      setDay(dy);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    const preset = params.get("line");
    if (preset && preset !== lineId) void selectLine(preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickDate(d: string) {
    setDate(d);
    if (!lineId) return;
    try {
      setDay(await historyApi.day(lineId, d));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function changeMonth(m: string) {
    setMonth(m);
    if (!lineId) return;
    try {
      setDays((await historyApi.month(lineId, m)).days);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const matches = lines.filter((l) => `${l.id} ${l.name}`.toLowerCase().includes(q.toLowerCase()));
  const quiet = identity?.quietHours;
  const weeks = buildMonthGrid(month);

  return (
    <div>
      <h1 className="text-2xl font-bold">
        {day ? (day.summary.failed === 0 && day.summary.runs > 0 ? "Clean day" : day.summary.runs === 0 ? "No runs this day" : `${day.summary.failed} failure${day.summary.failed > 1 ? "s" : ""} this day`) : "Did ingestion run clean?"}
      </h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-ink-400">read-only · run log is the single source of truth</p>

      {error && <div className="mt-4"><AlertBanner tone="bad" title="Request failed" detail={error} /></div>}

      <div className="mt-6 flex items-center gap-3">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search line by name…"
            className="w-80 rounded-lg border border-slate-300 bg-transparent py-2 pl-9 pr-3 text-sm focus:border-accent-500 focus:outline-none dark:border-ink-700"
          />
        </div>
      </div>
      {q && (
        <div className="mt-2 flex max-w-xl flex-col gap-1">
          {matches.slice(0, 8).map((l) => (
            <button key={l.id} onClick={() => { setQ(""); void selectLine(l.id); }} className="rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-ink-800 glass-pill glass-pill--neutral">
              <span className="font-mono font-medium">{l.id}</span> <span className="text-slate-500">{l.name}</span>
            </button>
          ))}
        </div>
      )}

      {identity && (
        <div className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-ink-800">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold">{identity.id}</span>
            <span className="text-slate-500">{identity.name}</span>
            {identity.active ? <StatusChip tone="ok">ingesting</StatusChip> : <StatusChip tone="mute">deregistered</StatusChip>}
          </div>
          <div className="mt-1 text-sm text-slate-500">
            registered {new Date(identity.createdAt).toLocaleDateString()} · {identity.connectionLabel} · tables: {identity.memberTables.join(", ") || "—"}
          </div>
          {quiet != null && quiet > 6 && (
            <div className="mt-2"><AlertBanner tone="warn" title={`Quiet for ${Math.round(quiet)}h`} detail="No successful tick recently — a dead sensor looks like a healthy idle line. Investigate." /></div>
          )}
          {identity.lastTick == null && (
            <div className="mt-2"><AlertBanner tone="warn" title="Never ticked" detail="The tick engine has not run for this line yet — history below shows test-runs only." /></div>
          )}
        </div>
      )}

      {lineId && (
        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[20rem_1fr]">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <button onClick={() => void changeMonth(shiftMonth(month, -1))} aria-label="previous month" className="rounded border border-slate-300 p-1 text-sm transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:border-ink-700 dark:hover:bg-ink-800 glass-pill glass-pill--neutral"><ChevronLeft size={14} /></button>
              <span className="tnum text-sm font-semibold">{month}</span>
              <button onClick={() => void changeMonth(shiftMonth(month, 1))} aria-label="next month" className="rounded border border-slate-300 p-1 text-sm transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:border-ink-700 dark:hover:bg-ink-800 glass-pill glass-pill--neutral"><ChevronRight size={14} /></button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-xs">
              {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <div key={i} className="text-slate-400">{d}</div>)}
              {weeks.map((d, i) =>
                d == null ? <div key={i} /> : (
                  <button
                    key={d}
                    onClick={() => void pickDate(d)}
                    className={`flex flex-col items-center rounded-lg py-1.5 glass-pill ${d === date ? "glass-pill--blue bg-accent-500/15 text-accent-500" : "glass-pill--neutral hover:bg-slate-100 dark:hover:bg-ink-800"}`}
                  >
                    <span className="tnum">{Number(d.slice(8))}</span>
                    <Dot s={days[d]} />
                  </button>
                )
              )}
            </div>
          </div>

          <div>
            {day && (
              <>
                <div className="flex items-center gap-3 text-sm">
                  <span className="tnum font-bold">{day.date}</span>
                  <StatusChip tone={day.summary.failed > 0 ? "bad" : day.summary.runs > 0 ? "ok" : "mute"}>
                    {day.summary.runs} runs · {day.summary.ok} ok · {day.summary.failed} failed
                  </StatusChip>
                  <span className="tnum text-slate-400">{day.summary.rows} rows → {day.summary.facts} facts</span>
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  vs {day.prevDate}: <span className="tnum">{day.prev.runs} runs · {day.prev.rows} rows → {day.prev.facts} facts</span>
                </div>
                <div className="mt-3 flex flex-col gap-2">
                  {day.runs.map((r) => (
                    <div key={r.id} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-ink-800">
                      <span className="tnum text-slate-400">{new Date(r.at).toLocaleTimeString()}</span>
                      <span className="font-medium">{r.cardName}</span>
                      <span className="tnum text-xs text-slate-400">v{r.cardVersion}</span>
                      <StatusChip tone={r.kind === "test" ? "accent" : "mute"}>{r.kind}</StatusChip>
                      <StatusChip tone={r.ok ? "ok" : "bad"}>{r.ok ? "ok" : "failed"}</StatusChip>
                      <span className="tnum text-xs text-slate-400">{r.rowsPulled} rows{r.durationMs != null ? ` · ${r.durationMs}ms` : ""}</span>
                      <Btn variant="ghost" size="sm" icon={Sparkles} onClick={() => void historyApi.run(r.id).then(setInterp).catch((e) => setError((e as Error).message))} className="ml-auto">how AI interpreted</Btn>
                    </div>
                  ))}
                  {day.runs.length === 0 && <div className="text-sm text-slate-400">nothing ran this day</div>}
                </div>
                {day.failures.length > 0 && (
                  <div className="mt-4">
                    <div className="mb-2 text-sm font-semibold text-state-bad">Failures</div>
                    {day.failures.map((f) => (
                      <AlertBanner key={f.id} tone="bad" title={`${f.cardName} · ${new Date(f.at).toLocaleTimeString()}`} detail={f.error ?? undefined} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {interp && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60" onClick={() => setInterp(null)}>
          <div className="max-h-[90vh] w-[40rem] overflow-auto rounded-xl bg-white p-6 dark:bg-ink-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold">How the AI interpreted <span className="font-mono text-sm text-slate-400">run #{interp.run.id}</span></h2>
            <div className="mt-1 text-sm text-slate-500">{interp.cardName} · {interp.run.kind} · {new Date(interp.run.at).toLocaleString()}</div>
            <div className="mt-4 text-xs uppercase tracking-wider text-slate-400">context in</div>
            <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-100 p-2 font-mono text-xs dark:bg-ink-950">{interp.contextIn.sql}</pre>
            <div className="mt-1 text-xs text-slate-400">{interp.contextIn.granularity}{interp.contextIn.extractHint ? ` · hint: ${interp.contextIn.extractHint}` : ""}</div>
            <div className="mt-4 text-xs uppercase tracking-wider text-slate-400">facts out</div>
            <div className="tnum mt-1 text-2xl font-bold">{interp.factsOut.stored} <span className="text-sm font-normal text-slate-400">facts</span></div>
            <p className="mt-1 text-sm text-slate-500">{interp.factsOut.note}</p>
            <div className="mt-4 flex justify-end"><button onClick={() => setInterp(null)} className="rounded-lg px-4 py-2 text-sm glass-pill glass-pill--close">close</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function Dot({ s }: { s?: { runs: number; ok: number; failed: number } }) {
  if (!s || s.runs === 0) return <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-slate-300 dark:bg-ink-700" />;
  return <span className={`mt-0.5 h-1.5 w-1.5 rounded-full ${s.failed > 0 ? "bg-state-bad" : "bg-state-ok"}`} />;
}

function buildMonthGrid(month: string): (string | null)[] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = Array(offset).fill(null);
  for (let d = 1; d <= dim; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  return cells;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
