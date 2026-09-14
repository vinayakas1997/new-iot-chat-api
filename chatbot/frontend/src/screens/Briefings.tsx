import { useEffect, useState } from "react";
import { ragApi, type Report, type Schedule } from "../lib/rag-api";
import { Banner, Chip } from "../components/ui";
import { ChartView } from "../components/charts";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function Briefings() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [scheduleId, setScheduleId] = useState("");
  const [date, setDate] = useState(today());
  const [reports, setReports] = useState<Report[]>([]);
  const [selected, setSelected] = useState<Report | null>(null);

  useEffect(() => {
    ragApi.schedules().then((s) => {
      setSchedules(s);
      if (s.length && !scheduleId) setScheduleId(s[0].id);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!scheduleId) return;
    ragApi.reports({ scheduleId, date }).then((r) => {
      setReports(r);
      setSelected(r[0] ?? null);
    }).catch(() => {});
  }, [scheduleId, date]);

  const ans = selected?.answer;
  return (
    <div>
      <h1 className="text-2xl font-bold">{selected ? (selected.ok ? "Clean morning brief" : "Briefing failed") : "What happened yesterday?"}</h1>
      <p className="mt-1 text-sm text-slate-500">read-only · every run is stored, pick any date</p>

      <div className="mt-4 flex flex-wrap gap-3">
        <select value={scheduleId} onChange={(e) => setScheduleId(e.target.value)} className="rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-ink-700">
          {schedules.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.lineId}</option>)}
        </select>
        <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className="tnum rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-ink-700" />
        <button onClick={() => setDate(new Date(Date.now() - 86400000).toISOString().slice(0, 10))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-ink-700">Yesterday</button>
      </div>

      {!selected && <div className="mt-6 rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400 dark:border-ink-700">Nothing ran on {date} for this job yet — check Schedules or hit Run now.</div>}

      {selected && (
        <div className="mt-6">
          <div className="flex items-center gap-3">
            <span className="tnum text-sm font-bold">{selected.at.slice(0, 16).replace("T", " ")}</span>
            <Chip tone={selected.ok ? "ok" : "bad"}>{selected.ok ? "ok" : "failed"}</Chip>
            {reports.length > 1 && <span className="tnum text-xs text-slate-400">{reports.length} runs this day</span>}
          </div>
          {reports.length > 1 && (
            <div className="mt-2 flex gap-2">
              {reports.map((r) => (
                <button key={r.id} onClick={() => setSelected(r)} className={`tnum rounded-lg border px-2 py-1 text-xs ${r.id === selected.id ? "border-accent-500 text-accent-500" : "border-slate-300 dark:border-ink-700"}`}>
                  {r.at.slice(11, 16)}
                </button>
              ))}
            </div>
          )}
          {!selected.ok && <div className="mt-3"><Banner tone="bad" title="Run failed — not silent" detail={selected.error ?? undefined} /></div>}
          {ans?.headline && <p className="mt-4 text-lg font-semibold leading-snug">{ans.headline}</p>}
          {ans?.charts && ans.charts.length > 0 && (
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              {ans.charts.map((c, i) => <ChartView key={i} chart={c} />)}
            </div>
          )}
          {ans?.sections?.map((s, i) => (
            <div key={i} className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-ink-800">
              <div className="text-sm font-semibold">Q: {s.question}</div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600 dark:text-ink-300">{s.answer.summary}</p>
              {s.answer.charts.length > 0 && (
                <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {s.answer.charts.map((c, j) => <ChartView key={j} chart={c} />)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
