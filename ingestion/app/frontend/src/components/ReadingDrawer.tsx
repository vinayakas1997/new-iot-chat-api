import { useEffect, useState } from "react";
import { TicketPlus } from "lucide-react";
import { aiLogsApi, bankApi, cardApi, historyApi, readingApi, ticketApi, type CardSample, type ChartReadingRow, type LlmCallRecord, type RecallHit, type RunInterpretation } from "../lib/api";
import { Btn, Spinner } from "./ui";
import { StatusChip } from "./chips";
import { Chart } from "./Chart";
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
  const [parsedOpen, setParsedOpen] = useState(false);
  const [timingOpen, setTimingOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const [memOpen, setMemOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [ticketMsg, setTicketMsg] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Item 3 evidence: lazy-loaded per section, never blank (missing → reason).
  const [llmCall, setLlmCall] = useState<LlmCallRecord | null>(null);
  const [llmErr, setLlmErr] = useState<string | null>(null);
  const [sample, setSample] = useState<CardSample | null>(null);
  const [sampleErr, setSampleErr] = useState<string | null>(null);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [mems, setMems] = useState<RecallHit[] | null>(null);
  const [memErr, setMemErr] = useState<string | null>(null);
  const [memBusy, setMemBusy] = useState(false);
  const [loopOpen, setLoopOpen] = useState(false);

  useEffect(() => {
    setReading(null);
    setInterp(null);
    setPromptOpen(false);
    setParsedOpen(false);
    setTimingOpen(false);
    setChartOpen(false);
    setMemOpen(false);
    setTicketMsg(null);
    setError(null);
    setLlmCall(null);
    setLlmErr(null);
    setSample(null);
    setSampleErr(null);
    setMems(null);
    setMemErr(null);
    setLoopOpen(false);
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

  // ---- Item 3 evidence loaders (lazy, per section) ----
  function loadTiming() {
    if (timingOpen || llmCall || llmErr) { setTimingOpen((v) => !v); return; }
    setTimingOpen(true);
    if (row.kind === "reading" && row.reading.llmCallId != null) {
      aiLogsApi.get(row.reading.llmCallId).then(setLlmCall).catch((e) => setLlmErr((e as Error).message));
    }
  }
  function loadChart() {
    if (chartOpen || sample || sampleErr) { setChartOpen((v) => !v); return; }
    setChartOpen(true);
    if (row.kind === "run") {
      setSampleBusy(true);
      cardApi.cardSample(row.run.cardId)
        .then(setSample)
        .catch((e) => setSampleErr((e as Error).message))
        .finally(() => setSampleBusy(false));
    }
  }
  function loadMems() {
    if (memOpen || mems || memErr) { setMemOpen((v) => !v); return; }
    setMemOpen(true);
    const lineId = row.kind === "reading" ? row.reading.lineId : row.run.lineId;
    const cardId = row.kind === "reading" ? row.reading.cardId : row.run.cardId;
    setMemBusy(true);
    bankApi.recallByTags(
      `bank:line-${lineId}`,
      `${cardId} facts`,
      [`line:${lineId}`, `card:${cardId}`].concat(
        row.kind === "run" ? [`cardVersion:${row.run.cardVersion}`] : []
      ),
    )
      .then((r) => setMems(r.results ?? []))
      .catch((e) => setMemErr((e as Error).message))
      .finally(() => setMemBusy(false));
  }

  function sectionBtn(open: boolean, onClick: () => void, label: string, title: string) {
    return (
      <button onClick={onClick} title={title} className="flex items-center gap-2 text-left text-sm font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60">
        <span className="text-slate-400">{open ? "▾" : "▸"}</span> {label}
      </button>
    );
  }

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
              <div className="mt-4">{sectionBtn(parsedOpen, () => setParsedOpen((v) => !v), "Parsed output", "Button 2 — the structured output the model returned")}</div>
              {parsedOpen && (
                <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-600 dark:bg-ink-800/60 dark:text-ink-300">
                  {reading.readingJson ? JSON.stringify(JSON.parse(reading.readingJson), null, 1) : "No parsed output stored."}
                </pre>
              )}
              <div className="mt-4">{sectionBtn(timingOpen, loadTiming, "Timing — when context got built", "Button 1 — run timeline + LLM call cost")}</div>
              {timingOpen && (
                <div className="mt-1 text-xs text-slate-500 dark:text-ink-300">
                  <div className="tnum">read at {new Date(reading.at).toLocaleString()} · status {reading.status}</div>
                  {reading.llmCallId == null && <div className="mt-1 text-slate-400">No LLM call linked to this reading.</div>}
                  {llmErr && <div className="mt-1 text-state-bad">{llmErr}</div>}
                  {llmCall && (
                    <div className="tnum mt-1">LLM call #{llmCall.id} · {llmCall.model} · {llmCall.latencyMs} ms · {llmCall.attempts} attempt(s) · {llmCall.success ? "ok" : `failed (${llmCall.reason ?? "?"})`}</div>
                  )}
                </div>
              )}
              <div className="mt-4">{sectionBtn(memOpen, loadMems, "Hindsight inserts for this input", "Button 5 — facts this input stored, recalled by tags")}</div>
              {memOpen && (
                <div className="mt-1 text-xs text-slate-500 dark:text-ink-300">
                  {memBusy && <span className="inline-flex items-center gap-2"><Spinner /> Recalling by tags…</span>}
                  {memErr && <div className="text-state-bad">{memErr}</div>}
                  {mems && mems.length === 0 && <div className="text-slate-400">No memories carry this row's tag set — nothing from this input landed in the bank.</div>}
                  {mems && mems.map((m, i) => (
                    <div key={m.id ?? i} className="mt-1 rounded-lg bg-slate-50 p-2 dark:bg-ink-800/60">
                      <div className="text-slate-600 dark:text-ink-200">{m.text ?? "(no text)"}</div>
                      <div className="tnum mt-0.5 text-[11px] text-slate-400">{m.type ?? ""} · {m.occurred_start ?? m.mentioned_at ?? ""}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-4">{sectionBtn(loopOpen, () => setLoopOpen((v) => !v), "Loop decisions — why the bank looks this way", "Gate-2 file/merge/drop + verdict closes, persisted on this row")}</div>
              {loopOpen && <LoopReportView loopJson={reading.loopJson} />}
            </div>
          </div>
        )}

        {interp && (
          <div className="mt-4">
            <div>{sectionBtn(timingOpen, loadTiming, "Timing — when context got built", "Button 1 — this run's timeline")}</div>
            {(timingOpen || true) && (
              <div className="tnum mt-1 text-xs text-slate-500 dark:text-ink-300">
                ran {new Date(interp.run.at).toLocaleString()} · {interp.run.kind} · {interp.run.resolution ?? "base"} · {interp.run.durationMs ?? "?"} ms · rows {interp.run.rowsPulled} → units {interp.run.unitsBuilt} → facts {interp.run.factsStored}
                {interp.run.error && <div className="mt-0.5 text-state-warn">{interp.run.error}</div>}
              </div>
            )}
            <div className="mt-4 text-xs uppercase tracking-wider text-slate-400">context in</div>
            <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-100 p-2 font-mono text-xs dark:bg-ink-950">{interp.contextIn.sql}</pre>
            <div className="mt-1 text-xs text-slate-400">{interp.contextIn.granularity}{interp.contextIn.extractHint ? ` · hint: ${interp.contextIn.extractHint}` : ""}</div>
            <div className="mt-4 text-xs uppercase tracking-wider text-slate-400">AI output</div>
            <p className="mt-1 text-xs text-slate-400">Tick extracts aren't persisted per-bucket — the {interp.factsOut.stored} retained facts are the output (see Hindsight inserts below).</p>
            <div className="mt-4">{sectionBtn(chartOpen, loadChart, "Chart — render on demand", "Button 4 — fresh sample render, never stored")}</div>
            {chartOpen && (
              <div className="mt-1">
                {sampleBusy && <span className="inline-flex items-center gap-2 text-xs text-slate-400"><Spinner /> Sampling…</span>}
                {sampleErr && <div className="text-xs text-state-bad">{sampleErr}</div>}
                {sample && <RunSampleChart sample={sample} />}
                {sample && <div className="mt-1 text-[11px] text-slate-400">Fresh sample render ({sample.rowCount} rows, {new Date(sample.from).toLocaleString()} → {new Date(sample.to).toLocaleString()}) — not the tick window, which runs don't store.</div>}
              </div>
            )}
            <div className="mt-4 text-xs uppercase tracking-wider text-slate-400">facts out</div>
            <div className="tnum mt-1 text-2xl font-bold">{interp.factsOut.stored} <span className="text-sm font-normal text-slate-400">facts</span></div>
            <p className="mt-1 text-sm text-slate-500">{interp.factsOut.note}</p>
            <div className="mt-4">{sectionBtn(memOpen, loadMems, "Hindsight inserts for this input", "Button 5 — facts this input stored, recalled by tags")}</div>
            {memOpen && (
              <div className="mt-1 text-xs text-slate-500 dark:text-ink-300">
                {memBusy && <span className="inline-flex items-center gap-2"><Spinner /> Recalling by tags…</span>}
                {memErr && <div className="text-state-bad">{memErr}</div>}
                {mems && mems.length === 0 && <div className="text-slate-400">No memories carry this row's tag set — nothing from this input landed in the bank.</div>}
                {mems && mems.map((m, i) => (
                  <div key={m.id ?? i} className="mt-1 rounded-lg bg-slate-50 p-2 dark:bg-ink-800/60">
                    <div className="text-slate-600 dark:text-ink-200">{m.text ?? "(no text)"}</div>
                    <div className="tnum mt-0.5 text-[11px] text-slate-400">{m.type ?? ""} · {m.occurred_start ?? m.mentioned_at ?? ""}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Gap 2: the row's persisted loop decisions (file/merge/drop/close). */
function LoopReportView({ loopJson }: { loopJson: string | null }) {
  if (!loopJson) {
    return <div className="mt-1 text-xs text-slate-400">No loop ran on this reading (pre-loop row, or unreadable input).</div>;
  }
  let loop: { filed?: { ticketId: number; question: string }[]; merged?: { ticketId: number; question: string }[]; dropped?: { question: string; reason: string }[]; closed?: { ticketId: number; reason: string }[]; escalated?: { ticketId: number; reason: string }[] };
  try {
    loop = JSON.parse(loopJson) as typeof loop;
  } catch {
    return <div className="mt-1 text-xs text-state-bad">Loop report unparseable.</div>;
  }
  const rows: { label: string; detail: string; tone: string }[] = [
    ...(loop.filed ?? []).map((f) => ({ label: `filed ticket #${f.ticketId}`, detail: f.question, tone: "text-state-ok" })),
    ...(loop.merged ?? []).map((m) => ({ label: `merged into ticket #${m.ticketId}`, detail: m.question, tone: "text-accent-500" })),
    ...(loop.dropped ?? []).map((d) => ({ label: "dropped", detail: `${d.question} — ${d.reason}`, tone: "text-slate-400" })),
    ...(loop.closed ?? []).map((c) => ({ label: `closed ticket #${c.ticketId}`, detail: c.reason, tone: "text-state-ok" })),
    ...(loop.escalated ?? []).map((e) => ({ label: `escalated ticket #${e.ticketId}`, detail: e.reason, tone: "text-state-warn" })),
  ];
  if (rows.length === 0) {
    return <div className="mt-1 text-xs text-slate-400">Loop ran clean — no questions born, no verdicts to apply. Silence examined, not missing.</div>;
  }
  return (
    <div className="mt-1 flex flex-col gap-1 text-xs">
      {rows.map((r, i) => (
        <div key={i} className="rounded-lg bg-slate-50 p-2 dark:bg-ink-800/60">
          <span className={`font-semibold ${r.tone}`}>{r.label}</span>
          <span className="text-slate-500 dark:text-ink-300"> — {r.detail}</span>
        </div>
      ))}
    </div>
  );
}

/** Button 4: fresh sample chart for a run row (window not stored — sample labeled honestly). */
function RunSampleChart({ sample }: { sample: CardSample }) {
  const x = sample.columns.find((c) => /time|date|hour|day|shift|_at$|^ts$/i.test(c)) ?? sample.columns[0];
  const yCols = sample.columns.filter((c) => c !== x && sample.rows.some((r) => typeof r[c] === "number" && Number.isFinite(r[c])));
  if (!x || yCols.length === 0) {
    return <div className="text-xs text-slate-400">Sample has no plottable columns.</div>;
  }
  return <Chart rows={sample.rows} x={x} yCols={yCols.slice(0, 4)} type="line" height={220} />;
}
