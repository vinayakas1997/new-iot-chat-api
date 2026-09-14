import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { ragApi, cronToTime, type Schedule, type ScheduleInput } from "../lib/rag-api";
import { Banner, Btn } from "../components/ui";
import { ScheduleCard } from "../components/ScheduleCard";
import { ScheduleModal } from "../components/ScheduleModal";
import { ScheduleDetail } from "../components/ScheduleDetail";

export function Schedules() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Schedule[]>([]);
  const [lines, setLines] = useState<{ id: string; name: string }[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Schedule | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      setItems(await ragApi.schedules());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    ragApi.lines().then((r) => setLines(Array.isArray(r) ? r : r.lines ?? [])).catch(() => {});
  }, []);

  function openCreate() {
    setEditing(null);
    setFormError(null);
    setModalOpen(true);
  }
  function openEdit(s: Schedule) {
    setEditing(s);
    setFormError(null);
    setModalOpen(true);
    setDetail(null);
  }

  async function submit(input: ScheduleInput, id?: string) {
    setSaving(true);
    setFormError(null);
    try {
      if (id) await ragApi.updateSchedule(id, input);
      else await ragApi.createSchedule(input);
      setModalOpen(false);
      setEditing(null);
      await refresh();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function runNow(id: string) {
    setBusyId(id);
    try {
      await ragApi.runSchedule(id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function toggle(s: Schedule) {
    await ragApi.toggleSchedule(s.id, !s.enabled).catch((e) => setError((e as Error).message));
    await refresh();
  }

  async function duplicate(s: Schedule) {
    const time = cronToTime(s.cron) ?? "08:30";
    await ragApi.createSchedule({
      name: `${s.name} (copy)`,
      lineId: s.lineId,
      questions: s.questions,
      format: s.format,
      time,
      timezone: s.timezone,
    }).catch((e) => setError((e as Error).message));
    await refresh();
  }

  function remove(s: Schedule) {
    if (!window.confirm(`Delete "${s.name}" and its stored briefings?`)) return;
    void ragApi.deleteSchedule(s.id).then(refresh).catch((e) => setError((e as Error).message));
  }

  const filtered = items.filter((s) => `${s.name} ${s.lineId}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Which briefings run on a schedule?</h1>
          <p className="mt-1 text-sm text-slate-500">
            {items.length} job{items.length === 1 ? "" : "s"} · each one: line + questions + format, run unattended
          </p>
        </div>
        <Btn variant="primary" onClick={openCreate}><Plus size={15} /> New job</Btn>
      </div>

      {error && <div className="mt-4"><Banner tone="bad" title="Something went wrong" detail={error} /></div>}

      {items.length > 0 && (
        <div className="relative mt-5 w-80 max-w-full">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search jobs by name or line…"
            className="w-full rounded-lg border border-slate-300 bg-transparent py-2 pl-9 pr-3 text-sm focus:border-accent-500 focus:outline-none dark:border-ink-700"
          />
        </div>
      )}

      {loading ? (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-44 animate-pulse rounded-xl border border-slate-200 bg-slate-100 dark:border-ink-800 dark:bg-ink-900" />
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((s) => (
            <ScheduleCard
              key={s.id}
              schedule={s}
              busy={busyId === s.id}
              onOpen={() => setDetail(s)}
              onRun={() => void runNow(s.id)}
              onToggle={() => void toggle(s)}
              onEdit={() => openEdit(s)}
              onDuplicate={() => void duplicate(s)}
              onDelete={() => remove(s)}
            />
          ))}
        </div>
      ) : items.length > 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400 dark:border-ink-700">
          No jobs match "{q}".
        </div>
      ) : (
        <div className="mt-6 rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-ink-700">
          <div className="text-sm font-semibold text-slate-500 dark:text-ink-300">No jobs yet</div>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">
            Create an 8:30 briefing: pick a line, list the questions, choose a format. The AI runs it unattended and stores the result in Briefings.
          </p>
          <div className="mt-4 flex justify-center"><Btn variant="primary" onClick={openCreate}><Plus size={15} /> Create your first job</Btn></div>
        </div>
      )}

      <ScheduleModal
        open={modalOpen}
        schedule={editing}
        lines={lines}
        saving={saving}
        error={formError}
        onClose={() => setModalOpen(false)}
        onSubmit={(input, id) => void submit(input, id)}
      />

      {detail && (
        <ScheduleDetail
          schedule={detail}
          busy={busyId === detail.id}
          onClose={() => setDetail(null)}
          onRun={() => void runNow(detail.id)}
          onOpenBriefings={() => navigate("/rag/briefings")}
        />
      )}
    </div>
  );
}
