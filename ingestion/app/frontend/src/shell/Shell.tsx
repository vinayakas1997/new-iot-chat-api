import { NavLink, Outlet } from "react-router-dom";
import { useState } from "react";
import { Brain, Database, History, Layers, LayoutTemplate, Radar, ScrollText } from "lucide-react";

const NAV = [
  { to: "/setter/connections", n: "F1", label: "Connections", Icon: Database },
  { to: "/setter/lines", n: "F2", label: "Register", Icon: Layers },
  { to: "/setter/cards", n: "F3", label: "Lines", Icon: LayoutTemplate },
  { to: "/setter/history", n: "F4", label: "History", Icon: History },
  { to: "/setter/hindsight", n: "F5", label: "AI Services", Icon: Brain },
  { to: "/setter/ai-logs", n: "F6", label: "AI Logs", Icon: ScrollText },
  { to: "/setter/overview", n: "F7", label: "Overview", Icon: Radar },
] as const;

/** App shell: sidebar (pipeline order) + topbar. Never reloads on nav. */
export function Shell() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
  }
  return (
    <div className="flex min-h-screen bg-white text-slate-900 dark:bg-ink-950 dark:text-ink-100">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 dark:border-ink-800">
        <div className="px-5 pb-2 pt-6">
          <div className="text-sm font-bold tracking-wide">INGESTION</div>
          <div className="text-xs text-slate-500 dark:text-ink-400">setter console</div>
        </div>
        <nav className="flex flex-col gap-1 px-3 py-4">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 ${
                  isActive
                    ? "bg-accent-500/15 font-semibold text-accent-500"
                    : "text-slate-600 hover:bg-slate-100 dark:text-ink-300 dark:hover:bg-ink-800"
                }`
              }
            >
              <item.Icon size={16} className="shrink-0 opacity-70" />
              <span className="tnum w-6 text-xs opacity-60">{item.n}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto px-5 py-4 text-xs text-slate-400 dark:text-ink-600">sole-user · no auth</div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 px-8 py-3 dark:border-ink-800">
          <div className="text-xs uppercase tracking-widest text-slate-400 dark:text-ink-600">ingestion plane</div>
          <button
            onClick={toggleTheme}
            className="rounded-lg border border-slate-200 px-3 py-1 text-xs transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 dark:border-ink-700 dark:hover:bg-ink-800"
          >
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
