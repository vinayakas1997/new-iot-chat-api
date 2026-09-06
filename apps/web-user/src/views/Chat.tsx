import { motion } from 'framer-motion';
import { useRef, useState } from 'react';
import type { ChatMessage } from '@app/shared';
import { api } from '../lib/api.js';

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const scrollDown = () =>
    requestAnimationFrame(() => scroller.current?.scrollTo({ top: 1e9, behavior: 'smooth' }));

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages([...next, { role: 'assistant', content: '' }]);
    setInput('');
    setStreaming(true);
    scrollDown();
    try {
      for await (const chunk of api.chat(next)) {
        setMessages((m) => {
          const copy = m.slice();
          copy[copy.length - 1] = {
            role: 'assistant',
            content: copy[copy.length - 1]!.content + chunk,
          };
          return copy;
        });
        scrollDown();
      }
    } catch {
      setMessages((m) => {
        const copy = m.slice();
        copy[copy.length - 1] = { role: 'assistant', content: '⚠️ Could not get an answer.' };
        return copy;
      });
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto p-5">
        {messages.length === 0 && (
          <div className="muted grid h-full place-items-center text-center text-[13px]">
            Ask about OEE, downtime, throughput, scrap, or recent events on the line.
          </div>
        )}
        {messages.map((m, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
          >
            <div
              className="max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13.5px]"
              style={{
                background: m.role === 'user' ? 'var(--accent)' : 'var(--surface-2)',
                color: m.role === 'user' ? 'var(--accent-ink)' : 'var(--ink)',
                border: m.role === 'user' ? 'none' : '1px solid var(--line)',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              {m.content || (streaming && i === messages.length - 1 ? '…' : '')}
            </div>
          </motion.div>
        ))}
      </div>
      <div className="flex gap-2 border-t p-3" style={{ borderColor: 'var(--line)' }}>
        <input
          className="input"
          placeholder="Type a question…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <button className="btn btn-primary" onClick={send} disabled={streaming || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
