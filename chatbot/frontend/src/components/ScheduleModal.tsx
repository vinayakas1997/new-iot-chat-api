import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { type Schedule, type ScheduleInput, cronToTime, tzShort } from "../lib/rag-api";
import { Btn } from "./ui";

const TIMEZONES = ["Asia/Kolkata", "UTC", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York"];

const inp = "mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-ink-700";

export function ScheduleModal({
  open,
  schedule,
  lines,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  schedule: Schedule | null;
  lines: { id: string; name: string }[];
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: ScheduleInput, id?: string) => void;
}) {
  const editing = !!schedule;
  const [name, setName] = useState("");
  const [lineId, setLineId] = useState("");
  const [questions, setQuestions] = useState("");
  const [format, setFormat] = useState<Schedule["format"]>("headline");
  const [time, setTime] = useState("08:30");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!open) return;
    if (schedule) {
      setName(schedule.name);
      setLineId(schedule.lineId);
      setQuestions(schedule.questions.join("\n"));
      setFormat(schedule.format);
      setTime(cronToTime(schedule.cron) ?? "08:30");
      setTimezone(schedule.timezone);
      setEnabled(schedule.enabled);
    } else {
      setName("");
      setLineId(lines[0]?.id ?? "");
      setQuestions("");
      setFormat("headline");
      setTime("08:30");
      setTimezone("Asia/Kolkata");
      setEnabled(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, schedule]);

  if (!open) return null;

  function submit() {
    const qs = questions.split("\n").map((s) => s.trim()).filter(Boolean);
    onSubmit({ name: name.trim(), lineId, questions: qs, format, time, timezone, enabled }, schedule?.id);
  }

  const valid = name.trim() && lineId && questions.split("\n").some((s) => s.trim());

  return (
    <div className="anim-fade-in fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="anim-pop-in max-h-[90vh] w-[34rem] overflow-auto rounded-xl bg-white p-6 dark:bg-ink-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold">{editing ? "Edit job" : "New job"}</h2>
            <p className="mt-0.5 text-xs text-slate-500">line + questions + format, run daily at the chosen time</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-ink-800"><X size={18} /></button>
        </div>

        {error && <div className="mt-3 rounded-lg border border-state-bad/30 bg-state-bad/10 px-3 py-2 text-sm text-state-bad">{error}</div>}

        <div className="mt-4 flex flex-col gap-3">
          <label className="block text-xs">Name<span className="text-state-bad"> *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Morning ops brief" className={inp} />
          </label>
          <label className="block text-xs">Line<span className="text-state-bad"> *</span>
            <select value={lineId} onChange={(e) => setLineId(e.target.value)} className={inp}>
              {lines.map((l) => <option key={l.id} value={l.id}>{l.id} — {l.name}</option>)}
            </select>
          </label>
          <label className="block text-xs">Questions (one per line)<span className="text-state-bad"> *</span>
            <textarea
              rows={4}
              value={questions}
              onChange={(e) => setQuestions(e.target.value)}
              placeholder={"OEE yesterday?\nTop 3 downtime reasons?\nScrap % vs target?"}
              className={`${inp} font-mono`}
            />
          </label>
          <div className="flex gap-3">
            <label className="block flex-1 text-xs">Format
              <select value={format} onChange={(e) => setFormat(e.target.value as Schedule["format"])} className={inp}>
                <option value="headline">Headline + bullets</option>
                <option value="kpi">KPI cards</option>
                <option value="table">Table</option>
              </select>
            </label>
            <label className="block text-xs">Time
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={`${inp} tnum`} />
            </label>
            <label className="block flex-1 text-xs">Timezone
              <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={inp}>
                {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tzShort(tz)} — {tz}</option>)}
              </select>
            </label>
          </div>
          {editing && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              enabled
            </label>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-ink-800">cancel</button>
          <Btn variant="primary" onClick={submit} disabled={!valid || saving}>{saving ? "saving…" : editing ? "Save changes" : "Create job"}</Btn>
        </div>
      </div>
    </div>
  );
}
