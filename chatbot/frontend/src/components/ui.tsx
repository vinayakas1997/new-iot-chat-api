export function Chip({ children, tone = "mute" }: { children: React.ReactNode; tone?: "ok" | "bad" | "warn" | "mute" | "accent" }) {
  const tones: Record<string, string> = {
    ok: "bg-state-ok/15 text-state-ok",
    bad: "bg-state-bad/15 text-state-bad",
    warn: "bg-state-warn/15 text-state-warn",
    mute: "bg-slate-500/10 text-slate-400",
    accent: "bg-accent-500/15 text-accent-500",
  };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Banner({ tone, title, detail }: { tone: "bad" | "warn"; title: string; detail?: string }) {
  const cls = tone === "bad" ? "border-state-bad/30 bg-state-bad/10" : "border-state-warn/30 bg-state-warn/10";
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${cls}`}>
      <div className="font-semibold">{title}</div>
      {detail && <div className="mt-0.5 text-xs opacity-80">{detail}</div>}
    </div>
  );
}

export function Btn({ children, onClick, variant = "ghost", disabled, loading }: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost";
  disabled?: boolean;
  loading?: boolean;
}) {
  const base = "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 disabled:opacity-50";
  const v = variant === "primary" ? "bg-accent-500/90 font-semibold text-white hover:bg-accent-500" : "border border-slate-300 hover:bg-slate-100 dark:border-ink-700 dark:hover:bg-ink-800";
  return <button className={`${base} ${v}`} onClick={onClick} disabled={disabled || loading}>{loading ? "…" : children}</button>;
}

/** Square icon action for card action rows. 44px touch target per design rule R8. */
export function IconBtn({ children, onClick, title, tone = "ghost" }: {
  children: React.ReactNode;
  onClick?: () => void;
  title: string;
  tone?: "ghost" | "bad" | "accent";
}) {
  const tones: Record<string, string> = {
    ghost: "text-slate-500 hover:bg-slate-100 dark:text-ink-400 dark:hover:bg-ink-800",
    bad: "text-slate-500 hover:bg-state-bad/10 hover:text-state-bad dark:text-ink-400",
    accent: "text-slate-500 hover:bg-accent-500/10 hover:text-accent-500 dark:text-ink-400",
  };
  return (
    <button
      title={title}
      aria-label={title}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      className={`inline-flex h-11 w-11 items-center justify-center rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}
