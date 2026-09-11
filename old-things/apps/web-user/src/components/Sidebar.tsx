/**
 * Sidebar — adopted from DB-GPT's clean navigation IA, rebuilt in our stack.
 *
 * DB-GPT sources (layout ideas only — no antd/Next code):
 *  - web/components/layout/side-bar.tsx (SideBar: collapsible 240px rail, logo row,
 *    New-Task button, nav functions, conversation list, bottom settings row)
 *  - web/pages/_app.tsx LayoutWrapper (flex h-screen: sidebar + content column)
 *  - web/pages/conversations/index.tsx (searchable history list pattern)
 *
 * Ours: Tailwind + CSS vars + inline SVG icons. Sections:
 *  logo + collapse | New chat | nav (Chat/Schedules/History) | Recent | bottom.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export type NavTab = 'chat' | 'schedule' | 'history';

interface RecentItem {
  id: string;
  day: string;
  question: string;
  createdAt: string;
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

const I = {
  chat: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
  ),
  schedule: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
  ),
  history: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
  ),
  plus: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
  ),
  collapse: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
  ),
  expand: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
  ),
  msg: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
  ),
};

interface Props {
  tab: NavTab;
  onNav: (t: NavTab) => void;
  onNewChat: () => void;
  onOpenDay: (day: string) => void;
  expanded: boolean;
  onToggleExpand: () => void;
  username: string;
  themeIcon: string;
  onCycleTheme: () => void;
  onSignOut: () => void;
  /** Bumped whenever a chat answer completes — refreshes Recent. */
  activityTick: number;
}

const NAV: { id: NavTab; label: string; icon: keyof typeof I }[] = [
  { id: 'chat', label: 'Chat', icon: 'chat' },
  { id: 'schedule', label: 'Schedules', icon: 'schedule' },
  { id: 'history', label: 'History', icon: 'history' },
];

export function Sidebar(p: Props) {
  const [recent, setRecent] = useState<RecentItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { days } = await api.historyDays();
        const sorted = [...days].sort().reverse().slice(0, 2);
        const items: RecentItem[] = [];
        for (const day of sorted) {
          const from = new Date(day + 'T00:00:00');
          const to = new Date(from.getTime() + 86400_000);
          const rows = await api.history(from.toISOString(), to.toISOString());
          for (const r of rows.slice(0, 7 - items.length)) {
            items.push({ id: r.id, day, question: r.question, createdAt: r.createdAt });
          }
          if (items.length >= 7) break;
        }
        items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        if (!cancelled) setRecent(items);
      } catch {
        if (!cancelled) setRecent([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [p.activityTick, p.tab]);

  const W = p.expanded ? 'w-60 min-w-[240px]' : 'w-16 min-w-[64px]';

  return (
    <aside
      className={`flex h-full flex-col overflow-hidden border-r transition-[width] duration-200 ${W} hidden md:flex`}
      style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}
    >
      {/* logo row */}
      <div className={`flex items-center ${p.expanded ? 'justify-between px-4' : 'justify-center'} pt-4`}>
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[12px] font-black" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>LA</span>
          {p.expanded && <span className="text-[14px] font-bold tracking-tight">Line Assistant</span>}
        </div>
        {p.expanded && (
          <button onClick={p.onToggleExpand} title="Collapse sidebar" className="rounded-md p-1.5 muted transition hover:opacity-100" style={{ opacity: 0.6 }}>
            {I.collapse}
          </button>
        )}
      </div>

      {/* new chat */}
      <div className={`${p.expanded ? 'px-4' : 'px-2'} pt-4`}>
        <button
          onClick={p.onNewChat}
          title="New chat"
          className="flex w-full items-center justify-center gap-2 rounded-xl border-0 py-2.5 text-[13.5px] font-semibold transition hover:opacity-90"
          style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
        >
          {I.plus}
          {p.expanded && 'New chat'}
        </button>
      </div>

      {/* nav */}
      <nav className={`${p.expanded ? 'px-2' : 'px-2'} space-y-0.5 pt-4`}>
        {NAV.map((n) => {
          const active = p.tab === n.id;
          return (
            <button
              key={n.id}
              onClick={() => p.onNav(n.id)}
              title={n.label}
              className={`flex h-11 w-full items-center gap-3 rounded-xl text-[13.5px] transition ${p.expanded ? 'px-4' : 'justify-center px-0'}`}
              style={
                active
                  ? { background: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--accent)', fontWeight: 700 }
                  : { color: 'var(--ink-soft)', fontWeight: 500 }
              }
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 6%, transparent)';
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.background = 'transparent';
              }}
            >
              {I[n.icon]}
              {p.expanded && n.label}
            </button>
          );
        })}
      </nav>

      {/* recent */}
      <div className="flex min-h-0 flex-1 flex-col pt-4">
        {p.expanded ? (
          <>
            <div className="px-5 pb-1 text-[11px] font-bold uppercase tracking-wider muted">Recent</div>
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
              {recent.length === 0 && <div className="px-3 py-2 text-[12px] muted">No conversations yet.</div>}
              {recent.map((r) => (
                <button
                  key={r.id}
                  onClick={() => p.onOpenDay(r.day)}
                  className="group flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition"
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 6%, transparent)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <span className="mt-1 shrink-0 muted">{I.msg}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-medium leading-5">{r.question}</span>
                    <span className="block text-[11px] muted">{relTime(r.createdAt)}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-1 pt-2">
            {recent.slice(0, 4).map((r) => (
              <button key={r.id} onClick={() => p.onOpenDay(r.day)} title={r.question} className="rounded-lg p-2.5 muted transition hover:opacity-100" style={{ opacity: 0.7 }}>
                {I.msg}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* bottom */}
      <div className="border-t px-2 py-3" style={{ borderColor: 'var(--line)' }}>
        {!p.expanded && (
          <button onClick={p.onToggleExpand} title="Expand sidebar" className="mx-auto mb-1 flex rounded-md p-1.5 muted transition hover:opacity-100" style={{ opacity: 0.6 }}>
            {I.expand}
          </button>
        )}
        <div className={`flex items-center ${p.expanded ? 'justify-between px-2' : 'flex-col gap-2'}`}>
          <button onClick={p.onCycleTheme} title="Theme" className="rounded-lg p-2 text-[15px] transition hover:opacity-80">
            {p.themeIcon}
          </button>
          {p.expanded ? (
            <div className="flex min-w-0 items-center gap-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold" style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}>
                {p.username.slice(0, 1).toUpperCase()}
              </span>
              <span className="truncate text-[12.5px] font-semibold">{p.username}</span>
              <button onClick={p.onSignOut} title="Sign out" className="shrink-0 rounded-md p-1.5 muted transition hover:opacity-100" style={{ opacity: 0.7 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
              </button>
            </div>
          ) : (
            <button onClick={p.onSignOut} title={`Sign out (${p.username})`} className="rounded-lg p-2 muted transition hover:opacity-100" style={{ opacity: 0.7 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
