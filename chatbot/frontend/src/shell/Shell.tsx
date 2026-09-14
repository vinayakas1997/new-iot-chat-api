import { NavLink, Outlet } from "react-router-dom";
import { useState } from "react";

const NAV = [
  { to: "/rag/chat", n: "F6", label: "Chat" },
  { to: "/rag/schedules", n: "F7", label: "Schedules" },
  { to: "/rag/briefings", n: "F8", label: "Briefings" },
];

export function Shell() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
  }
  return (
    <div className="flex min-h-screen bg-white text-slate-900 dark:bg-ink-950 dark:text-ink-100">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 dark:border-ink-800">
        <div className="px-5 pb-2 pt-6">
          <div className="text-sm font-bold tracking-wide">RAG CONSOLE</div>
          <div className="text-xs text-slate-500 dark:text-ink-400">chat + briefings</div>
        </div>
        <nav className="flex flex-col gap-1 px-3 py-4">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive ? "bg-accent-500/15 font-semibold text-accent-500" : "text-slate-600 hover:bg-slate-100 dark:text-ink-300 dark:hover:bg-ink-800"
                }`
              }
            >
              <span className="tnum w-6 text-xs opacity-60">{item.n}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <a href="/setter/connections" className="mx-3 mt-2 rounded-lg px-3 py-2 text-xs text-slate-400 hover:bg-slate-100 dark:hover:bg-ink-800">
          ← back to ingestion setter
        </a>
        <div className="mt-auto px-5 py-4 text-xs text-slate-400">sole-user · no auth</div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 px-8 py-3 dark:border-ink-800">
          <div className="text-xs uppercase tracking-widest text-slate-400">rag plane · :3201</div>
          <button onClick={toggle} className="rounded-lg border border-slate-200 px-3 py-1 text-xs dark:border-ink-700">
            {dark ? "light" : "dark"}
          </button>
        </header>
        <main className="min-w-0 flex-1 px-8 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
