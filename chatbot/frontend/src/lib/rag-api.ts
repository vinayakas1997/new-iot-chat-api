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
  createSchedule: (input: { name: string; lineId: string; questions: string[]; format: Schedule["format"]; time: string }) =>
    req<Schedule>("/api/rag/schedules", { method: "POST", body: JSON.stringify(input) }),
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
