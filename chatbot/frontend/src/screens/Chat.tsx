import { useEffect, useRef, useState } from "react";
import { Send, Square, Plus, Trash2 } from "lucide-react";
import { ragApi, streamChat, type ChatAnswer, type ChatMsg, type ChatSession } from "../lib/rag-api";
import { Banner, Btn, Chip } from "../components/ui";
import { ChartView } from "../components/charts";

type Line = { id: string; name: string };

export function Chat() {
  const [lines, setLines] = useState<Line[]>([]);
  const [lineIds, setLineIds] = useState<string[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inspector, setInspector] = useState<ChatAnswer | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ragApi.lines().then((r) => {
      const list = Array.isArray(r) ? r : r.lines ?? [];
      setLines(list);
      if (list.length && !lineIds.length) setLineIds([list[0].id]);
    }).catch(() => {});
    ragApi.sessions().then(setSessions).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, streaming]);

  async function openSession(id: string) {
    setSessionId(id);
    setInspector(null);
    setMsgs(await ragApi.messages(id).catch(() => []));
  }

  async function newChat() {
    setSessionId(undefined);
    setMsgs([]);
    setInspector(null);
    setStreaming("");
  }

  async function send() {
    if (!input.trim() || !lineIds.length || busy) return;
    const q = input.trim();
    setInput("");
    setError(null);
    setBusy(true);
    setMsgs((m) => [...m, { id: Date.now(), role: "user", content: q, charts: [], sources: [], createdAt: new Date().toISOString() }]);
    setStreaming("");
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      const { answer, sessionId: sid } = await streamChat({ sessionId, lineIds, message: q }, (d) => setStreaming((s) => s + d), ctl.signal);
      setSessionId(sid);
      setMsgs((m) => [...m, { id: Date.now() + 1, role: "assistant", content: answer.summary, charts: answer.charts, sources: answer.sources, createdAt: new Date().toISOString() }]);
      setInspector(answer);
      setSessions(await ragApi.sessions().catch(() => []));
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setStreaming("");
      setBusy(false);
      abortRef.current = null;
    }
  }

  function stop() { abortRef.current?.abort(); }

  return (
    <div>
      <h1 className="text-2xl font-bold">What happened on the line?</h1>
      <p className="mt-1 text-sm text-slate-500">answers from Hindsight memories first, live SQL + stored charts when needed</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-400">Lines:</span>
        {lines.map((l) => {
          const on = lineIds.includes(l.id);
          return (
            <button
              key={l.id}
              onClick={() => setLineIds(on ? lineIds.filter((x) => x !== l.id) : [...lineIds, l.id].slice(0, 5))}
              className={`rounded-full border px-3 py-1 font-mono text-xs ${on ? "border-accent-500 bg-accent-500/15 text-accent-500" : "border-slate-300 dark:border-ink-700"}`}
            >
              {l.id}
            </button>
          );
        })}
        {!lines.length && <span className="text-xs text-slate-400">no lines — register one in ingestion F2</span>}
      </div>

      {error && <div className="mt-3"><Banner tone="bad" title="Chat failed" detail={error} /></div>}

      <div className="mt-4 grid grid-cols-1 gap-6 xl:grid-cols-[14rem_1fr_22rem]">
        {/* sessions */}
        <div className="rounded-xl border border-slate-200 p-3 dark:border-ink-800">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Sessions</span>
            <button onClick={() => void newChat()} className="rounded p-1 hover:bg-slate-100 dark:hover:bg-ink-800" title="New chat"><Plus size={14} /></button>
          </div>
          {sessions.map((s) => (
            <div key={s.id} className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm ${s.id === sessionId ? "bg-accent-500/15 text-accent-500" : "hover:bg-slate-100 dark:hover:bg-ink-800"}`}>
              <button onClick={() => void openSession(s.id)} className="min-w-0 flex-1 truncate text-left">{s.title}</button>
              <button onClick={() => void ragApi.deleteSession(s.id).then(() => setSessions(sessions.filter((x) => x.id !== s.id)))} className="invisible p-1 opacity-60 group-hover:visible" title="Delete"><Trash2 size={12} /></button>
            </div>
          ))}
          {!sessions.length && <div className="text-xs text-slate-400">No sessions yet — ask below.</div>}
        </div>

        {/* thread */}
        <div className="flex min-h-[60vh] flex-col rounded-xl border border-slate-200 p-4 dark:border-ink-800">
          <div className="flex-1">
            {!msgs.length && !streaming && (
              <div className="mt-8 text-center text-sm text-slate-400">
                <div className="font-semibold text-slate-500">Teaching empty state — try:</div>
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  {["OEE yesterday?", "Top downtime reasons?", "Trend last 7 days as chart"].map((s) => (
                    <button key={s} onClick={() => setInput(s)} className="rounded-full border border-slate-300 px-3 py-1 text-xs hover:bg-slate-100 dark:border-ink-700 dark:hover:bg-ink-800">{s}</button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m) => (
              <div key={m.id} className={`mb-3 ${m.role === "user" ? "text-right" : ""}`}>
                <div className={`inline-block max-w-[90%] rounded-xl px-3 py-2 text-left text-sm ${m.role === "user" ? "bg-accent-500/15" : "bg-slate-100 dark:bg-ink-800"}`}>
                  <div className="whitespace-pre-wrap">{m.content}</div>
                  {m.role === "assistant" && m.sources.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {m.sources.map((s, i) => <Chip key={i} tone={s.tool === "recall_memory" ? "accent" : "mute"}>{s.tool}</Chip>)}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {streaming && (
              <div className="mb-3">
                <div className="inline-block max-w-[90%] rounded-xl bg-slate-100 px-3 py-2 text-sm dark:bg-ink-800">
                  <span className="whitespace-pre-wrap">{streaming}</span>
                  <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-accent-500" />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          <div className="mt-3 flex gap-2">
            <textarea
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } if (e.key === "Escape") stop(); }}
              placeholder={lineIds.length ? `Ask about ${lineIds.join(", ")}…` : "Pick a line first…"}
              className="flex-1 rounded-lg border border-slate-300 bg-transparent p-3 text-sm dark:border-ink-700"
            />
            {busy ? (
              <Btn onClick={stop}><Square size={14} /> Stop</Btn>
            ) : (
              <Btn variant="primary" onClick={() => void send()} disabled={!input.trim() || !lineIds.length}><Send size={14} /> Send</Btn>
            )}
          </div>
          <div className="mt-1 text-[11px] text-slate-400">Enter to send · Shift+Enter newline · Esc stops</div>
        </div>

        {/* inspector */}
        <div className="rounded-xl border border-slate-200 p-3 dark:border-ink-800">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Inspector</div>
          {!inspector && <div className="text-xs text-slate-400">Chart · Data · Sources appear here after an answer.</div>}
          {inspector && (
            <div className="flex flex-col gap-3">
              {inspector.charts.map((c, i) => <ChartView key={i} chart={c} />)}
              {!inspector.charts.length && <div className="text-xs text-slate-400">No chart for this answer (memory-only).</div>}
              <div className="rounded-lg bg-slate-100 p-2 text-[11px] dark:bg-ink-800">
                <div className="font-semibold">Sources</div>
                {inspector.sources.map((s, i) => <div key={i} className="tnum mt-1 font-mono text-slate-400">{s.tool}{s.detail ? ` — ${s.detail}` : ""}</div>)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
