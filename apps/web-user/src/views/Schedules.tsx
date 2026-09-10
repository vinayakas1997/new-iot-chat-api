import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { LineEntry, Schedule } from '@app/shared';
import { api } from '../lib/api.js';

export function Schedules({ prefill, onPrefillConsumed }: { prefill?: string | null; onPrefillConsumed?: () => void }) {
  const [list, setList] = useState<Schedule[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [lines, setLines] = useState<LineEntry[]>([]);

  // advanced create panel state
  const [open, setOpen] = useState(false);
  const [heading, setHeading] = useState('');
  const [lineId, setLineId] = useState(''); // '' = auto (extract from text)
  const [timeOfDay, setTimeOfDay] = useState('08:15');
  const [recurrence, setRecurrence] = useState<Schedule['recurrence']>('weekdays');
  const [queryText, setQueryText] = useState(''); // context for LLM
  const [testResult, setTestResult] = useState<{ humanCron: string; cronExpr: string; parsed: any } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = () => api.schedules().then((r) => setList(r.schedules));
  useEffect(() => { refresh(); }, []);
  useEffect(() => { api.lines().then((r) => setLines(r.lines)).catch(() => setLines([])); }, []);
  useEffect(() => {
    if (prefill) {
      setQueryText(prefill.slice(0, 400));
      setHeading(prefill.slice(0, 40));
      setOpen(true);
      onPrefillConsumed?.();
    }
  }, [prefill, onPrefillConsumed]);

  const doTest = async () => {
    setErr(null);
    setTesting(true);
    try {
      if (!queryText.trim()) throw new Error('Context required');
      if (!heading.trim()) throw new Error('Heading required');
      const r = await api.previewScheduleStructured({
        heading: heading.trim(),
        queryText: queryText.trim(),
        ...(lineId ? { lineId } : {}),
        timeOfDay,
        recurrence,
      });
      setTestResult(r as any);
    } catch (e) {
      setErr((e as Error).message);
      setTestResult(null);
    } finally {
      setTesting(false);
    }
  };

  const doCreate = async () => {
    setErr(null);
    setSaving(true);
    try {
      if (!heading.trim()) throw new Error('Heading required');
      if (!queryText.trim()) throw new Error('Context required');
      await api.createScheduleStructured({
        heading: heading.trim(),
        queryText: queryText.trim(),
        ...(lineId ? { lineId } : {}),
        timeOfDay,
        recurrence,
      });
      setHeading('');
      setLineId('');
      setQueryText('');
      setTestResult(null);
      setOpen(false);
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  /** Clone-per-line: duplicate this schedule's prompt+time, pick another line. */
  const cloneForLine = (s: Schedule) => {
    setHeading(((s as { heading?: string }).heading ?? '').slice(0, 120));
    setQueryText(s.queryText.slice(0, 400));
    setTimeOfDay(s.timeOfDay);
    setRecurrence(s.recurrence);
    setLineId('');
    setTestResult(null);
    setOpen(true);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="flex h-full flex-col gap-4">
      {/* header with +Create */}
      <div className="card card-glass flex items-center justify-between p-4" style={{ transform: 'translateZ(0)' }}>
        <div>
          <h2 className="text-[15px] font-bold">Scheduled reports</h2>
          <p className="muted text-[12px]">{list.length} schedule(s) · hourly supported · one line each</p>
        </div>
        <button onClick={() => setOpen((v) => !v)} className="btn btn-primary flash">
          {open ? 'Close' : '+ Create'}
        </button>
      </div>

      {/* advanced create panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            className="card card-raise p-5"
            style={{ transformStyle: 'preserve-3d' }}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[14px] font-bold">New schedule — advanced</h3>
              <span className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: 'var(--glass-border)', color: 'var(--ink-soft)' }}>Plant TZ · server default</span>
            </div>

            <div className="grid gap-3">
              <div>
                <label className="mb-1 block text-[12px] font-semibold">Heading</label>
                <input className="input input-glass" placeholder="e.g. Morning OEE digest" value={heading} onChange={(e) => setHeading(e.target.value)} maxLength={120} />
                <div className="muted mt-1 text-[11px]">{heading.length}/120</div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[12px] font-semibold">Line</label>
                  <select value={lineId} onChange={(e) => setLineId(e.target.value)} className="input input-glass">
                    <option value="">Auto (from text)</option>
                    {lines.map((l) => (
                      <option key={l.id} value={l.name}>{l.displayName || l.name}</option>
                    ))}
                  </select>
                  <div className="muted mt-1 text-[11px]">Same prompt for another line? Save, then Clone below.</div>
                </div>
                <div>
                  <label className="mb-1 block text-[12px] font-semibold">Time</label>
                  <input type="time" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} className="input input-glass" />
                  <div className="muted mt-1 text-[11px]">Hourly uses minute only (e.g. 08:15 → :15 each hour)</div>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-semibold">Frequency</label>
                <div className="flex flex-wrap gap-1">
                  {(['hourly','daily','weekdays','weekly','once'] as const).map((r) => (
                    <button key={r} onClick={() => setRecurrence(r as any)} className={`rounded-full border px-3 py-1.5 text-[12px] font-semibold transition ${recurrence===r ? 'bg-[var(--accent)] text-[var(--accent-ink)] border-transparent shadow' : 'bg-[var(--surface)]'}`} style={recurrence===r ? { boxShadow: '0 6px 16px var(--accent-glow)' } : { borderColor: 'var(--line)' }}>{r}</button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[12px] font-semibold">Context — what to send to LLM</label>
                <textarea className="input input-glass min-h-[90px] resize-y" placeholder="Describe the report content for the LLM — e.g. line-3 OEE, scrap rate, downtime summary to include in the report" value={queryText} onChange={(e) => setQueryText(e.target.value)} rows={3} />
                <div className="muted mt-1 text-[11px]">This context + time + frequency will be given to the LLM when the report runs.</div>
              </div>

              <div className="flex gap-2">
                <button onClick={doTest} disabled={testing || !heading.trim() || !queryText.trim()} className="btn btn-glass">
                  {testing ? 'Testing…' : 'Test'}
                </button>
                <button onClick={doCreate} disabled={saving || !heading.trim() || !queryText.trim()} className="btn btn-primary">
                  {saving ? 'Creating…' : 'Create'}
                </button>
              </div>

              {/* test space — LLM response */}
              {testResult && (
                <div className="rounded-xl border p-3 text-[12.5px]" style={{ borderColor: 'var(--glass-border)', background: 'color-mix(in srgb, var(--surface) 86%, transparent)', backdropFilter: 'blur(8px)' }}>
                  <div className="mb-1 font-semibold">LLM preview</div>
                  <div className="grid gap-1 text-[12px]">
                    <div><span className="muted">Heading:</span> {testResult.parsed?.heading ?? heading}</div>
                    <div><span className="muted">Context:</span> {testResult.parsed?.queryText ?? queryText}</div>
                    <div><span className="muted">Parsed:</span> <span className="rounded bg-[var(--line)] px-1.5 py-0.5 font-mono text-[11px]">{testResult.parsed?.recurrence} · {testResult.parsed?.timeOfDay} {testResult.parsed?.timezone}{testResult.parsed?.lineId ? ` · ${testResult.parsed.lineId}` : ''}</span></div>
                    <div><span className="muted">Cron:</span> <span className="font-mono text-[11px]">{testResult.cronExpr}</span> → <span className="font-semibold">{testResult.humanCron}</span></div>
                    <div className="muted text-[11px]">Correct heading / context / time / frequency above and press Test again. When it looks right, press Create.</div>
                  </div>
                </div>
              )}
              {err && <div className="rounded-lg border px-3 py-2 text-[13px]" style={{ color: 'var(--warn)', borderColor: 'color-mix(in srgb, var(--warn) 30%, transparent)', background: 'color-mix(in srgb, var(--warn) 10%, transparent)' }}>{err}</div>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* list */}
      <div className="card flex-1 overflow-y-auto p-4">
        <ul className="space-y-2">
          {list.map((s) => (
            <motion.li key={s.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between gap-2 rounded-xl border p-3 flash" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)', transform: 'translateZ(0)' }}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-semibold">{(s as any).heading ? `${(s as any).heading} — ${s.queryText}` : s.queryText}</div>
                <div className="muted flex flex-wrap gap-1 text-[11px]">
                  <span className="rounded-full border px-1.5 py-0.5 font-semibold" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>{s.lineId ?? 'default line'}</span>
                  <span className="rounded-full border px-1.5 py-0.5 font-semibold" style={{ borderColor: 'var(--line)' }}>{s.recurrence}</span>
                  <span className="rounded-full border px-1.5 py-0.5" style={{ borderColor: 'var(--line)' }}>{s.timeOfDay} {s.timezone}</span>
                  {s.cronExpr && <span className="rounded bg-[var(--line)] px-1.5 py-0.5 font-mono text-[10px]">{s.cronExpr}</span>}
                  {s.nextRunAt ? <span>· next {new Date(s.nextRunAt).toLocaleString(undefined, { timeZone: s.timezone })}</span> : null}
                  {s.lastResult ? <span>· last: {s.lastResult}</span> : null}
                  {!s.active && <span className="rounded bg-[var(--warn)] px-1.5 py-0.5 text-[10px] font-bold text-white">paused</span>}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <button className="btn !py-1 !text-[11px]" title="Duplicate this prompt+time for another line" onClick={() => cloneForLine(s)}>Clone</button>
                <button className="btn !py-1 !text-[11px]" onClick={async () => { await api.toggleSchedule(s.id, !s.active); refresh(); }}>{s.active ? 'Pause' : 'Resume'}</button>
                <button className="btn !py-1 !text-[11px]" onClick={async () => { await api.deleteSchedule(s.id); refresh(); }}>Delete</button>
              </div>
            </motion.li>
          ))}
          {list.length === 0 && <li className="muted rounded-xl border border-dashed p-6 text-center text-[13px]" style={{ borderColor: 'var(--line)' }}>No schedules yet — hit <span className="font-semibold">+ Create</span> above, pick a line, set heading + time + frequency + context, then Test → Create. Need the same prompt for another line? Use <span className="font-semibold">Clone</span>.</li>}
        </ul>
      </div>
    </div>
  );
}
