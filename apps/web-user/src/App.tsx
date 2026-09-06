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
      <header className="flex items-center justify-between py-4">
        <div className="text-[15px] font-bold tracking-tight">Line Assistant</div>
        <nav className="flex items-center gap-1">
          {(['chat', 'schedule', 'history'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="btn"
              style={
                tab === t
                  ? { background: 'var(--accent)', color: 'var(--accent-ink)', borderColor: 'transparent' }
                  : undefined
              }
            >
              {t[0]!.toUpperCase() + t.slice(1)}
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

      <main className="scene min-h-0 flex-1 pb-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="h-full"
          >
            {tab === 'chat' && <Chat />}
            {tab === 'schedule' && <Schedules />}
            {tab === 'history' && <History />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
