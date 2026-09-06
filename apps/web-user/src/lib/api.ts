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
  previewSchedule: (message: string) =>
    j<{ parsed: unknown; humanCron: string }>('/schedules/preview', {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),
  createSchedule: (message: string) =>
    j<{ schedule: Schedule }>('/schedules', { method: 'POST', body: JSON.stringify({ message }) }),
  toggleSchedule: (id: string, active: boolean) =>
    j<{ schedule: Schedule }>(`/schedules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active }),
    }),
  deleteSchedule: (id: string) => j<{ ok: true }>(`/schedules/${id}`, { method: 'DELETE' }),

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

  /** Streaming chat — yields text chunks. */
  async *chat(messages: ChatMessage[]): AsyncGenerator<string> {
    const res = await fetch(BASE + '/chat', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages }),
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
};
