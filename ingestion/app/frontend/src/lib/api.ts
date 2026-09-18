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
  const hasBody = init?.body != null;
  const r = await fetch(path, {
    ...init,
    // A bodyless POST with content-type: application/json makes Fastify's
    // JSON parser 400 ("Body cannot be empty...") before any handler runs.
    // Send the header only when there is actually a body.
    headers: { ...(hasBody ? { "content-type": "application/json" } : {}), ...init?.headers },
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
  deleteLine: (id: string) =>
    req<{ ok: boolean }>(`/api/ingest/lines/${id}`, { method: "DELETE" }),
  unassignedTables: (connectionId: string) =>
    req<{ unassigned: string[] }>(`/api/ingest/lines-unassigned?connectionId=${connectionId}`),
  columnMeta: (lineId: string) =>
    req<{ meta: { lineId: string; tableName: string; columnName: string; meaning: string; datatype: string }[] }>(`/api/ingest/lines/${lineId}/columns/meta`),
  tableColumns: (lineId: string, schema: string, table: string) =>
    req<{ schema: string; table: string; rowCount: number | null; primaryKey: string[]; columns: { name: string; type: string; nullable: boolean; description?: string; meaning: string; datatype: string; sampleValues?: string[] }[]; sample: { columns: string[]; rows: Record<string, unknown>[] }; analyzed: { total: number; filled: number; analyzed: boolean } }>(`/api/ingest/lines/${lineId}/tables/${schema}/${table}/columns`),
  analyzeTable: (lineId: string, schema: string, table: string) =>
    req<{ schema: string; table: string; rowCount: number | null; primaryKey: string[]; columns: { name: string; type: string; nullable: boolean; description?: string; meaning: string; datatype: string; sampleValues?: string[] }[]; sample: { columns: string[]; rows: Record<string, unknown>[] }; drafted: { name: string; meaning: string }[]; analyzed: { total: number; filled: number; analyzed: boolean } }>(`/api/ingest/lines/${lineId}/tables/${schema}/${table}/analyze`, { method: "POST" }),
  llmFillTable: (lineId: string, schema: string, table: string, columns?: string[]) =>
    req<{ drafted: { name: string; meaning: string }[]; model?: string; reason?: string | null }>(`/api/ingest/lines/${lineId}/tables/${schema}/${table}/llm-fill`, { method: "POST", body: JSON.stringify({ columns }) }),
  saveTableColumns: (lineId: string, schema: string, table: string, columns: { name: string; meaning: string; datatype?: string }[]) =>
    req<{ saved: { lineId: string; tableName: string; columnName: string; meaning: string; datatype: string }[] }>(`/api/ingest/lines/${lineId}/tables/${schema}/${table}/columns`, { method: "POST", body: JSON.stringify({ columns }) }),
  // Draft analyze — no line required, connection-scoped. Used by Register line before the line row exists.
  analyzeTableDraft: (connectionId: string, schema: string, table: string) =>
    req<{ schema: string; table: string; rowCount: number | null; primaryKey: string[]; columns: { name: string; type: string; nullable: boolean; description?: string; meaning: string; datatype: string; sampleValues?: string[] }[]; sample: { columns: string[]; rows: Record<string, unknown>[] }; drafted: { name: string; meaning: string }[]; analyzed: { total: number; filled: number; analyzed: boolean } }>(`/api/ingest/connections/${connectionId}/tables/${schema}/${table}/analyze`, { method: "POST" }),
  llmFillTableDraft: (connectionId: string, schema: string, table: string, columns?: string[]) =>
    req<{ drafted: { name: string; meaning: string }[]; model?: string; reason?: string | null }>(`/api/ingest/connections/${connectionId}/tables/${schema}/${table}/llm-fill`, { method: "POST", body: JSON.stringify({ columns }) }),
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
  extractionMode: "chunks" | "concise" | "verbose";
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
  extractionMode: "chunks" | "concise" | "verbose";
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
    req<{ kind: string; text: string; parsed: unknown; model: string | null; latencyMs: number; attempts: number; reason: string | null }>("/api/ingest/banks/suggest", {
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

export interface ChartSuggestion {
  chartType: ChartType;
  xColumn: string;
  yColumns: string[];
  title: string;
  rationale: string;
  conditions: string;
  enabled?: boolean;
  resolutions?: string[];
  xCondition?: { column: string; bucket: string } | null;
  yConditions?: { column: string; op: string; value: number }[];
}

export interface CardTemplate {
  id: string;
  name: string;
  description: string;
  referenceLineId: string | null;
  sqlTemplate: string;
  granularity: "hourly" | "shift" | "daily";
  unit: string;
  extractHint: string;
  context: string;
  chartSuggestions: ChartSuggestion[];
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
  context: string;
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
  reapply: (id: string, input: { sql?: string; activate?: boolean; cardIds?: string[]; lineId?: string }) =>
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

/* ---- F6 AI Logs: every backend LLM call, success or failure ---- */

export interface LlmCallAttempt {
  n: number;
  outcome: "ok" | "failed" | "rejected";
  detail: string;
  latencyMs: number;
  temperature?: number;
}

export interface LlmCallRecord {
  id: number;
  at: string;
  route: string;
  lineId: string | null;
  cardId: string | null;
  templateId: string | null;
  model: string;
  success: boolean;
  reason: string | null;
  attempts: number;
  latencyMs: number;
  attemptsJson: LlmCallAttempt[];
  prompt: string;
  responseText: string;
  parsedJson: unknown | null;
}

export interface LlmCallStats {
  last24h: number;
  okRate: number | null;
  avgLatencyMs: number;
  retries24h: number;
  retained: number;
  cap: number;
}

export interface LlmCallFilter {
  route?: string;
  line?: string;
  date?: string;
  ok?: "true" | "false" | "all";
  q?: string;
  limit?: number;
  offset?: number;
}

export const aiLogsApi = {
  stats: () => req<LlmCallStats>("/api/ingest/llm/calls/stats"),
  list: (f: LlmCallFilter) => {
    const p = new URLSearchParams();
    if (f.route) p.set("route", f.route);
    if (f.line) p.set("line", f.line);
    if (f.date) p.set("date", f.date);
    if (f.ok && f.ok !== "all") p.set("ok", f.ok);
    if (f.q) p.set("q", f.q);
    p.set("limit", String(f.limit ?? 50));
    p.set("offset", String(f.offset ?? 0));
    return req<{ rows: LlmCallRecord[]; total: number }>(`/api/ingest/llm/calls?${p.toString()}`);
  },
  get: (id: number) => req<LlmCallRecord>(`/api/ingest/llm/calls/${id}`),
};

/* ---- Chart recommendations (one-time LLM steps) ---- */

export interface RecommendResponse {
  suggestions: ChartSuggestion[];
  stored: boolean;
  model: string | null;
  heuristic: boolean;
  /** Why the heuristic was used; null on an LLM-backed result. */
  reason: string | null;
}

/** Human-readable cause for an LLM fallback — shown in badge tooltips. */
export function llmReasonText(reason: string | null | undefined): string {
  switch (reason) {
    case "no-provider": return "no LLM provider active";
    case "timeout": return "LLM timed out — retries exhausted";
    case "http-5xx": return "LLM server error — retries exhausted";
    case "http-4xx": return "LLM rejected the request";
    case "network": return "could not reach the LLM";
    case "empty": return "LLM returned nothing — retries exhausted";
    case "bad-json": return "LLM output was not parseable JSON — retries exhausted";
    case "schema-reject": return "LLM output failed validation — retries exhausted";
    case "no-valid-candidates": return "LLM answered but nothing survived validation";
    default: return "heuristic fallback";
  }
}

export interface MergeProposal {
  primaryCardId: string;
  cardIds: string[];
  chartType: "line" | "bar" | "area";
  xColumn: string;
  series: { cardId: string; cardName: string; column: string }[];
  title: string;
  rationale: string;
}

export const chartApi = {
  recommendTemplate: (id: string) =>
    req<RecommendResponse>(`/api/ingest/templates/${id}/recommend-charts`, { method: "POST", body: JSON.stringify({}) }),
  sampleTemplate: (id: string, from?: string, to?: string) =>
    req<TestResult>(`/api/ingest/templates/${id}/sample`, { method: "POST", body: JSON.stringify({ from, to }) }),
  setSuggestions: (id: string, enabled: boolean[]) =>
    req<CardTemplate>(`/api/ingest/templates/${id}/suggestions`, { method: "PATCH", body: JSON.stringify({ enabled }) }),
  recommendCard: (id: string) =>
    req<RecommendResponse>(`/api/ingest/cards/${id}/recommend-charts`, { method: "POST", body: JSON.stringify({}) }),
  optimizeLine: (lineId: string) =>
    req<{ proposals: MergeProposal[]; note?: string; skipped?: string[] }>(`/api/ingest/lines/${lineId}/optimize-charts`, { method: "POST", body: JSON.stringify({}) }),
  querySample: (lineId: string, sql: string, from?: string, to?: string) =>
    req<TestResult>(`/api/ingest/lines/${lineId}/query-sample`, { method: "POST", body: JSON.stringify({ sql, from, to }) }),
};

export const columnTemplateApi = {
  list: () => req<{ id: string; name: string; columns: { name: string; meaning: string; datatype: string }[]; createdAt: string; updatedAt: string }[]>("/api/ingest/column-templates"),
  create: (name: string, columns: { name: string; meaning: string; datatype: string }[]) =>
    req<{ id: string; name: string; columns: { name: string; meaning: string; datatype: string }[] }>("/api/ingest/column-templates", { method: "POST", body: JSON.stringify({ name, columns }) }),
  remove: (id: string) => req<{ ok: boolean }>(`/api/ingest/column-templates/${id}`, { method: "DELETE" }),
};

export const globalTableApi = {
  meta: (connectionId?: string) =>
    req<{ meta: { tableName: string; connectionId: string; sourceLineId: string; sourceLineName: string; total: number; filled: number; analyzed: boolean; columns: { name: string; meaning: string; datatype: string }[] }[] }>(`/api/ingest/global/tables/meta${connectionId ? `?connectionId=${connectionId}` : ""}`),
};
