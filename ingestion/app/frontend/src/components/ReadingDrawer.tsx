import { useEffect, useState } from "react";
import { TicketPlus } from "lucide-react";
import { historyApi, readingApi, ticketApi, type ChartReadingRow, type RunInterpretation } from "../lib/api";
import { Btn, Spinner } from "./ui";
import { StatusChip } from "./chips";
import type { LogRow } from "./LogTable";

/**
 * F7 row drill-down. Reading mode: snapshot image + verdict + Details
 * accordion (exact prompt, copyable) + Open ticket. Run mode: the
 * "how AI interpreted" view + Open ticket. Never blank: every missing
 * piece says what to do instead.
 */
export function ReadingDrawer({ lineId, row, onClose, onTicket }: {
  lineId: string;
  row: LogRow;
  onClose: () => void;
  onTicket: () => void;
}) {
  const [reading, setReading] = useState<ChartReadingRow | null>(null);
  const [interp, setInterp] = useState<RunInterpretation | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [ticketMsg, setTicketMsg] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReading(null);
    setInterp(null);
    setPromptOpen(false);
    setTicketMsg(null);
    setError(null);
    if (row.kind === "reading") {
      readingApi.get(row.reading.id).then(setReading).catch((e) => setError((e as Error).message));
    } else {
      historyApi.run(row.run.id).then(setInterp).catch((e) => setError((e as Error).message));
    }
  }, [row]);

  function copyPrompt(text: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  async function openTicket() {
    setOpening(true);
    setTicketMsg(null);
    try {
      const r = await ticketApi.open(
        row.kind === "reading"
          ? { lineId, readingId: row.reading.id, cardId: row.reading.cardId }
          : { lineId, runId: row.run.id, cardId: row.run.cardId }
      );
      setTicketMsg(r.deduped ? `Already open as ticket #${r.id}.` : `Ticket #${r.id} opened — see the sidebar.`);
      onTicket();
    } catch (e) {
      setTicketMsg((e as Error).message);
    } finally {
      setOpening(false);
    }
  }

  const title = row.kind === "reading" ? `Reading #${row.reading.id}` : `Run #${row.run.id}`;
  const subtitle =
    row.kind === "reading"
      ? `${row.reading.cardId}${row.reading.chartKey ? ` · ${row.reading.chartKey}` : ""} · ${new Date(row.reading.at).toLocaleString()}`
      : `${row.run.cardName} · ${row.run.kind} · ${new Date(row.run.at).toLocaleString()}`;

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="max-h-[90vh] w-[56rem] overflow-auto rounded-xl bg-white p-6 dark:bg-ink-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold">{title}</h2>
            <div className="mt-0.5 truncate text-sm text-slate-500">{subtitle}</div>
          </div>
          <span className="ml-auto flex shrink-0 items-center gap-2">
            <Btn size="sm" icon={TicketPlus} onClick={openTicket} loading={opening} title="Open a ticket anchored to this row" className="glass-pill glass-pill--amber">
              Open ticket
            </Btn>
            <Btn size="sm" onClick={onClose} className="glass-pill glass-pill--close">Close</Btn>
          </span>
        </div>
        {ticketMsg && <div className="mt-2 text-sm text-accent-500">{ticketMsg}</div>}
        {error && <div className="mt-3 text-sm text-state-bad">{error}</div>}
        {!reading && !interp && !error && (
          <div className="flex items-center gap-2 py-10 text-sm text-slate-400"><Spinner /> Loading…</div>
        )}

        {reading && (
          <div className="mt-4 grid grid-cols-1 gap-5 md:grid-cols-2">
            <div>
              {reading.image ? (
                <img src={reading.image} alt="chart snapshot" className="w-full rounded-lg border border-slate-200 dark:border-ink-700" />
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400 dark:border-ink-700">
                  No snapshot stored for this reading.
                </div>
              )}
              <div className="mt-3 flex items-center gap-2">
                {reading.status === "error" ? (
                  <StatusChip tone="bad">read failed</StatusChip>
                ) : reading.breach ? (
                  <StatusChip tone="bad">breach</StatusChip>
                ) : (
                  <StatusChip tone="ok">no breach</StatusChip>
                )}
                {reading.llmCallId != null && <span className="tnum text-xs text-slate-400">LLM call #{reading.llmCallId}</span>}
              </div>
              <p className="mt-2 text-sm text-slate-600 dark:text-ink-300">{reading.summary}</p>
              {reading.reason && <p className="mt-1 text-xs text-state-warn">{reading.reason}</p>}
            </div>
            <div>
              <button onClick={() => setPromptOpen((v) => !v)} className="flex items-center gap-2 text-left text-sm font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60">
                <span className="text-slate-400">{promptOpen ? "▾" : "▸"}</span> Details — exact prompt
              </button>
              {promptOpen && (
                reading.prompt ? (
                  <div className="mt-2">
                    <button onClick={() => copyPrompt(reading.prompt)} className="text-[11px] text-accent-500 hover:underline focus:outline-none">
                      {copied ? "copied ✓" : "copy"}
                    </button>
                    <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-600 dark:bg-ink-800/60 dark:text-ink-300">{reading.prompt}</pre>
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-slate-400">No prompt captured for this reading.</div>
                )
              )}
              <div className="mt-4 text-xs uppercase tracking-wider text-slate-400">model response</div>
              <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-600 dark:bg-ink-800/60 dark:text-ink-300">
                {reading.responseText || "—"}
              </pre>
            </div>
          </div>
        )}

        {interp && (
          <div className="mt-4">
            <div className="text-xs uppercase tracking-wider text-slate-400">context in</div>
            <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-100 p-2 font-mono text-xs dark:bg-ink-950">{interp.contextIn.sql}</pre>
            <div className="mt-1 text-xs text-slate-400">{interp.contextIn.granularity}{interp.contextIn.extractHint ? ` · hint: ${interp.contextIn.extractHint}` : ""}</div>
            <div className="mt-4 text-xs uppercase tracking-wider text-slate-400">facts out</div>
            <div className="tnum mt-1 text-2xl font-bold">{interp.factsOut.stored} <span className="text-sm font-normal text-slate-400">facts</span></div>
            <p className="mt-1 text-sm text-slate-500">{interp.factsOut.note}</p>
          </div>
        )}
      </div>
    </div>
  );
}
