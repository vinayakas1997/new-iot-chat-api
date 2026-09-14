import { useEffect, useState } from "react";
import { Play, Trash2 } from "lucide-react";
import { ragApi, type Schedule } from "../lib/rag-api";
import { Banner, Btn, Chip } from "../components/ui";

export function Schedules() {
  const [items, setItems] = useState<Schedule[]>([]);
  const [lines, setLines] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", lineId: "", questions: "", format: "headline" as Schedule["format"], time: "08:30" });

  async function refresh() {
    setItems(await ragApi.schedules().catch(() => []));
  }

  useEffect(() => {
    void refresh();
    ragApi.lines().then((r) => {
      const list = Array.isArray(r) ? r : r.lines ?? [];
      setLines(list);
      if (list.length && !form.lineId) setForm((f) => ({ ...f, lineId: list[0].id }));
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create() {
    setError(null);
    const questions = form.questions.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!form.name.trim() || !form.lineId || !questions.length) {
      setError("Name, line and at least one question are required.");
      return;
    }
    try {
      await ragApi.createSchedule({ name: form.name.trim(), lineId: form.lineId, questions, format: form.format, time: form.time });
      setForm({ name: "", lineId: form.lineId, questions: "", format: "headline", time: "08:30" });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Which briefings run every morning?</h1>
      <p className="mt-1 text-sm text-slate-500">8:30 jobs: line + questions + format — AI runs unattended, you read it in Briefings</p>
      {error && <div className="mt-3"><Banner tone="bad" title="Couldn't save" detail={error} /></div>}

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[22rem_1fr]">
        <div className="rounded-xl border border-slate-200 p-4 dark:border-ink-800">
          <div className="text-sm font-semibold">New 8:30 job</div>
          <label className="mt-3 block text-xs">Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Morning ops brief" className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-ink-700" /></label>
          <label className="mt-3 block text-xs">Line
            <select value={form.lineId} onChange={(e) => setForm({ ...form, lineId: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-ink-700">
              {lines.map((l) => <option key={l.id} value={l.id}>{l.id} — {l.name}</option>)}
            </select>
          </label>
          <label className="mt-3 block text-xs">Questions (one per line)
            <textarea rows={4} value={form.questions} onChange={(e) => setForm({ ...form, questions: e.target.value })} placeholder={"OEE yesterday?\nTop 3 downtime reasons?\nScrap % vs target?"} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent p-2 font-mono text-xs dark:border-ink-700" />
          </label>
          <div className="mt-3 flex gap-3">
            <label className="block flex-1 text-xs">Format
              <select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value as Schedule["format"] })} className="mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-ink-700">
                <option value="headline">Headline+bullets</option>
                <option value="kpi">KPI cards</option>
                <option value="table">Table</option>
              </select>
            </label>
            <label className="block text-xs">Time (IST)
              <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} className="tnum mt-1 rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-ink-700" />
            </label>
          </div>
          <div className="mt-4"><Btn variant="primary" onClick={() => void create()}>Save job</Btn></div>
        </div>

        <div>
          {items.map((s) => (
            <div key={s.id} className="mb-2 flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm dark:border-ink-800">
              <span className="font-semibold">{s.name}</span>
              <span className="font-mono text-xs text-slate-400">{s.lineId}</span>
              <span className="tnum text-xs text-slate-400">{s.cron}</span>
              <Chip tone={s.enabled ? "ok" : "mute"}>{s.enabled ? "enabled" : "paused"}</Chip>
              {s.lastStatus && <Chip tone={s.lastStatus === "ok" ? "ok" : "bad"}>{s.lastStatus.slice(0, 24)}</Chip>}
              <span className="tnum ml-auto text-xs text-slate-400">{s.questions.length} questions</span>
              <Btn onClick={() => void ragApi.runSchedule(s.id).then(() => void refresh())}><Play size={12} /> Run now</Btn>
              <Btn onClick={() => void ragApi.toggleSchedule(s.id, !s.enabled).then(() => void refresh())}>{s.enabled ? "Pause" : "Resume"}</Btn>
              <button onClick={() => void ragApi.deleteSchedule(s.id).then(() => void refresh())} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-ink-800" title="Delete"><Trash2 size={14} /></button>
            </div>
          ))}
          {!items.length && <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400 dark:border-ink-700">No jobs yet — create your first 8:30 briefing on the left.</div>}
        </div>
      </div>
    </div>
  );
}
