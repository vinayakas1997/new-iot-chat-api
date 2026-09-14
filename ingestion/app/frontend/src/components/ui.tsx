import { Loader2, type LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ok" | "warn" | "bad" | "ghost" | "ghostBad";
type Size = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-150 " +
  "active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 focus-visible:ring-offset-1 " +
  "dark:focus-visible:ring-offset-ink-900";

const variants: Record<Variant, string> = {
  // Teal lives in chrome actions only (R3).
  primary: "bg-accent-500 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-400",
  secondary:
    "border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100 dark:border-ink-700 dark:hover:bg-ink-800",
  ok: "border border-state-ok/50 px-3 py-1 text-sm text-state-ok hover:bg-state-ok/10",
  warn: "border border-state-warn/50 px-3 py-1 text-sm text-state-warn hover:bg-state-warn/10",
  bad: "border border-state-bad/50 px-3 py-1 text-sm text-state-bad hover:bg-state-bad/10",
  ghost: "px-1 py-0.5 text-sm text-accent-500 hover:underline disabled:no-underline",
  ghostBad: "px-1 py-0.5 text-sm text-state-bad hover:underline disabled:no-underline",
};

const sizes: Record<Size, string> = {
  sm: "text-[13px]",
  md: "text-sm",
};

export interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  loading?: boolean;
}

/** Shared action button: variant color, hover/active/disabled/focus, optional icon + spinner. */
export function Btn({ variant = "secondary", size = "md", icon: Icon, loading, children, disabled, className = "", ...rest }: BtnProps) {
  return (
    <button disabled={disabled || loading} className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...rest}>
      {loading ? <Loader2 size={14} className="animate-spin" /> : Icon ? <Icon size={14} /> : null}
      {children}
    </button>
  );
}

/** Spinner for inline loading states. */
export function Spinner({ size = 14, className = "" }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={`animate-spin ${className}`} />;
}

/** Segmented toggle (Grouped/Flat, chart types...). */
export function Segmented<T extends string>({ options, value, onChange }: {
  options: { value: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 text-sm">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          title={o.title}
          className={`rounded-lg px-3 py-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 ${
            value === o.value ? "bg-accent-500/15 font-medium text-accent-500" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-ink-800"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Designed empty state (R7): icon + guidance + action. */
export function EmptyState({ icon: Icon, title, body, action }: {
  icon: LucideIcon;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="mt-8 rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-ink-700">
      <Icon size={28} className="mx-auto text-slate-300 dark:text-ink-600" />
      <div className="mt-3 font-semibold">{title}</div>
      <p className="mt-1 text-sm text-slate-500">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
