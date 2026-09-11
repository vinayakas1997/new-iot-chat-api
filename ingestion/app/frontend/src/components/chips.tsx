type Tone = "ok" | "warn" | "bad" | "mute" | "accent";

/** R3: color is a signal channel. Chips carry state, nothing else. */
export function StatusChip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const tones: Record<Tone, string> = {
    ok: "bg-state-ok/15 text-state-ok",
    warn: "bg-state-warn/15 text-state-warn",
    bad: "bg-state-bad/15 text-state-bad",
    mute: "bg-ink-700/40 text-ink-300",
    accent: "bg-accent-500/15 text-accent-400",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** R7: one shared alert-banner pattern for F1/F4/F5. */
export function AlertBanner({ tone, title, detail }: { tone: "warn" | "bad"; title: string; detail?: string }) {
  const bar = tone === "bad" ? "border-state-bad/40 bg-state-bad/10" : "border-state-warn/40 bg-state-warn/10";
  const text = tone === "bad" ? "text-state-bad" : "text-state-warn";
  return (
    <div className={`rounded-lg border px-4 py-3 ${bar}`}>
      <div className={`text-sm font-semibold ${text}`}>{title}</div>
      {detail && <div className="mt-1 text-sm text-ink-300">{detail}</div>}
    </div>
  );
}
