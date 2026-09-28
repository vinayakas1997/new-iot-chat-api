import { useState } from "react";
import { TicketCheck } from "lucide-react";
import { ticketApi, type Card, type TicketRow } from "../lib/api";
import { Btn, EmptyState, Spinner } from "./ui";
import { StatusChip } from "./chips";
import { timeAgo } from "../lib/format";

/**
 * F7 Zone 4 — right sidebar. Item 4: open tickets ARE the open-ended
 * questions, grouped by granularity. Each shows title → meaning → created →
 * elapsed unanswered; auto-close freezes the timer into "answered after X".
 * Manual close stays as a demoted escape hatch inside the expanded view.
 */
export function TicketSidebar({ lineId, open, closed, cards, loading, onChanged, onViewReading }: {
  lineId: string;
  open: TicketRow[];
  closed: TicketRow[];
  cards: Card[];
  loading: boolean;
  onChanged: () => void;
  onViewReading: (readingId: number) => void;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [closingId, setClosingId] = useState<number | null>(null);
  const [note, setNote] = useState("");

  const granOf = (t: TicketRow): string => cards.find((c) => c.id === t.cardId)?.granularity ?? "other";
  const groups = new Map<string, TicketRow[]>();
  for (const t of open) {
    const g = granOf(t);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(t);
  }
  const groupOrder = ["hourly", "daily", "other"].filter((g) => groups.has(g));

  function answeredAfter(t: TicketRow): string | null {
    if (!t.closedAt) return null;
    const ms = new Date(t.closedAt).getTime() - new Date(t.at).getTime();
    if (!Number.isFinite(ms) || ms < 0) return null;
    const m = Math.round(ms / 60000);
    if (m < 60) return `${m}m`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h}h`;
    return `${Math.round(h / 24)}d`;
  }

  async function close(id: number) {
    setClosingId(id);
    try {
      await ticketApi.close(id, note);
      setNote("");
      setExpanded(null);
      onChanged();
    } finally {
      setClosingId(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-bold">Open questions</h2>
        <StatusChip tone={open.length > 0 ? "warn" : "ok"}>{open.length} open</StatusChip>
      </div>
      {loading && <div className="mt-3 flex items-center gap-2 text-sm text-slate-400"><Spinner /> Loading…</div>}
      {!loading && open.length === 0 && (
        <div className="mt-3">
          <EmptyState icon={TicketCheck} title="No open questions" body="Readings birth up to 3 questions per cycle — they land here grouped by granularity." />
        </div>
      )}
      <div className="mt-3 flex min-h-0 flex-col gap-2 overflow-auto pr-1">
        {groupOrder.map((g) => (
          <div key={g}>
            <div className="tnum mt-1 text-[11px] font-semibold uppercase tracking-widest text-slate-400">▸ {g} ({groups.get(g)!.length})</div>
            {(groups.get(g) ?? []).map((t) => (
          <div key={t.id} className="mt-1.5 rounded-xl border border-slate-200 p-3 dark:border-ink-800">
            <button onClick={() => setExpanded(expanded === t.id ? null : t.id)} className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold">{t.title}</span>
              </div>
              <div className="tnum mt-0.5 truncate text-[11px] text-slate-400">#{t.id} · opened {timeAgo(t.at)} · unanswered {timeAgo(t.at)}</div>
              {t.aiReason && <div className="mt-0.5 truncate text-xs text-slate-500">{t.aiReason}</div>}
            </button>
            {expanded === t.id && (
              <div className="mt-2 border-t border-slate-100 pt-2 dark:border-ink-800">
                <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Meaning — why</div>
                <p className="mt-1 text-sm text-slate-600 dark:text-ink-300">{t.aiReason || "No reasoning frozen on this ticket."}</p>
                {t.note && <p className="mt-1 text-xs text-slate-500">Thread: {t.note}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {t.readingId != null && (
                    <button onClick={() => onViewReading(t.readingId as number)} className="text-xs text-accent-500 hover:underline focus:outline-none">
                      view reading →
                    </button>
                  )}
                  {t.runId != null && <span className="tnum text-[11px] text-slate-400">run #{t.runId}</span>}
                </div>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Manual close note (escape hatch — auto-close is the loop)…"
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-transparent px-2 py-1 text-xs focus:border-accent-500 focus:outline-none dark:border-ink-700"
                />
                <div className="mt-2 flex justify-end">
                  <Btn size="sm" onClick={() => void close(t.id)} loading={closingId === t.id} className="glass-pill glass-pill--ok">
                    Close ticket
                  </Btn>
                </div>
              </div>
            )}
          </div>
            ))}
          </div>
        ))}
        {closed.length > 0 && (
          <>
            <div className="mt-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Closed (auto)</div>
            {closed.map((t) => (
              <div key={t.id} className="rounded-xl border border-slate-200/70 p-3 opacity-80 dark:border-ink-800/70">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm">{t.title}</span>
                  <span className="ml-auto shrink-0"><StatusChip tone="mute">closed</StatusChip></span>
                </div>
                <div className="tnum mt-0.5 text-[11px] text-slate-400">#{t.id}{answeredAfter(t) ? ` · answered after ${answeredAfter(t)}` : ""}</div>
                {t.note && <div className="mt-1 truncate text-xs text-slate-500" title={t.note}>{t.note}</div>}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
