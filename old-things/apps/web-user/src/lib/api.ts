import type { ChatAnswer, ChatMessage, LineEntry, Schedule } from '@app/shared';

const BASE = '/api';

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export interface Me {
  userId: string;
  username: string;
  theme: 'system' | 'light' | 'dark';
}

export const api = {
  me: () => j<Me>('/auth/me'),
  login: (username: string, password: string) =>
    j<{ userId: string; username: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => j<{ ok: true }>('/auth/logout', { method: 'POST' }),

  setTheme: (theme: Me['theme']) =>
    j<{ theme: string }>('/settings/theme', { method: 'PUT', body: JSON.stringify({ theme }) }),

  schedules: () => j<{ schedules: Schedule[] }>('/schedules'),
  previewSchedule: (message: string, timezone?: string) =>
    j<{ parsed: unknown; humanCron: string; cronExpr: string }>('/schedules/preview', {
      method: 'POST',
      body: JSON.stringify({ message, timezone }),
    }),
  previewScheduleStructured: (p: { heading?: string; queryText: string; lineId?: string; timeOfDay: string; timezone?: string; recurrence: Schedule['recurrence']; weekday?: number; onDate?: string }) =>
    j<{ parsed: unknown; humanCron: string; cronExpr: string }>('/schedules/preview', {
      method: 'POST',
      body: JSON.stringify(p),
    }),
  createSchedule: (message: string, timezone?: string) =>
    j<{ schedule: Schedule }>('/schedules', { method: 'POST', body: JSON.stringify({ message, timezone }) }),
  createScheduleStructured: (p: { heading?: string; queryText: string; lineId?: string; timeOfDay: string; timezone?: string; recurrence: Schedule['recurrence']; weekday?: number; onDate?: string }) =>
    j<{ schedule: Schedule }>('/schedules', { method: 'POST', body: JSON.stringify(p) }),
  toggleSchedule: (id: string, active: boolean) =>
    j<{ schedule: Schedule }>(`/schedules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active }),
    }),
  deleteSchedule: async (id: string) => {
    const res = await fetch(BASE + `/schedules/${id}`, { method: 'DELETE', credentials: 'include' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<{ ok: true }>;
  },

  lines: () => j<{ lines: LineEntry[] }>('/lines'),

  historyDays: () => j<{ days: string[] }>('/history/days'),
  history: (from: string, to: string, line?: string) =>
    j<
      {
        id: string;
        source: 'chat' | 'report';
        question: string;
        answer: string;
        charts: ChatAnswer['charts'];
        createdAt: string;
      }[]
    >(`/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${line ? `&line=${encodeURIComponent(line)}` : ''}`),

  /**
   * Streaming chat — NDJSON envelope (see shared ChatChunk):
   * yields {summaryDelta} text pieces, resolves with the final ChatAnswer.
   */
  async *chatEnveloped(
    messages: ChatMessage[],
    opts?: { signal?: AbortSignal; lineIds?: string[] },
  ): AsyncGenerator<{ delta?: string; final?: ChatAnswer }> {
    const res = await fetch(BASE + '/chat', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages, lineIds: opts?.lineIds ?? [] }),
      signal: opts?.signal,
    });
    if (!res.ok || !res.body) throw new Error(`chat failed: ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        try {
          const chunk = JSON.parse(t) as { type: string; delta?: string; answer?: ChatAnswer };
          if (chunk.type === 'text' && chunk.delta) yield { delta: chunk.delta };
          else if (chunk.type === 'final' && chunk.answer) yield { final: chunk.answer };
        } catch {
          yield { delta: t };
        }
      }
    }
    if (buf.trim()) {
      try {
        const chunk = JSON.parse(buf) as { type: string; delta?: string; answer?: ChatAnswer };
        if (chunk.type === 'text' && chunk.delta) yield { delta: chunk.delta };
        else if (chunk.type === 'final' && chunk.answer) yield { final: chunk.answer };
      } catch {
        yield { delta: buf };
      }
    }
  },

  /** Legacy text-only chat — kept for callers that only need the summary. */
  async *chat(messages: ChatMessage[], opts?: { signal?: AbortSignal }): AsyncGenerator<string> {
    for await (const c of api.chatEnveloped(messages, opts)) {
      if (c.delta) yield c.delta;
    }
  },

  feedback: (id: string, vote: 'up' | 'down', note?: string) =>
    j<{ ok: true }>(`/history/${id}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ vote, note }),
    }),

  opsHealth: () => j<{ status: string; checks: Record<string, boolean> }>('/health'),
};
