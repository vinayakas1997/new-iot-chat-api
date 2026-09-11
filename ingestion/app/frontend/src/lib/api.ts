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
