import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';

type Entry = { id: string; source: 'chat' | 'report'; question: string; answer: string; createdAt: string };
type SourceFilter = 'all' | 'chat' | 'report';

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
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [source, setSource] = useState<SourceFilter>('all');
  const [page, setPage] = useState(1);
  const perPage = 6;

  useEffect(() => {
    api.historyDays().then((r) => setDays(new Set(r.days)));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    const from = new Date(selected + 'T00:00:00');
    const to = new Date(from.getTime() + 86400_000);
    api.history(from.toISOString(), to.toISOString()).then((rows) => {
      setEntries(rows as Entry[]);
      setLoading(false);
      setPage(1);
    }).catch(() => setLoading(false));
  }, [selected]);

  const cells = useMemo(() => monthMatrix(cursor.y, cursor.m), [cursor]);
  const label = new Date(cursor.y, cursor.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const iso = (d: number) => `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const filtered = entries.filter((e) => {
    if (source !== 'all' && e.source !== source) return false;
    if (q.trim()) {
      const qq = q.toLowerCase();
      return e.question.toLowerCase().includes(qq) || e.answer.toLowerCase().includes(qq);
    }
    return true;
  });
  const paged = filtered.slice((page - 1) * perPage, page * perPage);
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));

  return (
    <div className="card flex h-full flex-col overflow-hidden p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-bold">History</h2>
        <div className="flex items-center gap-2">
          <button className="btn !py-1" onClick={() => setCursor((c) => ({ y: c.m ? c.y : c.y - 1, m: (c.m + 11) % 12 }))}>‹</button>
          <span className="muted w-36 text-center text-[13px]">{label}</span>
          <button className="btn !py-1" onClick={() => setCursor((c) => ({ y: c.m === 11 ? c.y + 1 : c.y, m: (c.m + 1) % 12 }))}>›</button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {['S','M','T','W','T','F','S'].map((d,i) => <div key={i} className="muted pb-1 text-center text-[11px]">{d}</div>)}
        {cells.map((d,i) => {
          const has = d != null && days.has(iso(d));
          const isSel = d != null && selected === iso(d);
          return (
            <button key={i} disabled={d == null} onClick={() => d != null && setSelected(iso(d))}
              className="relative aspect-square rounded-lg text-[12px] transition"
              style={{ background: isSel ? 'var(--accent)' : d ? 'var(--surface-2)' : 'transparent', color: isSel ? 'var(--accent-ink)' : 'var(--ink)', border: d ? '1px solid var(--line)' : 'none' }}>
              {d ?? ''}
              {has && !isSel && <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full" style={{ background: 'var(--accent)' }} />}
            </button>
          );
        })}
      </div>

      {/* controls */}
      <div className="mt-3 flex flex-wrap gap-2">
        <input className="input flex-1 min-w-[140px] !py-1 text-[12px]" placeholder="Search question/answer…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <div className="flex rounded-full border p-1 text-[11px]" style={{ borderColor: 'var(--line)' }}>
          {(['all','chat','report'] as const).map((s) => (
            <button key={s} onClick={() => { setSource(s); setPage(1); }} className={`rounded-full px-2 py-1 capitalize ${source===s ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : ''}`}>{s}</button>
          ))}
        </div>
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        {!selected && <div className="muted rounded-xl border border-dashed p-4 text-center text-[13px]" style={{ borderColor: 'var(--line)' }}>Pick a day to see what was asked and answered.<br /><span className="text-[11px]">Dots mark days with entries. Use search & filters above.</span></div>}
        {selected && loading && <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl" style={{ background: 'var(--line)', opacity: 0.5 }} />)}</div>}
        {selected && !loading && filtered.length === 0 && <div className="muted text-[13px]">{entries.length===0 ? `Nothing on ${selected}.` : `No matches for "${q}" in ${source}.`}</div>}
        {!loading && paged.length > 0 && (
          <>
            <ul className="space-y-2">
              {paged.map((e) => (
                <motion.li key={e.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border p-3" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: e.source === 'report' ? 'var(--ok)' : 'var(--line)', color: e.source === 'report' ? '#fff' : 'var(--ink-soft)' }}>{e.source}</span>
                    <span className="muted text-[11px]">{new Date(e.createdAt).toLocaleTimeString()} · {new Date(e.createdAt).toLocaleDateString()}</span>
                  </div>
                  <div className="text-[13px] font-semibold">{e.question}</div>
                  <div className="mt-1 whitespace-pre-wrap text-[12.5px] leading-[1.5]">{e.answer.slice(0, 900)}{e.answer.length>900 ? '…' : ''}</div>
                </motion.li>
              ))}
            </ul>
            {totalPages > 1 && (
              <div className="mt-3 flex items-center justify-center gap-2 text-[12px]">
                <button className="btn !py-1" disabled={page<=1} onClick={() => setPage((p) => Math.max(1, p-1))}>Prev</button>
                <span className="muted">Page {page} / {totalPages} · {filtered.length} items</span>
                <button className="btn !py-1" disabled={page>=totalPages} onClick={() => setPage((p) => Math.min(totalPages, p+1))}>Next</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
