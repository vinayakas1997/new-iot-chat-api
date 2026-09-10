import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useRef, useState, useCallback } from 'react';
import type { ChatMessage } from '@app/shared';
import { api } from '../lib/api.js';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

type Msg = ChatMessage & { id: string; feedback?: 'up' | 'down' | null; sourcesOpen?: boolean };
type FollowChip = string;

const FOLLOW_CHIPS: FollowChip[] = [
  'Show OEE chart',
  'Downtime last 7 days',
  'Scrap rate yesterday',
  'Summarise this',
];

function parseSources(content: string) {
  // mock LLM embeds "[tool:recall_memory]" etc. Extract as structured source chips.
  const recallMatch = content.match(/\[tool:recall_memory\][\s\S]*?(?=\[tool:|\nSummary:|$)/);
  const liveMatch = content.match(/\[tool:live_sql\][\s\S]*?(?=\[tool:|\nSummary:|$)/);
  const lines: { label: string; detail: string }[] = [];
  if (recallMatch) {
    const items = recallMatch[0]
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('-'));
    for (const l of items) {
      // "- (0.667) Line line-3, hour starting ... [hourly]"
      const m = l.match(/-\s*\(([\d.]+)\)\s*(.+)\s\[(.+)\]/);
      if (m) lines.push({ label: `${m[3]} · score ${m[1]}`, detail: m[2] ?? l });
      else lines.push({ label: 'recall', detail: l.slice(2) });
    }
  }
  if (liveMatch) lines.push({ label: 'live_sql', detail: liveMatch[0].replace('[tool:live_sql]', '').trim() });
  return lines;
}

function CodeBlock({ children, className }: { children: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const text = children ?? '';
  return (
    <div className="relative group/code my-2 overflow-hidden rounded-xl border" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="absolute right-2 top-2 rounded-md px-2 py-1 text-[11px] font-semibold opacity-0 transition group-hover/code:opacity-100"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--ink)' }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre className="overflow-x-auto p-3 text-[12.5px] leading-[1.5]">
        <code className={className}>{text}</code>
      </pre>
    </div>
  );
}

function Markdown({ content, streaming }: { content: string; streaming: boolean }) {
  // strip tool blocks from visible markdown — they go to Sources tray
  const visible = content.replace(/\[tool:.*\][\s\S]*?(?=\nSummary:|$)/g, '').trim() || content.trim();
  return (
    <div className="prose prose-sm max-w-none break-words text-[13.5px] leading-[1.6] prose-p:my-1 prose-headings:font-bold prose-code:text-[12.5px]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          a: (p) => <a {...p} className="underline decoration-[var(--accent)] underline-offset-2" target="_blank" rel="noreferrer" />,
          // @ts-ignore
          code: ({ inline, className, children, ...props }) => {
            if (inline) return <code className="rounded bg-[var(--line)] px-1 py-0.5 text-[12px]" {...props}>{children}</code>;
            return <CodeBlock className={className}>{String(children).replace(/\n$/, '')}</CodeBlock>;
          },
          table: (p) => <div className="my-2 overflow-x-auto"><table {...p} className="w-full border-collapse text-[12.5px]" /></div>,
          th: (p) => <th {...p} className="border bg-[var(--surface-2)] px-2 py-1 text-left font-semibold" style={{ borderColor: 'var(--line)' }} />,
          td: (p) => <td {...p} className="border px-2 py-1" style={{ borderColor: 'var(--line)' }} />,
        }}
      >
        {visible || (streaming ? '…' : '')}
      </ReactMarkdown>
      {streaming && <span className="cursor" aria-hidden />}
    </div>
  );
}

