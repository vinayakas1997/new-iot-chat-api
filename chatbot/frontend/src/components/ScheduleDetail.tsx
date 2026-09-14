import { useEffect, useState } from "react";
import { X, Play, ExternalLink } from "lucide-react";
import { ragApi, type Report, type Schedule, cronToTime, tzShort, relTime } from "../lib/rag-api";
import { Chip } from "./ui";

export function ScheduleDetail({
  schedule,
  onClose,
  onRun,
  onOpenBriefings,
  busy,
}: {
  schedule: Schedule;
  onClose: () => void;
  onRun: () => void;
  onOpenBriefings: () => void;
  busy: boolean;
}) {
  const [reports, setReports] = useState<Report[]>([]);
  const time = cronToTime(schedule.cron);
  const scheduleLabel = time ? `daily ${time} ${tzShort(schedule.timezone)}` : schedule.cron;

  useEffect(() => {
    ragApi.reports({ scheduleId: schedule.id }).then((r) => setReports(r.slice(0, 6))).catch(() => setReports([]));
  }, [schedule.id]);

  return (
    <div className="anim-fade-in fixed inset-0 z-20 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="anim-slide-in-right flex h-full w-[28rem] max-w-full flex-col overflow-auto border-l border-slate-200 bg-white p-6 dark:border-ink-800 dark:bg-ink-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold">{schedule.name}</h2>
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
              <span className="font-mono">{schedule.lineId}</span>
              <span>·</span>
              <span className="tnum">{scheduleLabel}</span>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-ink-800"><X size={18} /></button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Chip tone={schedule.enabled ? "ok" : "mute"}>{schedule.enabled ? "enabled" : "paused"}</Chip>
          <Chip tone="accent">{schedule.format}</Chip>
          {schedule.nextRun && schedule.enabled && <Chip>next {relTime(schedule.nextRun)}</Chip>}
        </div>

        <div className="mt-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Questions</div>
          <ol className="mt-2 flex flex-col gap-1.5">
            {schedule.questions.map((q, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="tnum text-slate-400">{i + 1}.</span>
                <span>{q}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Recent runs</div>
            <button onClick={onOpenBriefings} className="inline-flex items-center gap-1 text-xs text-accent-500 hover:underline">
              open in Briefings <ExternalLink size={12} />
            </button>
          </div>
          <div className="mt-2 flex flex-col gap-1.5">
            {reports.map((r) => (
              <button
                key={r.id}
                onClick={onOpenBriefings}
                className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-xs transition-colors hover:bg-slate-50 dark:border-ink-800 dark:hover:bg-ink-800/60"
              >
                <Chip tone={r.ok ? "ok" : "bad"}>{r.ok ? "ok" : "failed"}</Chip>
                <span className="tnum text-slate-400">{new Date(r.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                <span className="tnum ml-auto text-slate-400">{relTime(r.at)}</span>
              </button>
            ))}
            {!reports.length && <div className="text-sm text-slate-400">No runs stored yet — hit Run now.</div>}
          </div>
        </div>

        <div className="mt-6 flex gap-2">
          <button
            onClick={onRun}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent-500/90 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-500 disabled:opacity-50"
          >
            <Play size={14} /> Run now
          </button>
        </div>
      </div>
    </div>
  );
}
