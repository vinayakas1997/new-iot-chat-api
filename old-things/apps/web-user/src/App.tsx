/**
 * App shell — full-height flex layout adopted from DB-GPT's clean IA.
 *
 * DB-GPT source (layout idea only):
 *  web/pages/_app.tsx LayoutWrapper: `flex w-screen h-screen` → sidebar + content column.
 * Ours: Sidebar component + slim header + per-view content (chat widest for dashboards).
 */
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { api, type Me } from './lib/api.js';
import { useTheme, type Theme } from './theme.js';
import { Login } from './views/Login.js';
import { Chat } from './views/Chat.js';
import { Schedules } from './views/Schedules.js';
import { History } from './views/History.js';
import { Sidebar, type NavTab } from './components/Sidebar.js';

const TITLES: Record<NavTab, { title: string; sub: string }> = {
  chat: { title: 'Chat', sub: 'Ask about OEE, downtime, scrap — answers come with charts' },
  schedule: { title: 'Schedules', sub: 'Per-user report times for the scheduler' },
  history: { title: 'History', sub: 'Past answers and reports, with graphs' },
};

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [tab, setTab] = useState<NavTab>('chat');
  const { theme, setTheme } = useTheme();
  const [schedulePrefill, setSchedulePrefill] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileNav, setMobileNav] = useState(false);
  const [chatResetKey, setChatResetKey] = useState(0);
  const [activityTick, setActivityTick] = useState(0);
  const [historyDay, setHistoryDay] = useState<{ day: string; n: number } | null>(null);
  const [mode, setMode] = useState<string>('…');

  const handleScheduleThis = (q: string, a: string) => {
    const msg = q ? `${q} — ${a.slice(0, 120)}` : a.slice(0, 180);
    setSchedulePrefill(msg.trim());
    setTab('schedule');
  };

  useEffect(() => {
    api.me().then(setMe, () => setMe(null));
  }, []);
  useEffect(() => {
    if (me?.theme) setTheme(me.theme);
  }, [me, setTheme]);
  useEffect(() => {
    api.opsHealth().then((h) => setMode(String((h as { status?: string }).status ?? 'mock'))).catch(() => setMode('mock'));
  }, []);

  if (me === undefined) return <div className="grid h-full place-items-center muted">Loading…</div>;
  if (me === null) return <Login onDone={() => api.me().then(setMe)} />;

  const cycleTheme = async () => {
    const order: Theme[] = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(theme) + 1) % order.length]!;
    setTheme(next);
    await api.setTheme(next).catch(() => {});
  };

  const openDay = (day: string) => {
    setHistoryDay((h) => ({ day, n: (h?.n ?? 0) + 1 }));
    setTab('history');
    setMobileNav(false);
  };

  const t = TITLES[tab];

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {sidebarOpen && (
        <Sidebar
          tab={tab}
          onNav={(nv) => {
            setTab(nv);
            setMobileNav(false);
          }}
          onNewChat={() => {
            setChatResetKey((k) => k + 1);
            setTab('chat');
            setMobileNav(false);
          }}
          onOpenDay={openDay}
          expanded
          onToggleExpand={() => setSidebarOpen(false)}
          username={me.username}
          themeIcon={theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🖥️'}
          onCycleTheme={cycleTheme}
          onSignOut={async () => {
            await api.logout();
            setMe(null);
          }}
          activityTick={activityTick}
        />
      )}
      {!sidebarOpen && (
        <div className="hidden w-16 min-w-[64px] flex-col items-center border-r py-4 md:flex" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
          <span className="grid h-8 w-8 place-items-center rounded-lg text-[12px] font-black" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>LA</span>
          <button onClick={() => setSidebarOpen(true)} title="Expand sidebar" className="mt-4 rounded-md p-1.5 muted transition hover:opacity-100" style={{ opacity: 0.6 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        </div>
      )}

      {/* mobile drawer */}
      <AnimatePresence>
        {mobileNav && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 md:hidden" style={{ background: 'rgba(0,0,0,0.35)' }} onClick={() => setMobileNav(false)}>
            <motion.div initial={{ x: -260 }} animate={{ x: 0 }} exit={{ x: -260 }} transition={{ type: 'spring', stiffness: 380, damping: 34 }} onClick={(e) => e.stopPropagation()} className="h-full">
              <Sidebar
                tab={tab}
                onNav={(nv) => {
                  setTab(nv);
                  setMobileNav(false);
                }}
                onNewChat={() => {
                  setChatResetKey((k) => k + 1);
                  setTab('chat');
                  setMobileNav(false);
                }}
                onOpenDay={openDay}
                expanded
                onToggleExpand={() => setMobileNav(false)}
                username={me.username}
                themeIcon={theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🖥️'}
                onCycleTheme={cycleTheme}
                onSignOut={async () => {
                  await api.logout();
                  setMe(null);
                }}
                activityTick={activityTick}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* content column */}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="header-glass flex items-center justify-between gap-2 px-4 py-2.5 md:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <button onClick={() => setMobileNav(true)} title="Menu" className="rounded-lg p-1.5 md:hidden" style={{ border: '1px solid var(--line)' }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
            </button>
            <div className="min-w-0">
              <div className="truncate text-[14.5px] font-bold leading-tight tracking-tight">{t.title}</div>
              <div className="muted hidden truncate text-[11.5px] sm:block">{t.sub}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="rounded-full border px-2 py-0.5 text-[10.5px] font-semibold" style={{ borderColor: 'var(--line)', color: 'var(--ink-soft)' }}>
              {mode === 'mock' ? 'mock data' : mode}
            </span>
            <button className="btn !px-2.5 !py-1 !text-[12px] md:hidden" onClick={cycleTheme} title={`theme: ${theme}`}>
              {theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🖥️'}
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden px-3 pb-4 pt-3 md:px-6">
          <div className={`mx-auto h-full w-full ${tab === 'chat' ? 'max-w-5xl' : 'max-w-4xl'}`}>
            <AnimatePresence mode="wait">
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                className="h-full"
              >
                {tab === 'chat' && (
                  <Chat key={chatResetKey} onScheduleThis={handleScheduleThis} onResponded={() => setActivityTick((n) => n + 1)} />
                )}
                {tab === 'schedule' && <Schedules prefill={schedulePrefill} onPrefillConsumed={() => setSchedulePrefill(null)} />}
                {tab === 'history' && <History initialDay={historyDay?.day ?? null} nonce={historyDay?.n ?? 0} />}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}