export function Chat({ onScheduleThis }: { onScheduleThis?: (q: string, a: string) => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ text: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastUserRef = useRef<string>('');

  const scrollDown = useCallback(() => {
    requestAnimationFrame(() => scroller.current?.scrollTo({ top: 1e9, behavior: 'smooth' }));
  }, []);

  // freshness badge (A+B advanced) — fetch once
  useEffect(() => {
    api.opsHealth().then((h) => setFresh({ text: `Data updated · mode ${h.status ?? 'mock'} · checks ${Object.values((h as any).checks ?? {}).filter(Boolean).length}/3 ok` })).catch(() => setFresh(null));
  }, []);

  // Esc to stop
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && streaming) stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const stop = () => {
    abortRef.current?.abort();
    setStreaming(false);
  };

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || streaming) return;
    lastUserRef.current = text;
    const userMsg: Msg = { id: `u-${Date.now()}`, role: 'user', content: text };
    const aiMsg: Msg = { id: `a-${Date.now()}`, role: 'assistant', content: '' };
    setMessages((m) => [...m, userMsg, aiMsg]);
    setInput('');
    setError(null);
    setStreaming(true);
    scrollDown();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const next: ChatMessage[] = [...messages, userMsg].map(({ role, content }) => ({ role, content }));
      // include current batch user msg
      next.push(userMsg);
      // dedupe: messages already includes previous, so sliced correctly above — simplify: just send history + new
      const history = messages.map(({ role, content }) => ({ role, content } as ChatMessage));
      const toSend: ChatMessage[] = [...history, { role: 'user', content: text }];
      for await (const chunk of api.chat(toSend, { signal: ac.signal })) {
        setMessages((m) => {
          const copy = m.slice();
          const last = copy[copy.length - 1]!;
          copy[copy.length - 1] = { ...last, content: last.content + chunk };
          return copy;
        });
        scrollDown();
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        setMessages((m) => {
          const copy = m.slice();
          const last = copy[copy.length - 1];
          if (last && last.content === '') copy[copy.length - 1] = { ...last, content: '_Interrupted_ — partial response kept.' };
          return copy;
        });
      } else {
        const msg = (e as Error).message || 'Could not get an answer.';
        setError(msg);
        setMessages((m) => {
          const copy = m.slice();
          copy[copy.length - 1] = { ...copy[copy.length - 1]!, content: `⚠️ ${msg}` };
          return copy;
        });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const retry = () => {
    // restore last assistant placeholder
    setMessages((m) => m.slice(0, -1));
    send(lastUserRef.current);
  };

  const clearChat = () => {
    if (streaming) stop();
    setMessages([]);
    setError(null);
  };

  const reuseUp = () => {
    if (input) return;
    if (lastUserRef.current) setInput(lastUserRef.current);
  };

  return (
    <div className="card card-glass flex h-full flex-col overflow-hidden" style={{ transform: 'translateZ(0)' }}>
      {/* top bar: freshness + clear */}
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-[11px]" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,0.02)' }}>
        <span className="muted truncate">{fresh?.text ?? 'Checking data freshness…'}</span>
        <div className="flex items-center gap-1">
          <span className="rounded-full border px-2 py-0.5 text-[10px] font-semibold" style={{ borderColor: 'var(--line)', color: 'var(--ink-soft)' }}>
            {streaming ? 'Responding…' : messages.length ? `${messages.length} msgs` : 'Ready'}
          </span>
          <button onClick={clearChat} className="btn !py-1 !text-[11px]" title="Clear chat">Clear</button>
        </div>
      </div>

      <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto p-5">
        {messages.length === 0 && (
          <div className="grid h-full place-items-center text-center">
            <div className="max-w-md space-y-3">
              <div className="text-[13.5px] font-semibold">Ask about OEE, downtime, throughput, scrap.</div>
              <p className="muted text-[12.5px]">Try markdown: tables, code, lists. Streaming shows a cursor ▌ and a Stop button. Sources appear under each answer.</p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {FOLLOW_CHIPS.map((c) => (
                  <button key={c} onClick={() => send(c)} className="btn !py-1 !text-[11px]">{c}</button>
                ))}
              </div>
              <div className="muted text-[11px]">Tip: Shift+Enter for new line, Enter to send, Esc to stop.</div>
            </div>
          </div>
        )}
        {messages.map((m, i) => {
          const isLastAi = i === messages.length - 1 && m.role === 'assistant';
          const sources = m.role === 'assistant' ? parseSources(m.content) : [];
          const isStreamingThis = isLastAi && streaming;
          return (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
            >
              <div
                className={`group/msg relative max-w-[84%] rounded-2xl px-3.5 py-2.5 text-[13.5px] ${m.role === 'assistant' ? 'bubble-glass' : 'bubble-user'}`}
                style={{
                  background: m.role === 'user' ? 'var(--accent)' : undefined,
                  color: m.role === 'user' ? 'var(--accent-ink)' : 'var(--ink)',
                  border: m.role === 'user' ? 'none' : undefined,
                  boxShadow: m.role === 'user' ? undefined : 'var(--shadow-sm)',
                }}
              >
                {m.role === 'user' ? (
                  <div className="whitespace-pre-wrap">{m.content}</div>
                ) : (
                  <>
                    <Markdown content={m.content} streaming={isStreamingThis} />
                    {/* Sources tray */}
                    {sources.length > 0 && (
                      <details className="mt-2 rounded-xl border text-[11.5px]" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
                        <summary className="cursor-pointer select-none px-2 py-1 font-semibold">
                          Sources · {sources.length} {isStreamingThis ? '(streaming)' : ''}
                        </summary>
                        <ul className="space-y-1 border-t p-2" style={{ borderColor: 'var(--line)' }}>
                          {sources.map((s, idx) => (
                            <li key={idx} className="flex gap-2">
                              <span className="shrink-0 rounded bg-[var(--line)] px-1.5 py-0.5 text-[10px] font-bold">{s.label}</span>
                              <span className="muted line-clamp-2">{s.detail}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {/* action row — hidden for streaming, shown after */}
                    {!isStreamingThis && m.content && (
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        <button
                          className="btn !py-1 !text-[10px]"
                          onClick={async () => {
                            await navigator.clipboard.writeText(m.content.replace(/\[tool:.*\][\s\S]*?(?=\nSummary:|$)/g, '').trim());
                          }}
                        >
                          Copy
                        </button>
                        <button
                          className="btn !py-1 !text-[10px]"
                          onClick={() => onScheduleThis?.(messages[i - 1]?.content ?? '', m.content)}
                          title="Pre-fill Schedules tab"
                        >
                          Schedule this
                        </button>
                        <span className="ml-1 inline-flex gap-1">
                          <button
                            title="Helpful"
                            onClick={() => {
                              setMessages((arr) => arr.map((x) => (x.id === m.id ? { ...x, feedback: 'up' } : x)));
                            }}
                            className="btn !px-2 !py-1 !text-[11px]"
                            style={{ background: m.feedback === 'up' ? 'var(--ok)' : undefined, color: m.feedback === 'up' ? '#fff' : undefined }}
                          >
                            👍
                          </button>
                          <button
                            title="Not helpful"
                            onClick={() => {
                              setMessages((arr) => arr.map((x) => (x.id === m.id ? { ...x, feedback: 'down' } : x)));
                            }}
                            className="btn !px-2 !py-1 !text-[11px]"
                            style={{ background: m.feedback === 'down' ? 'var(--warn)' : undefined, color: m.feedback === 'down' ? '#fff' : undefined }}
                          >
                            👎
                          </button>
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          );
        })}
        {/* in-stream error retry */}
        {error && !streaming && (
          <div className="flex justify-center">
            <button onClick={retry} className="btn btn-primary !text-[12px]">Retry</button>
          </div>
        )}
      </div>

      <div className="flex gap-2 border-t p-3" style={{ borderColor: 'var(--line)' }}>
        <textarea
          className="input min-h-[42px] max-h-32 resize-none"
          placeholder="Type a question… (Shift+Enter for new line)"
          value={input}
          rows={1}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' && !input) {
              e.preventDefault();
              reuseUp();
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
            if (e.key === 'Escape' && streaming) stop();
          }}
        />
        {streaming ? (
          <button className="btn !bg-[var(--warn)] !text-white !border-transparent" onClick={stop} title="Esc to stop">
            Stop
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => send()} disabled={!input.trim()}>
            Send
          </button>
        )}
      </div>
    </div>
  );
}
