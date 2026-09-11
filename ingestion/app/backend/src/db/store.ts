import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type DbType = "postgres" | "mysql";

export interface ConnectionRecord {
  id: string;
  label: string;
  type: DbType;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  schemaFilter: string | null;
  timeoutMs: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionInput {
  label: string;
  type: DbType;
  host: string;
  port?: number;
  database: string;
  username: string;
  password: string;
  schemaFilter?: string | null;
  timeoutMs?: number;
  enabled?: boolean;
}

const DEFAULT_PORT: Record<DbType, number> = { postgres: 5432, mysql: 3306 };

let db: Database.Database | null = null;

export function openStore(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('postgres','mysql')),
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      database TEXT NOT NULL,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      schema_filter TEXT,
      timeout_ms INTEGER NOT NULL DEFAULT 10000,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS connection_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
      at TEXT NOT NULL,
      ok INTEGER NOT NULL,
      latency_ms INTEGER,
      table_count INTEGER,
      error TEXT
    );
  `);
  return db;
}

function getDb(): Database.Database {
  if (!db) throw new Error("store not opened");
  return db;
}

function rowToRecord(r: Record<string, unknown>): ConnectionRecord {
  return {
    id: r.id as string,
    label: r.label as string,
    type: r.type as DbType,
    host: r.host as string,
    port: r.port as number,
    database: r.database as string,
    username: r.username as string,
    password: r.password as string,
    schemaFilter: (r.schema_filter as string) ?? null,
    timeoutMs: r.timeout_ms as number,
    enabled: (r.enabled as number) === 1,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function listConnections(): ConnectionRecord[] {
  return getDb()
    .prepare("SELECT * FROM connections ORDER BY label")
    .all()
    .map((r) => rowToRecord(r as Record<string, unknown>));
}

export function getConnection(id: string): ConnectionRecord | null {
  const r = getDb().prepare("SELECT * FROM connections WHERE id = ?").get(id);
  return r ? rowToRecord(r as Record<string, unknown>) : null;
}

export function createConnection(input: ConnectionInput): ConnectionRecord {
  const now = new Date().toISOString();
  const id = `conn-${Date.now().toString(36)}`;
  const rec: ConnectionRecord = {
    id,
    label: input.label,
    type: input.type,
    host: input.host,
    port: input.port ?? DEFAULT_PORT[input.type],
    database: input.database,
    username: input.username,
    password: input.password,
    schemaFilter: input.schemaFilter ?? null,
    timeoutMs: input.timeoutMs ?? 10000,
    enabled: input.enabled ?? true,
    createdAt: now,
    updatedAt: now,
  };
  getDb()
    .prepare(
      `INSERT INTO connections
       (id,label,type,host,port,database,username,password,schema_filter,timeout_ms,enabled,created_at,updated_at)
       VALUES (@id,@label,@type,@host,@port,@database,@username,@password,@schemaFilter,@timeoutMs,@enabled,@createdAt,@updatedAt)`
    )
    .run({
      ...rec,
      schemaFilter: rec.schemaFilter,
      enabled: rec.enabled ? 1 : 0,
    });
  return rec;
}

export function updateConnection(
  id: string,
  patch: Partial<ConnectionInput>
): ConnectionRecord | null {
  const cur = getConnection(id);
  if (!cur) return null;
  const next: ConnectionRecord = {
    ...cur,
    label: patch.label ?? cur.label,
    type: patch.type ?? cur.type,
    host: patch.host ?? cur.host,
    port: patch.port ?? cur.port,
    database: patch.database ?? cur.database,
    username: patch.username ?? cur.username,
    password: patch.password ?? cur.password,
    schemaFilter: patch.schemaFilter ?? cur.schemaFilter,
    timeoutMs: patch.timeoutMs ?? cur.timeoutMs,
    enabled: patch.enabled ?? cur.enabled,
    updatedAt: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `UPDATE connections SET label=@label,type=@type,host=@host,port=@port,
       database=@database,username=@username,password=@password,
       schema_filter=@schemaFilter,timeout_ms=@timeoutMs,enabled=@enabled,
       updated_at=@updatedAt WHERE id=@id`
    )
    .run({ ...next, enabled: next.enabled ? 1 : 0 });
  return next;
}

export function deleteConnection(id: string): boolean {
  const r = getDb().prepare("DELETE FROM connections WHERE id = ?").run(id);
  return r.changes > 0;
}

export interface CheckResult {
  connectionId: string;
  at: string;
  ok: boolean;
  latencyMs: number | null;
  tableCount: number | null;
  error: string | null;
}

export function recordCheck(c: CheckResult): void {
  getDb()
    .prepare(
      `INSERT INTO connection_checks
       (connection_id,at,ok,latency_ms,table_count,error)
       VALUES (@connectionId,@at,@ok,@latencyMs,@tableCount,@error)`
    )
    .run({ ...c, ok: c.ok ? 1 : 0 });
}

export function lastCheck(connectionId: string): CheckResult | null {
  const r = getDb()
    .prepare(
      "SELECT * FROM connection_checks WHERE connection_id = ? ORDER BY id DESC LIMIT 1"
    )
    .get(connectionId) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    connectionId: r.connection_id as string,
    at: r.at as string,
    ok: (r.ok as number) === 1,
    latencyMs: (r.latency_ms as number) ?? null,
    tableCount: (r.table_count as number) ?? null,
    error: (r.error as string) ?? null,
  };
}

/** Redacted view for API responses: never leaks passwords. */
export function redact(c: ConnectionRecord): Omit<ConnectionRecord, "password"> {
  const { password: _pw, ...rest } = c;
  return rest;
}
