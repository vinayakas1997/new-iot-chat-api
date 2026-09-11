import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { api, type Me } from './lib/api.js';
import { useTheme, type Theme } from './theme.js';
import { Login } from './views/Login.js';
import { Chat } from './views/Chat.js';
import { Schedules } from './views/Schedules.js';
import { History } from './views/History.js';

type Tab = 'chat' | 'schedule' | 'history';

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('chat');
  const { theme, setTheme } = useTheme();
  const [schedulePrefill, setSchedulePrefill] = useState<string | null>(null);

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

  if (me === undefined) return <div className="grid h-full place-items-center muted">Loading…</div>;
  if (me === null) return <Login onDone={() => api.me().then(setMe)} />;

  const cycleTheme = async () => {
    const order: Theme[] = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(theme) + 1) % order.length]!;
    setTheme(next);
    await api.setTheme(next).catch(() => {});
  };

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col px-4">
      <header className="header-glass -mx-4 flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2 text-[15px] font-bold tracking-tight" style={{ transform: 'translateZ(6px)' }}>
          <span className="grid h-7 w-7 place-items-center rounded-lg text-[12px] font-black flash" style={{ background: 'var(--accent)', color: 'var(--accent-ink)', boxShadow: '0 8px 20px var(--accent-glow)' }}>LA</span>
          Line Assistant
          <span className="hidden rounded-full border px-2 py-0.5 text-[10px] font-semibold sm:inline" style={{ borderColor: 'var(--glass-border)', color: 'var(--ink-soft)', background: 'color-mix(in srgb, var(--surface) 60%, transparent)', backdropFilter: 'blur(6px)' }}>RAG · mock · 3D</span>
        </div>
        <nav className="flex items-center gap-1">
          {(['chat', 'schedule', 'history'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`btn relative ${tab === t ? '!bg-[var(--accent)] !text-[var(--accent-ink)] !border-transparent flash' : ''}`}
              style={tab === t ? { boxShadow: '0 10px 24px var(--accent-glow)' } : undefined}
            >
              {t[0]!.toUpperCase() + t.slice(1)}
              {tab === t && <motion.span layoutId="activeTab" className="absolute inset-0 -z-10 rounded-[10px]" style={{ background: 'var(--accent)' }} transition={{ type: 'spring', stiffness: 420, damping: 28 }} />}
            </button>
          ))}
          <button className="btn" onClick={cycleTheme} title={`theme: ${theme}`}>
            {theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🖥️'}
          </button>
          <button
            className="btn"
            onClick={async () => {
              await api.logout();
              setMe(null);
            }}
          >
            Sign out
          </button>
        </nav>
      </header>

      {/* scroll shimmer line */}
      <motion.div className="pointer-events-none -mx-4 h-[1px] origin-left" style={{ background: 'linear-gradient(90deg, transparent, var(--accent), transparent)', scaleX: 0 }} initial={{ scaleX: 0 }} animate={{ scaleX: 0 }} />
      <main className="scene min-h-0 flex-1 pb-6 pt-3" style={{ transformStyle: 'preserve-3d' }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 14, rotateX: 2 }}
            animate={{ opacity: 1, y: 0, rotateX: 0 }}
            exit={{ opacity: 0, y: -10, rotateX: -1 }}
            transition={{ duration: 0.26, ease: [0.2, 0.8, 0.2, 1] as any }}
            className="h-full"
            style={{ transformOrigin: 'center top' }}
          >
            {tab === 'chat' && <Chat onScheduleThis={handleScheduleThis} />}
            {tab === 'schedule' && <Schedules prefill={schedulePrefill} onPrefillConsumed={() => setSchedulePrefill(null)} />}
            {tab === 'history' && <History />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
