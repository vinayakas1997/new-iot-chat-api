import { Play, Pause, Pencil, Copy, Trash2, ChevronRight } from "lucide-react";
import { type Schedule, cronToTime, tzShort, relTime } from "../lib/rag-api";
import { Chip, IconBtn } from "./ui";

const FORMAT_LABEL: Record<Schedule["format"], string> = {
  headline: "Headline + bullets",
  kpi: "KPI cards",
  table: "Table",
};

export function ScheduleCard({
  schedule,
  onOpen,
  onRun,
  onToggle,
  onEdit,
  onDuplicate,
  onDelete,
  busy,
}: {
  schedule: Schedule;
  onOpen: () => void;
  onRun: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const time = cronToTime(schedule.cron);
  const scheduleLabel = time ? `daily ${time} ${tzShort(schedule.timezone)}` : schedule.cron;
  const lastTone = schedule.lastStatus === "ok" ? "ok" : schedule.lastStatus ? "bad" : "mute";

  return (
    <div
      onClick={onOpen}
      className="group flex cursor-pointer flex-col rounded-xl border border-slate-200 p-4 transition-colors hover:border-accent-500/40 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:border-ink-800 dark:hover:bg-ink-900/60"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1 truncate text-sm font-semibold">
            {schedule.name}
            <ChevronRight size={14} className="shrink-0 text-slate-400 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
            <span className="font-mono">{schedule.lineId}</span>
            <span>·</span>
            <span className="tnum">{scheduleLabel}</span>
          </div>
        </div>
        <Chip tone={schedule.enabled ? "ok" : "mute"}>{schedule.enabled ? "enabled" : "paused"}</Chip>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Chip tone="accent">{FORMAT_LABEL[schedule.format]}</Chip>
        <Chip>{schedule.questions.length} question{schedule.questions.length > 1 ? "s" : ""}</Chip>
        <Chip tone={lastTone}>last {schedule.lastStatus === "ok" ? "ok" : schedule.lastStatus ? "failed" : "never"}{schedule.lastRun ? ` · ${relTime(schedule.lastRun)}` : ""}</Chip>
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
        <span className="text-[10px] uppercase tracking-wider">next</span>
        <span className="tnum">{schedule.enabled ? (schedule.nextRun ? `${relTime(schedule.nextRun)} · ${new Date(schedule.nextRun).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : "—") : "paused"}</span>
      </div>

      <div className="mt-3 flex items-center gap-1 border-t border-slate-100 pt-2 dark:border-ink-800">
        <button
          onClick={(e) => { e.stopPropagation(); onRun(); }}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-accent-500 transition-colors hover:bg-accent-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 disabled:opacity-50"
        >
          <Play size={14} /> Run now
        </button>
        <div className="ml-auto flex items-center gap-0.5">
          <IconBtn title={schedule.enabled ? "Pause job" : "Resume job"} onClick={onToggle}>
            {schedule.enabled ? <Pause size={16} /> : <Play size={16} />}
          </IconBtn>
          <IconBtn title="Edit job" onClick={onEdit}>
            <Pencil size={15} />
          </IconBtn>
          <IconBtn title="Duplicate job" onClick={onDuplicate}>
            <Copy size={15} />
          </IconBtn>
          <IconBtn title="Delete job" tone="bad" onClick={onDelete}>
            <Trash2 size={15} />
          </IconBtn>
        </div>
      </div>
    </div>
  );
}
