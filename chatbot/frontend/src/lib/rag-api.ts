export interface ChartDatum {
  chart_type: "table" | "line" | "bar" | "area";
  title: string;
  x_column: string;
  y_columns: string[];
  columns: string[];
  rows: Record<string, unknown>[];
  spec_id?: string;
}

export interface LineAnswer {
  lineId: string;
  summary: string;
  charts: ChartDatum[];
  sources: { tool: string; detail?: string }[];
}

export interface ChatAnswer {
  summary: string;
  charts: ChartDatum[];
  sources: { tool: string; detail?: string }[];
  lines: LineAnswer[];
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body != null;
  const r = await fetch(path, { ...init, headers: { ...(hasBody ? { "content-type": "application/json" } : {}), ...init?.headers } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
  return body as T;
}

export interface ChatSession {
  id: string;
  title: string;
  lineIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatMsg {
  id: number;
  role: "user" | "assistant";
  content: string;
  charts: ChartDatum[];
  sources: { tool: string; detail?: string }[];
  createdAt: string;
}

export interface Schedule {
  id: string;
  name: string;
  lineId: string;
  questions: string[];
  format: "headline" | "kpi" | "table";
  cron: string;
  timezone: string;
  enabled: boolean;
  lastRun: string | null;
  lastStatus: string | null;
  nextRun: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleInput {
  name: string;
  lineId: string;
  questions: string[];
  format: Schedule["format"];
  time: string;
  timezone?: string;
  enabled?: boolean;
}

const TZ_LABELS: Record<string, string> = {
  "Asia/Kolkata": "IST",
  UTC: "UTC",
  "Asia/Dubai": "GST",
  "Asia/Singapore": "SGT",
  "Europe/London": "GMT",
  "America/New_York": "ET",
};

export function tzShort(tz: string): string {
  return TZ_LABELS[tz] ?? tz.split("/").pop() ?? tz;
}

/** "30 8 * * *" → "08:30"; null for non-daily crons. */
export function cronToTime(cron: string): string | null {
  const m = cron.trim().match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (!m) return null;
  return `${m[2].padStart(2, "0")}:${m[1].padStart(2, "0")}`;
}

/** Relative time like "2h ago" / "in 3h" for card status lines. */
export function relTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = new Date(iso).getTime() - Date.now();
  const mins = Math.round(Math.abs(diff) / 60000);
  const unit = mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`;
  return diff > 0 ? `in ${unit}` : `${unit} ago`;
}

export interface Report {
  id: number;
  scheduleId: string;
  at: string;
  questions: string[];
  answer: { headline?: string; sections?: { question: string; answer: ChatAnswer }[]; charts?: ChartDatum[]; sources?: unknown[] };
  ok: boolean;
  error: string | null;
}

export const ragApi = {
  lines: () => req<{ id: string; name: string }[] | { lines: { id: string; name: string }[] }>("/api/rag/lines"),
  sessions: () => req<ChatSession[]>("/api/rag/sessions"),
  newSession: (lineIds: string[]) => req<ChatSession>("/api/rag/sessions", { method: "POST", body: JSON.stringify({ lineIds }) }),
  messages: (id: string) => req<ChatMsg[]>(`/api/rag/sessions/${id}/messages`),
  deleteSession: (id: string) => req<{ ok: boolean }>(`/api/rag/sessions/${id}`, { method: "DELETE" }),
  schedules: () => req<Schedule[]>("/api/rag/schedules"),
  createSchedule: (input: ScheduleInput) =>
    req<Schedule>("/api/rag/schedules", { method: "POST", body: JSON.stringify(input) }),
  updateSchedule: (id: string, patch: Partial<ScheduleInput>) =>
    req<Schedule>(`/api/rag/schedules/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  toggleSchedule: (id: string, enabled: boolean) =>
    req<Schedule>(`/api/rag/schedules/${id}`, { method: "PATCH", body: JSON.stringify({ enabled }) }),
  deleteSchedule: (id: string) => req<{ ok: boolean }>(`/api/rag/schedules/${id}`, { method: "DELETE" }),
  runSchedule: (id: string) => req<Report>(`/api/rag/schedules/${id}/run`, { method: "POST" }),
  reports: (params?: { scheduleId?: string; date?: string }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return req<Report[]>(`/api/rag/reports${qs ? `?${qs}` : ""}`);
  },
  report: (id: number) => req<Report>(`/api/rag/reports/${id}`),
};

/** NDJSON chat stream: onText per delta, returns final answer + sessionId. */
export async function streamChat(
  input: { sessionId?: string; lineIds: string[]; message: string },
  onText: (delta: string) => void,
  signal?: AbortSignal
): Promise<{ answer: ChatAnswer; sessionId: string }> {
  const r = await fetch("/api/rag/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw new Error((b as { error?: string }).error ?? `HTTP ${r.status}`);
  }
  const reader = r.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let final: { answer: ChatAnswer; sessionId: string } | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const line of parts) {
      if (!line.trim()) continue;
      const evt = JSON.parse(line) as { type: string; delta?: string; answer?: ChatAnswer; sessionId?: string };
      if (evt.type === "text" && evt.delta) onText(evt.delta);
      if (evt.type === "final" && evt.answer) final = { answer: evt.answer, sessionId: evt.sessionId! };
    }
  }
  if (!final) throw new Error("stream ended without final answer");
  return final;
}
