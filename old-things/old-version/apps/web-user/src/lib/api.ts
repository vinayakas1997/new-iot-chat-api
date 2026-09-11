import type { ChatMessage, Schedule } from '@app/shared';

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
  previewScheduleStructured: (p: { heading?: string; queryText: string; timeOfDay: string; timezone: string; recurrence: Schedule['recurrence']; weekday?: number; onDate?: string }) =>
    j<{ parsed: unknown; humanCron: string; cronExpr: string }>('/schedules/preview', {
      method: 'POST',
      body: JSON.stringify(p),
    }),
  createSchedule: (message: string, timezone?: string) =>
    j<{ schedule: Schedule }>('/schedules', { method: 'POST', body: JSON.stringify({ message, timezone }) }),
  createScheduleStructured: (p: { heading?: string; queryText: string; timeOfDay: string; timezone: string; recurrence: Schedule['recurrence']; weekday?: number; onDate?: string }) =>
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

  historyDays: () => j<{ days: string[] }>('/history/days'),
  history: (from: string, to: string) =>
    j<
      {
        id: string;
        source: 'chat' | 'report';
        question: string;
        answer: string;
        createdAt: string;
      }[]
    >(`/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),

  /** Streaming chat — yields text chunks. Supports abort via AbortSignal. */
  async *chat(messages: ChatMessage[], opts?: { signal?: AbortSignal }): AsyncGenerator<string> {
    const res = await fetch(BASE + '/chat', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal: opts?.signal,
    });
    if (!res.ok || !res.body) throw new Error(`chat failed: ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield dec.decode(value, { stream: true });
    }
  },

  feedback: (id: string, vote: 'up' | 'down', note?: string) =>
    j<{ ok: true }>(`/history/${id}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ vote, note }),
    }),

  opsHealth: () => j<{ status: string; checks: Record<string, boolean> }>('/health'),
};
