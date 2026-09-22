import { useState } from "react";
import { TicketCheck } from "lucide-react";
import { ticketApi, type TicketRow } from "../lib/api";
import { Btn, EmptyState, Spinner } from "./ui";
import { StatusChip } from "./chips";
import { timeAgo } from "../lib/format";

/**
 * F7 Zone 4 — right sidebar. Open tickets on top (click → frozen AI
 * reasoning + jump to the reading), other/closed tickets scrolling below.
 */
export function TicketSidebar({ lineId, open, closed, loading, onChanged, onViewReading }: {
  lineId: string;
  open: TicketRow[];
  closed: TicketRow[];
  loading: boolean;
  onChanged: () => void;
  onViewReading: (readingId: number) => void;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [closingId, setClosingId] = useState<number | null>(null);
  const [note, setNote] = useState("");

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
        <h2 className="text-base font-bold">Tickets</h2>
        <StatusChip tone={open.length > 0 ? "warn" : "ok"}>{open.length} open</StatusChip>
      </div>
      {loading && <div className="mt-3 flex items-center gap-2 text-sm text-slate-400"><Spinner /> Loading…</div>}
      {!loading && open.length === 0 && (
        <div className="mt-3">
          <EmptyState icon={TicketCheck} title="No open tickets" body="Open one from any log row — it anchors to the reading or run as evidence." />
        </div>
      )}
      <div className="mt-3 flex min-h-0 flex-col gap-2 overflow-auto pr-1">
        {open.map((t) => (
          <div key={t.id} className="rounded-xl border border-slate-200 p-3 dark:border-ink-800">
            <button onClick={() => setExpanded(expanded === t.id ? null : t.id)} className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold">{t.title}</span>
              </div>
              <div className="tnum mt-0.5 text-[11px] text-slate-400">#{t.id} · {timeAgo(t.at)}</div>
            </button>
            {expanded === t.id && (
              <div className="mt-2 border-t border-slate-100 pt-2 dark:border-ink-800">
                <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">AI reasoning — why</div>
                <p className="mt-1 text-sm text-slate-600 dark:text-ink-300">{t.aiReason || "No reasoning frozen on this ticket."}</p>
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
                  placeholder="Close note…"
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
        {closed.length > 0 && (
          <>
            <div className="mt-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">Other tickets</div>
            {closed.map((t) => (
              <div key={t.id} className="rounded-xl border border-slate-200/70 p-3 opacity-80 dark:border-ink-800/70">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm">{t.title}</span>
                  <span className="ml-auto shrink-0"><StatusChip tone="mute">closed</StatusChip></span>
                </div>
                <div className="tnum mt-0.5 text-[11px] text-slate-400">#{t.id} · {timeAgo(t.closedAt ?? t.at)}</div>
                {t.note && <div className="mt-1 truncate text-xs text-slate-500">{t.note}</div>}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
