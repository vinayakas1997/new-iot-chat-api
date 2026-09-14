export interface CheckState {
  connectionId: string;
  at: string;
  ok: boolean;
  latencyMs: number | null;
  tableCount: number | null;
  error: string | null;
}

export interface Connection {
  id: string;
  label: string;
  type: "postgres" | "mysql";
  host: string;
  port: number;
  database: string;
  username: string;
  schemaFilter: string | null;
  timeoutMs: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastCheck: CheckState | null;
}

export interface TableRef {
  schema: string;
  name: string;
}

export interface Line {
  id: string;
  name: string;
  connectionId: string;
  connectionLabel: string;
  memberTables: string[];
  active: boolean;
  lastTick: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TableDetail extends TableRef {
  rowCount: number | null;
  primaryKey: string[];
  columns: { name: string; type: string; nullable: boolean }[];
  sample: { columns: string[]; rows: Record<string, unknown>[] };
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
  return body as T;
}

export const api = {
  listConnections: () => req<Connection[]>("/api/ingest/connections"),
  createConnection: (input: Record<string, unknown>) =>
    req<Connection>("/api/ingest/connections", { method: "POST", body: JSON.stringify(input) }),
  updateConnection: (id: string, patch: Record<string, unknown>) =>
    req<Connection>(`/api/ingest/connections/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteConnection: (id: string) =>
    req<{ ok: boolean }>(`/api/ingest/connections/${id}`, { method: "DELETE" }),
  testConnection: (payload: Record<string, unknown>) =>
    req<{ ok: boolean; latencyMs?: number; tableCount?: number }>(
      "/api/ingest/connections/test",
      { method: "POST", body: JSON.stringify(payload) }
    ),
  listTables: (id: string) =>
    req<{ tables: TableRef[] }>(`/api/ingest/connections/${id}/tables`),
  describeTable: (id: string, schema: string, table: string) =>
    req<TableDetail>(`/api/ingest/connections/${id}/tables/${schema}/${table}`),
  listLines: (params?: { connectionId?: string; table?: string; q?: string }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return req<Line[]>(`/api/ingest/lines${qs ? `?${qs}` : ""}`);
  },
  createLine: (input: { id: string; name: string; connectionId: string; memberTables: string[] }) =>
    req<Line>("/api/ingest/lines", { method: "POST", body: JSON.stringify(input) }),
  updateLine: (id: string, patch: { name?: string; connectionId?: string; memberTables?: string[] }) =>
    req<Line>(`/api/ingest/lines/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deregisterLine: (id: string) =>
    req<Line>(`/api/ingest/lines/${id}/deregister`, { method: "POST" }),
  reregisterLine: (id: string) =>
    req<Line>(`/api/ingest/lines/${id}/reregister`, { method: "POST" }),
  unassignedTables: (connectionId: string) =>
    req<{ unassigned: string[] }>(`/api/ingest/lines-unassigned?connectionId=${connectionId}`),
};

/* ---- Hindsight banks (per-line provisioning) ---- */

export interface BankOverviewEntry {
  lineId: string;
  lineName: string;
  bankId: string;
  ready: boolean;
  draftSaved: boolean;
  greenCards: number;
  cards: number;
}

export interface BankPreview {
  lineId: string;
  lineName: string;
  bankId: string;
  ready: boolean;
  hindsightConfigured: boolean;
  tables: { table: string; columns: { name: string; type: string }[]; error?: string }[];
  missions: { retain: string; observations: string; reflect: string };
  extractionMode: "concise" | "verbose";
  entityLabels: { key: string; description: string; type: "value" | "multi-values"; values: { value: string; description: string }[]; tag: boolean }[];
  directives: { name: string; content: string; tags: string[] }[];
  disposition: { skepticism: number; literalism: number; empathy: number };
  observations: { enabled: boolean; autoConsolidate: boolean };
  mentalModel: { name: string; source_query: string };
  draft?: Partial<BankPlan>;
  draftSaved: boolean;
}

export interface BankPlan {
  missions: { retain: string; observations: string; reflect: string };
  extractionMode: "concise" | "verbose";
  entityLabels: BankPreview["entityLabels"];
  directives: { name: string; content: string; tags: string[] }[];
  disposition: { skepticism: number; literalism: number; empathy: number };
  observations: { enabled: boolean; autoConsolidate: boolean };
  mentalModel: { name: string; source_query: string };
}

export const bankApi = {
  overview: () =>
    req<{ hindsight: { configured: boolean; base: string | null }; banks: BankOverviewEntry[] }>("/api/ingest/banks"),
  preview: (lineId: string) => req<BankPreview>(`/api/ingest/banks/preview/${lineId}`),
  suggest: (lineId: string, kind: "entities" | "missions" | "mental-model" | "directives") =>
    req<{ kind: string; text: string; parsed: unknown; model: string; latencyMs: number }>("/api/ingest/banks/suggest", {
      method: "POST",
      body: JSON.stringify({ lineId, kind }),
    }),
  saveDraft: (lineId: string, plan: BankPlan) =>
    req<{ ok: boolean }>("/api/ingest/banks/draft", { method: "POST", body: JSON.stringify({ lineId, plan }) }),
  push: (lineId: string, plan: BankPlan) =>
    req<{ ok: boolean; bankId: string; directivesCreated: number; mentalModelOp: string | null; warnings: string[] }>(
      "/api/ingest/banks/push",
      { method: "POST", body: JSON.stringify({ lineId, plan }) }
    ),
};

export interface CardTemplate {
  id: string;
  name: string;
  description: string;
  sqlTemplate: string;
  granularity: "hourly" | "shift" | "daily";
  unit: string;
  extractHint: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Card {
  id: string;
  templateId: string | null;
  templateVersion: number | null;
  lineId: string;
  name: string;
  tables: string[];
  sql: string;
  granularity: "hourly" | "shift" | "daily";
  unit: string;
  extractHint: string;
  threshold: number | null;
  status: "live" | "dormant";
  version: number;
  lastTest: { at: string; ok: boolean; sqlHash: string | null; error: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

export interface TestResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  sql: string;
}

export interface ReapplyResult {
  templateId: string;
  templateVersion: number;
  sqlHash: string;
  results: { cardId: string; lineId: string; status: "green" | "red" | "skipped-live"; rowCount?: number; error?: string }[];
}

export const cardApi = {
  listTemplates: () => req<CardTemplate[]>("/api/ingest/templates"),
  createTemplate: (input: Record<string, unknown>) =>
    req<CardTemplate>("/api/ingest/templates", { method: "POST", body: JSON.stringify(input) }),
  updateTemplate: (id: string, patch: Record<string, unknown>) =>
    req<CardTemplate>(`/api/ingest/templates/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteTemplate: (id: string) => req<{ ok: boolean }>(`/api/ingest/templates/${id}`, { method: "DELETE" }),
  instantiate: (id: string, input: { lineId: string; name?: string; tables?: string[]; sql?: string }) =>
    req<Card>(`/api/ingest/templates/${id}/instantiate`, { method: "POST", body: JSON.stringify(input) }),
  reapply: (id: string, input: { sql?: string; activate?: boolean }) =>
    req<ReapplyResult>(`/api/ingest/templates/${id}/reapply`, { method: "POST", body: JSON.stringify(input) }),
  listCards: (lineId?: string) => req<Card[]>(`/api/ingest/cards${lineId ? `?lineId=${lineId}` : ""}`),
  createCard: (input: Record<string, unknown>) =>
    req<Card>("/api/ingest/cards", { method: "POST", body: JSON.stringify(input) }),
  updateCard: (id: string, patch: Record<string, unknown>) =>
    req<Card>(`/api/ingest/cards/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteCard: (id: string) => req<{ ok: boolean }>(`/api/ingest/cards/${id}`, { method: "DELETE" }),
  testCard: (id: string, from?: string, to?: string) =>
    req<TestResult>(`/api/ingest/cards/${id}/test`, { method: "POST", body: JSON.stringify({ from, to }) }),
  activateCard: (id: string) => req<Card>(`/api/ingest/cards/${id}/activate`, { method: "POST" }),
  dormantCard: (id: string) => req<Card>(`/api/ingest/cards/${id}/dormant`, { method: "POST" }),
};

export interface DaySummary {
  runs: number;
  ok: number;
  failed: number;
  rows: number;
  facts: number;
}

export interface RunRow {
  id: number;
  at: string;
  lineId: string;
  cardId: string;
  cardVersion: number;
  cardName: string;
  kind: "test" | "tick";
  ok: boolean;
  rowsPulled: number;
  unitsBuilt: number;
  factsStored: number;
  durationMs: number | null;
  error: string | null;
}

export interface DayView {
  lineId: string;
  date: string;
  summary: DaySummary;
  prevDate: string;
  prev: DaySummary;
  runs: RunRow[];
  failures: RunRow[];
}

export interface RunInterpretation {
  run: RunRow;
  cardName: string;
  contextIn: { sql: string; granularity: string; extractHint: string };
  factsOut: { stored: number; note: string };
}

export const historyApi = {
  line: (id: string) =>
    req<Line & { quietHours: number | null }>(`/api/ingest/history/line/${id}`),
  month: (lineId: string, month: string) =>
    req<{ lineId: string; month: string; days: Record<string, DaySummary> }>(
      `/api/ingest/history/month?lineId=${lineId}&month=${month}`
    ),
  day: (lineId: string, date: string) =>
    req<DayView>(`/api/ingest/history/day?lineId=${lineId}&date=${date}`),
  run: (id: number) => req<RunInterpretation>(`/api/ingest/history/run/${id}`),
};

/* ---- Playground (SQL workbench) ---- */

export interface PlaygroundResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  capped: boolean;
  durationMs: number;
  sql: string;
}

export interface QueryHistoryEntry {
  id: number;
  lineId: string;
  sql: string;
  rowCount: number | null;
  durationMs: number | null;
  ok: boolean;
  error: string | null;
  createdAt: string;
}

export interface LineColumn {
  table: string;
  name: string;
  type: string;
}

export const playgroundApi = {
  run: (lineId: string, sql: string, from?: string, to?: string) =>
    req<PlaygroundResult>("/api/ingest/playground/run", {
      method: "POST",
      body: JSON.stringify({ lineId, sql, from, to }),
    }),
  history: (lineId: string) =>
    req<QueryHistoryEntry[]>(`/api/ingest/playground/history/${lineId}`),
  columns: (lineId: string) =>
    req<{ columns: LineColumn[] }>(`/api/ingest/playground/columns/${lineId}`),
};

/* ---- Graph specs (stored visualizations) ---- */

export type ChartType = "table" | "line" | "bar" | "area";

export interface GraphSpec {
  id: string;
  cardId: string;
  name: string;
  chartType: ChartType;
  xColumn: string;
  yColumns: string[];
  title: string;
  config: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const graphApi = {
  listForCard: (cardId: string) =>
    req<GraphSpec[]>(`/api/ingest/cards/${cardId}/graphs`),
  create: (cardId: string, input: Partial<GraphSpec>) =>
    req<GraphSpec>(`/api/ingest/cards/${cardId}/graphs`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  update: (id: string, patch: Partial<GraphSpec>) =>
    req<GraphSpec>(`/api/ingest/graphs/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  delete: (id: string) =>
    req<{ ok: boolean }>(`/api/ingest/graphs/${id}`, { method: "DELETE" }),
};
