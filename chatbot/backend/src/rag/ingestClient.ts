export const INGEST_BASE = (process.env.INGEST_BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");
export const HINDSIGHT_BASE_ENV = process.env.HINDSIGHT_BASE_URL ?? "";

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${INGEST_BASE}${path}`);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `ingest HTTP ${r.status} ${path}`);
  return body as T;
}

async function post<T>(path: string, payload: unknown): Promise<T> {
  const r = await fetch(`${INGEST_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `ingest HTTP ${r.status} ${path}`);
  return body as T;
}

export interface IngestLine {
  id: string;
  name: string;
  connectionId: string;
  memberTables: string[];
  active: boolean;
}

export interface GraphSpec {
  id: string;
  cardId: string;
  name: string;
  chartType: "table" | "line" | "bar" | "area";
  xColumn: string;
  yColumns: string[];
  title: string;
  config: Record<string, unknown>;
}

export interface ActiveLlm {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
}

let hsBaseCache: string | null | undefined;

export async function hindsightBase(): Promise<string | null> {
  if (HINDSIGHT_BASE_ENV) return HINDSIGHT_BASE_ENV.replace(/\/$/, "");
  if (hsBaseCache !== undefined) return hsBaseCache;
  try {
    const s = await get<{ url?: string; configured?: boolean }>(`/api/ingest/hindsight/status`);
    hsBaseCache = s.url ? s.url.replace(/\/health\/?$/, "") : null;
  } catch {
    hsBaseCache = null;
  }
  return hsBaseCache;
}

export const ingest = {
  listLines: () => get<IngestLine[]>(`/api/ingest/lines`),
  listCards: (lineId: string) => get<{ id: string; name: string; sql: string }[]>(`/api/ingest/cards?lineId=${encodeURIComponent(lineId)}`),
  graphsForCard: (cardId: string) => get<GraphSpec[]>(`/api/ingest/cards/${encodeURIComponent(cardId)}/graphs`),
  lineColumns: (lineId: string) => get<{ columns: { table: string; name: string; type: string }[] }>(`/api/ingest/playground/columns/${encodeURIComponent(lineId)}`),
  runSql: (lineId: string, sql: string) =>
    post<{ columns: string[]; rows: Record<string, unknown>[]; rowCount: number; durationMs: number }>(`/api/ingest/playground/run`, { lineId, sql }),
  activeLlm: async (): Promise<ActiveLlm | null> => {
    const r = await get<{ active: ActiveLlm | null }>(`/api/ingest/llm/active`);
    return r.active;
  },
};
