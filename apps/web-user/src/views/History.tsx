import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';

type Entry = { id: string; source: 'chat' | 'report'; question: string; answer: string; createdAt: string };

function monthMatrix(year: number, month: number) {
  const first = new Date(year, month, 1);
  const startDow = first.getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = Array.from({ length: startDow }, () => null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function History() {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [days, setDays] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    api.historyDays().then((r) => setDays(new Set(r.days)));
  }, []);

  useEffect(() => {
    if (!selected) return;
    const from = new Date(selected + 'T00:00:00');
    const to = new Date(from.getTime() + 86400_000);
    api.history(from.toISOString(), to.toISOString()).then(setEntries);
  }, [selected]);

  const cells = useMemo(() => monthMatrix(cursor.y, cursor.m), [cursor]);
  const label = new Date(cursor.y, cursor.m, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
  const iso = (d: number) =>
    `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  return (
    <div className="card grid h-full grid-rows-[auto_auto_1fr] overflow-hidden p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-bold">History</h2>
        <div className="flex items-center gap-2">
          <button
            className="btn"
            onClick={() => setCursor((c) => ({ y: c.m ? c.y : c.y - 1, m: (c.m + 11) % 12 }))}
          >
            ‹
          </button>
          <span className="muted w-36 text-center text-[13px]">{label}</span>
          <button
            className="btn"
            onClick={() => setCursor((c) => ({ y: c.m === 11 ? c.y + 1 : c.y, m: (c.m + 1) % 12 }))}
          >
            ›
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} className="muted pb-1 text-center text-[11px]">
            {d}
          </div>
        ))}
        {cells.map((d, i) => {
          const has = d != null && days.has(iso(d));
          const isSel = d != null && selected === iso(d);
          return (
            <button
              key={i}
              disabled={d == null}
              onClick={() => d != null && setSelected(iso(d))}
              className="relative aspect-square rounded-lg text-[12px]"
              style={{
                background: isSel ? 'var(--accent)' : d ? 'var(--surface-2)' : 'transparent',
                color: isSel ? 'var(--accent-ink)' : 'var(--ink)',
                border: d ? '1px solid var(--line)' : 'none',
              }}
            >
              {d ?? ''}
              {has && !isSel && (
                <span
                  className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full"
                  style={{ background: 'var(--accent)' }}
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-4 min-h-0 overflow-y-auto">
        {!selected && <div className="muted text-[13px]">Pick a day to see what was asked and answered.</div>}
        {selected && entries.length === 0 && (
          <div className="muted text-[13px]">Nothing on {selected}.</div>
        )}
        <ul className="space-y-2">
          {entries.map((e) => (
            <motion.li
              key={e.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border p-3"
              style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}
            >
              <div className="mb-1 flex items-center gap-2">
                <span
                  className="rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase"
                  style={{
                    background: e.source === 'report' ? 'var(--ok)' : 'var(--line)',
                    color: e.source === 'report' ? '#fff' : 'var(--ink-soft)',
                  }}
                >
                  {e.source}
                </span>
                <span className="muted text-[11px]">{new Date(e.createdAt).toLocaleTimeString()}</span>
              </div>
              <div className="text-[13px] font-semibold">{e.question}</div>
              <div className="mt-1 whitespace-pre-wrap text-[13px]">{e.answer}</div>
            </motion.li>
          ))}
        </ul>
      </div>
    </div>
  );
}
