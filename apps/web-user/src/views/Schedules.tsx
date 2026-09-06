import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { Schedule } from '@app/shared';
import { api } from '../lib/api.js';

export function Schedules() {
  const [list, setList] = useState<Schedule[]>([]);
  const [msg, setMsg] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => api.schedules().then((r) => setList(r.schedules));
  useEffect(() => {
    refresh();
  }, []);

  const doPreview = async () => {
    setErr(null);
    if (!msg.trim()) return;
    try {
      const r = await api.previewSchedule(msg.trim());
      setPreview(r.humanCron);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.createSchedule(msg.trim());
      setMsg('');
      setPreview(null);
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card h-full overflow-y-auto p-5">
      <h2 className="mb-1 text-[15px] font-bold">Scheduled reports</h2>
      <p className="muted mb-4 text-[13px]">
        Describe it in plain words — e.g. “send me line-3 OEE every weekday at 8:15am”.
      </p>

      <div className="mb-2 flex gap-2">
        <input
          className="input"
          value={msg}
          placeholder="Describe a report and when to run it…"
          onChange={(e) => {
            setMsg(e.target.value);
            setPreview(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && doPreview()}
        />
        <button className="btn" onClick={doPreview} disabled={!msg.trim()}>
          Preview
        </button>
        <button className="btn btn-primary" onClick={save} disabled={busy || !msg.trim()}>
          Save
        </button>
      </div>
      {preview && (
        <div className="muted mb-3 text-[13px]">
          Will run: <span style={{ color: 'var(--ink)' }}>{preview}</span>
        </div>
      )}
      {err && <div className="mb-3 text-[13px]" style={{ color: 'var(--warn)' }}>{err}</div>}

      <ul className="mt-4 space-y-2">
        {list.map((s) => (
          <motion.li
            key={s.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between rounded-xl border p-3"
            style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}
          >
            <div className="min-w-0">
              <div className="truncate text-[13.5px] font-semibold">{s.queryText}</div>
              <div className="muted text-[12px]">
                {s.recurrence} · {s.timeOfDay} {s.timezone}
                {s.nextRunAt ? ` · next ${new Date(s.nextRunAt).toLocaleString()}` : ''}
                {s.lastResult ? ` · last: ${s.lastResult}` : ''}
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <button
                className="btn"
                onClick={async () => {
                  await api.toggleSchedule(s.id, !s.active);
                  refresh();
                }}
              >
                {s.active ? 'Pause' : 'Resume'}
              </button>
              <button
                className="btn"
                onClick={async () => {
                  await api.deleteSchedule(s.id);
                  refresh();
                }}
              >
                Delete
              </button>
            </div>
          </motion.li>
        ))}
        {list.length === 0 && <li className="muted text-[13px]">No scheduled reports yet.</li>}
      </ul>
    </div>
  );
}
