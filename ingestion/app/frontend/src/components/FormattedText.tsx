import type { ReactNode } from "react";

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Entity-aware text: line names render bold + accent, bank ids / tables /
 * metrics as mono chips, **bold** and `code` author markup supported.
 * Input is never injected as HTML — output is built from React nodes only,
 * so `<img onerror=…>` renders as inert text.
 */
export function FormattedText({ text, lineName, bankId, metrics, highlightTables }: {
  text: string;
  lineName?: string;
  bankId?: string;
  metrics?: string[];
  highlightTables?: boolean;
}) {
  const parts: { re: RegExp; render: (m: string) => ReactNode }[] = [];
  if (bankId) {
    const re = new RegExp(escapeReg(bankId), "g");
    parts.push({ re, render: (m) => <code key={k()} className="rounded bg-slate-100 px-1 font-mono text-xs dark:bg-ink-800">{m}</code> });
  }
  if (lineName) {
    const re = new RegExp(escapeReg(lineName), "g");
    parts.push({ re, render: (m) => <strong key={k()} className="font-semibold text-accent-500">{m}</strong> });
  }
  if (metrics) {
    for (const met of metrics.filter(Boolean)) {
      const re = new RegExp(`(?<![\\w])${escapeReg(met)}(?![\\w])`, "g");
      parts.push({ re, render: (m) => <code key={k()} className="font-mono text-accent-500">{m}</code> });
    }
  }
  if (highlightTables) {
    parts.push({
      re: /[A-Za-z_][\w]*\.[\w$#]+/g,
      render: (m) => <span key={k()} className="font-mono text-slate-500 dark:text-ink-300">{m}</span>,
    });
  }
  // Author markup (lowest priority).
  parts.push({
    re: /`([^`]+)`/g,
    render: (m) => <code key={k()} className="rounded bg-slate-100 px-1 font-mono text-xs dark:bg-ink-800">{m.slice(1, -1)}</code>,
  });
  parts.push({
    re: /\*\*([^*]+)\*\*/g,
    render: (m) => <strong key={k()}>{m.slice(2, -2)}</strong>,
  });

  // Single pass: find earliest match among all patterns, emit, continue.
  const nodes: ReactNode[] = [];
  let rest = text;
  let guard = 0;
  while (rest.length > 0 && guard++ < 500) {
    let best: { index: number; len: number; render: (m: string) => ReactNode; match: string } | null = null;
    for (const p of parts) {
      p.re.lastIndex = 0;
      const m = p.re.exec(rest);
      if (m && (best === null || m.index < best.index)) {
        best = { index: m.index, len: m[0].length, render: p.render, match: m[0] };
        if (best.index === 0) break;
      }
    }
    if (!best) {
      nodes.push(rest);
      break;
    }
    if (best.index > 0) nodes.push(rest.slice(0, best.index));
    nodes.push(best.render(best.match));
    rest = rest.slice(best.index + best.len);
  }
  return <>{nodes}</>;
}

let seq = 0;
function k(): string {
  seq += 1;
  return `ft-${seq}`;
}
