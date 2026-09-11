const BASE = '/api';

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error);
  return res.json() as Promise<T>;
}

export interface JobStatus {
  jobName: 'ingest' | 'scheduler';
  healthy: boolean;
  reason?: string;
  lastRun: null | {
    startedAt: string;
    finishedAt: string | null;
    status: string;
    pendingCount: number;
    error: string | null;
  };
}

export interface SchedRow {
  id: string;
  userId: string;
  queryText: string;
  active: boolean;
  timeOfDay: string;
  timezone: string;
  lastRunAt: string | null;
  lastResult: string | null;
  nextRunAt: string | null;
}

export const ops = {
  me: () => j<{ username: string }>('/ops/me'),
  login: (username: string, password: string) =>
    j<{ username: string }>('/ops/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => j<{ ok: true }>('/ops/logout', { method: 'POST' }),
  jobs: () => j<{ jobs: JobStatus[] }>('/ops/jobs'),
  runs: (name: string) =>
    j<{ runs: { startedAt: string; finishedAt: string | null; status: string; pendingCount: number; error: string | null }[] }>(
      `/ops/jobs/${name}/runs`,
    ),
  schedules: () => j<{ schedules: SchedRow[] }>('/ops/schedules'),
  runIngest: () => j<{ started: boolean; pid?: number }>('/ops/ingest/run', { method: 'POST' }),
};
