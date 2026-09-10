/**
 * LinePicker — searchable multi-select for chat scope, rendered above the composer.
 * Empty selection = all active lines (server-side default). Persisted in localStorage.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LineEntry } from '@app/shared';
import { api } from '../lib/api.js';

const STORE_KEY = 'la-line-ids';

export function loadStoredLineIds(): string[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function LinePicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [lines, setLines] = useState<LineEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    api.lines().then((r) => setLines(r.lines)).catch(() => setLines([]));
  }, []);

  // Drop stored ids that no longer exist.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (!lines.length) return;
    const valid = new Set(lines.map((l) => l.name));
    const kept = selected.filter((s) => valid.has(s));
    if (kept.length !== selected.length) onChangeRef.current(kept);
  }, [lines]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return lines;
    return lines.filter(
      (l) => l.name.toLowerCase().includes(needle) || (l.displayName ?? '').toLowerCase().includes(needle),
    );
  }, [lines, q]);

  const toggle = (name: string) => {
    onChange(selected.includes(name) ? selected.filter((s) => s !== name) : [...selected, name]);
  };

  const label = selected.length === 0 ? 'All lines' : selected.length === 1 ? selected[0]! : `${selected.length} lines`;

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setOpen((o) => !o)}
          title="Pick lines to ask about (empty = all lines)"
          className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition hover:opacity-80"
          style={{ borderColor: 'var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></svg>
          {label}
          <span className="muted text-[10px]">{open ? '▲' : '▼'}</span>
        </button>
        {selected.length > 0 && (
          <button onClick={() => onChange([])} title="Reset to all lines" className="muted text-[11px] underline underline-offset-2">
            reset
          </button>
        )}
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full z-40 mb-2 w-64 overflow-hidden rounded-xl border" style={{ borderColor: 'var(--line)', background: 'var(--surface)', boxShadow: 'var(--shadow-md)' }}>
            <div className="border-b p-2" style={{ borderColor: 'var(--line)' }}>
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Find a line…"
                className="input !py-1.5 !text-[12.5px]"
              />
            </div>
            <div className="max-h-52 overflow-y-auto p-1.5">
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] transition hover:opacity-80" style={{ background: selected.length === 0 ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : undefined }}>
                <input type="checkbox" checked={selected.length === 0} onChange={() => onChange([])} className="h-3.5 w-3.5 accent-[var(--accent)]" />
                <span className="font-semibold">All lines</span>
              </label>
              {filtered.map((l) => (
                <label key={l.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] transition hover:opacity-80">
                  <input type="checkbox" checked={selected.includes(l.name)} onChange={() => toggle(l.name)} className="h-3.5 w-3.5 accent-[var(--accent)]" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{l.displayName || l.name}</span>
                    {l.displayName && <span className="muted block truncate text-[11px]">{l.name}</span>}
                  </span>
                </label>
              ))}
              {filtered.length === 0 && <div className="muted px-2.5 py-2 text-[12px]">No lines match “{q}”.</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
