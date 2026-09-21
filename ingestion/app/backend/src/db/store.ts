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
    CREATE TABLE IF NOT EXISTS lines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE RESTRICT,
      member_tables TEXT NOT NULL DEFAULT '[]',
      active INTEGER NOT NULL DEFAULT 1,
      last_tick TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lines_connection ON lines(connection_id);
    CREATE TABLE IF NOT EXISTS line_column_meta (
      line_id TEXT NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
      table_name TEXT NOT NULL,
      column_name TEXT NOT NULL,
      meaning TEXT NOT NULL DEFAULT '',
      datatype TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (line_id, table_name, column_name)
    );
    CREATE INDEX IF NOT EXISTS idx_line_column_meta_line ON line_column_meta(line_id);
    CREATE TABLE IF NOT EXISTS column_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      columns_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS card_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sql_template TEXT NOT NULL DEFAULT '',
      granularity TEXT NOT NULL DEFAULT 'hourly' CHECK (granularity IN ('hourly','shift','daily')),
      unit TEXT NOT NULL DEFAULT '',
      extract_hint TEXT NOT NULL DEFAULT '',
      context TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      template_id TEXT REFERENCES card_templates(id) ON DELETE SET NULL,
      template_version INTEGER,
      line_id TEXT NOT NULL REFERENCES lines(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      tables_json TEXT NOT NULL DEFAULT '[]',
      sql_text TEXT NOT NULL DEFAULT '',
      granularity TEXT NOT NULL DEFAULT 'hourly' CHECK (granularity IN ('hourly','shift','daily')),
      unit TEXT NOT NULL DEFAULT '',
      extract_hint TEXT NOT NULL DEFAULT '',
      context TEXT NOT NULL DEFAULT '',
      threshold REAL,
      status TEXT NOT NULL DEFAULT 'dormant' CHECK (status IN ('live','dormant')),
      version INTEGER NOT NULL DEFAULT 1,
      last_test_at TEXT,
      last_test_ok INTEGER,
      last_test_sql_hash TEXT,
      last_test_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cards_line ON cards(line_id);
    CREATE TABLE IF NOT EXISTS card_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      at TEXT NOT NULL,
      kind TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      line_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      card_version INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('test','tick')),
      ok INTEGER NOT NULL,
      rows_pulled INTEGER NOT NULL DEFAULT 0,
      units_built INTEGER NOT NULL DEFAULT 0,
      facts_stored INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_runs_line_day ON runs(line_id, at);
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS llm_providers (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      active_model TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 0,
      last_ok TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS graph_specs (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT '',
      chart_type TEXT NOT NULL DEFAULT 'table' CHECK (chart_type IN ('table','line','bar','area','histogram')),
      x_column TEXT NOT NULL DEFAULT '',
      y_columns TEXT NOT NULL DEFAULT '[]',
      title TEXT NOT NULL DEFAULT '',
      config TEXT NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_graph_specs_card ON graph_specs(card_id);
    CREATE TABLE IF NOT EXISTS query_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      line_id TEXT NOT NULL,
      sql TEXT NOT NULL,
      row_count INTEGER,
      duration_ms INTEGER,
      ok INTEGER NOT NULL DEFAULT 1,
      error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_query_history_line ON query_history(line_id, created_at);
    CREATE TABLE IF NOT EXISTS llm_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      route TEXT NOT NULL DEFAULT '',
      line_id TEXT,
      card_id TEXT,
      template_id TEXT,
      model TEXT NOT NULL DEFAULT '',
      success INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      attempts_json TEXT NOT NULL DEFAULT '[]',
      prompt TEXT NOT NULL DEFAULT '',
      response_text TEXT NOT NULL DEFAULT '',
      parsed_json TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_llm_calls_at ON llm_calls(at DESC);
    CREATE INDEX IF NOT EXISTS idx_llm_calls_route ON llm_calls(route, at DESC);
    CREATE INDEX IF NOT EXISTS idx_llm_calls_line ON llm_calls(line_id, at DESC);
  `);
  // Lightweight migration: reference line a template was authored against.
  const tplCols = db.prepare("PRAGMA table_info(card_templates)").all() as { name: string }[];
  if (!tplCols.some((c) => c.name === "reference_line_id")) {
    db.exec("ALTER TABLE card_templates ADD COLUMN reference_line_id TEXT");
  }
  // Lightweight migration: ranked chart candidates recommended once per
  // feature (template) by the LLM. Cards instantiated from the template
  // inherit these as their default graph specs (top-2 selected for RAG).
  if (!tplCols.some((c) => c.name === "chart_suggestions")) {
    db.exec("ALTER TABLE card_templates ADD COLUMN chart_suggestions TEXT NOT NULL DEFAULT '[]'");
  }
  // Lightweight migration: per-ingest disambiguation shown alongside each
  // retained fact (Hindsight `context`). Set on the template, inherited by
  // copies at registration, tunable per copy afterwards (Specifics panel).
  if (!tplCols.some((c) => c.name === "context")) {
    db.exec("ALTER TABLE card_templates ADD COLUMN context TEXT NOT NULL DEFAULT ''");
  }
  const cardCols = db.prepare("PRAGMA table_info(cards)").all() as { name: string }[];
  if (!cardCols.some((c) => c.name === "context")) {
    db.exec("ALTER TABLE cards ADD COLUMN context TEXT NOT NULL DEFAULT ''");
  }
  // Lightweight migration: production-day time settings. shift_start (HH:MM)
  // anchors shift ticks and daily bucketing; shift_hours sets the shift
  // length. Defaults reproduce the old midnight behavior exactly. Set on the
  // template, inherited by copies at registration, tunable per copy after.
  if (!tplCols.some((c) => c.name === "shift_start")) {
    db.exec("ALTER TABLE card_templates ADD COLUMN shift_start TEXT NOT NULL DEFAULT '00:00'");
  }
  if (!tplCols.some((c) => c.name === "shift_hours")) {
    db.exec("ALTER TABLE card_templates ADD COLUMN shift_hours INTEGER NOT NULL DEFAULT 8");
  }
  if (!cardCols.some((c) => c.name === "shift_start")) {
    db.exec("ALTER TABLE cards ADD COLUMN shift_start TEXT NOT NULL DEFAULT '00:00'");
  }
  if (!cardCols.some((c) => c.name === "shift_hours")) {
    db.exec("ALTER TABLE cards ADD COLUMN shift_hours INTEGER NOT NULL DEFAULT 8");
  }
  // Multi-resolution ingest: checked streams per template/card. Base (finest
  // checked) samples the plant; coarser checked resolutions run as scheduled
  // readers over wider windows. Stored as JSON arrays; default = all five.
  const ALL_RES = '["5min","hourly","daily","weekly","monthly"]';
  if (!tplCols.some((c) => c.name === "resolutions")) {
    db.exec(`ALTER TABLE card_templates ADD COLUMN resolutions TEXT NOT NULL DEFAULT '${ALL_RES}'`);
  }
  if (!cardCols.some((c) => c.name === "resolutions")) {
    db.exec(`ALTER TABLE cards ADD COLUMN resolutions TEXT NOT NULL DEFAULT '${ALL_RES}'`);
  }
  // Last-run tracking per derived reader stream (idempotent schedules).
  db.exec(`
    CREATE TABLE IF NOT EXISTS resolution_runs (
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      resolution TEXT NOT NULL,
      last_run TEXT NOT NULL,
      PRIMARY KEY (card_id, resolution)
    );
  `);
  // Run footprints carry their stream (base sampler vs derived reader).
  const runCols = db.prepare("PRAGMA table_info(runs)").all() as { name: string }[];
  if (!runCols.some((c) => c.name === "resolution")) {
    db.exec("ALTER TABLE runs ADD COLUMN resolution TEXT NOT NULL DEFAULT 'base'");
  }
  // Weekly skip schedule: per-day running windows (HH:MM). Absent day =
  // full 24h running. Set on the template, inherited by copies, tunable per
  // copy. Default = everything running (today's behavior exactly).
  const SKIP_ALL = '{"mon":[{"from":"00:00","to":"24:00"}],"tue":[{"from":"00:00","to":"24:00"}],"wed":[{"from":"00:00","to":"24:00"}],"thu":[{"from":"00:00","to":"24:00"}],"fri":[{"from":"00:00","to":"24:00"}],"sat":[{"from":"00:00","to":"24:00"}],"sun":[{"from":"00:00","to":"24:00"}]}';
  if (!tplCols.some((c) => c.name === "skip_schedule")) {
    db.exec(`ALTER TABLE card_templates ADD COLUMN skip_schedule TEXT NOT NULL DEFAULT '${SKIP_ALL}'`);
  }
  if (!cardCols.some((c) => c.name === "skip_schedule")) {
    db.exec(`ALTER TABLE cards ADD COLUMN skip_schedule TEXT NOT NULL DEFAULT '${SKIP_ALL}'`);
  }
  // Lightweight migration: allow 'histogram' graph specs. The original
  // CREATE TABLE pins chart_type with a CHECK over 4 values, so widen it
  // by rebuilding the table once (data-preserving copy).
  const graphSql = (db.prepare("SELECT sql FROM sqlite_master WHERE name='graph_specs'").get() as { sql: string } | undefined)?.sql ?? "";
  if (graphSql && !graphSql.includes("histogram")) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS graph_specs_new (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        name TEXT NOT NULL DEFAULT '',
        chart_type TEXT NOT NULL DEFAULT 'table' CHECK (chart_type IN ('table','line','bar','area','histogram')),
        x_column TEXT NOT NULL DEFAULT '',
        y_columns TEXT NOT NULL DEFAULT '[]',
        title TEXT NOT NULL DEFAULT '',
        config TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO graph_specs_new (id,card_id,name,chart_type,x_column,y_columns,title,config,version,created_at,updated_at)
        SELECT id,card_id,name,chart_type,x_column,y_columns,title,config,version,created_at,updated_at FROM graph_specs;
      DROP TABLE graph_specs;
      ALTER TABLE graph_specs_new RENAME TO graph_specs;
      CREATE INDEX IF NOT EXISTS idx_graph_specs_card ON graph_specs(card_id);
    `);
  }
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

/* ---------------- F2: production line registry ---------------- */

export interface LineRecord {
  id: string;
  name: string;
  connectionId: string;
  /** ["schema.table", ...] — setter-grouped member tables. */
  memberTables: string[];
  /** Deregistered lines stay visible (badged) but get no ticks. */
  active: boolean;
  lastTick: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LineInput {
  id: string;
  name: string;
  connectionId: string;
  memberTables: string[];
}

function lineRow(r: Record<string, unknown>): LineRecord {
  return {
    id: r.id as string,
    name: r.name as string,
    connectionId: r.connection_id as string,
    memberTables: JSON.parse((r.member_tables as string) ?? "[]") as string[],
    active: (r.active as number) === 1,
    lastTick: (r.last_tick as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function listLines(filter?: { connectionId?: string; table?: string; q?: string }): LineRecord[] {
  const all = (getDb().prepare("SELECT * FROM lines ORDER BY id").all() as Record<string, unknown>[]).map(lineRow);
  return all.filter((l) => {
    if (filter?.connectionId && l.connectionId !== filter.connectionId) return false;
    if (filter?.table && !l.memberTables.some((t) => t.toLowerCase().includes(filter.table!.toLowerCase()))) return false;
    if (filter?.q && !`${l.id} ${l.name}`.toLowerCase().includes(filter.q.toLowerCase())) return false;
    return true;
  });
}

export function getLine(id: string): LineRecord | null {
  const r = getDb().prepare("SELECT * FROM lines WHERE id = ?").get(id);
  return r ? lineRow(r as Record<string, unknown>) : null;
}

export function createLine(input: LineInput): LineRecord {
  if (!getConnection(input.connectionId)) throw new Error("connection not found");
  if (getLine(input.id)) throw new Error("line id already registered");
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO lines (id,name,connection_id,member_tables,active,last_tick,created_at,updated_at)
       VALUES (?,?,?,?,1,NULL,?,?)`
    )
    .run(input.id, input.name, input.connectionId, JSON.stringify(input.memberTables), now, now);
  return getLine(input.id)!;
}

export function updateLine(
  id: string,
  patch: Partial<Omit<LineInput, "id">>
): LineRecord | null {
  const cur = getLine(id);
  if (!cur) return null;
  if (patch.connectionId && !getConnection(patch.connectionId)) throw new Error("connection not found");
  getDb()
    .prepare(
      `UPDATE lines SET name=?,connection_id=?,member_tables=?,updated_at=? WHERE id=?`
    )
    .run(
      patch.name ?? cur.name,
      patch.connectionId ?? cur.connectionId,
      JSON.stringify(patch.memberTables ?? cur.memberTables),
      new Date().toISOString(),
      id
    );
  return getLine(id);
}

/** Deregister: stops future ticks, keeps the record + history visible. */
export function deregisterLine(id: string): LineRecord | null {
  const cur = getLine(id);
  if (!cur) return null;
  getDb().prepare("UPDATE lines SET active=0,updated_at=? WHERE id=?").run(new Date().toISOString(), id);
  return getLine(id);
}

export function reregisterLine(id: string): LineRecord | null {
  const cur = getLine(id);
  if (!cur) return null;
  getDb().prepare("UPDATE lines SET active=1,updated_at=? WHERE id=?").run(new Date().toISOString(), id);
  return getLine(id);
}

export function linesBoundTo(connectionId: string): LineRecord[] {
  return (getDb().prepare("SELECT * FROM lines WHERE connection_id = ?").all(connectionId) as Record<string, unknown>[]).map(lineRow);
}

export function touchLineTick(id: string, at: string): void {
  getDb().prepare("UPDATE lines SET last_tick=? WHERE id=?").run(at, id);
}

export function deleteLine(id: string): boolean {
  const cur = getLine(id);
  if (!cur) return false;
  // Block if any cards still bound — caller should delete/detach cards first.
  const bound = getDb().prepare("SELECT COUNT(*) AS n FROM cards WHERE line_id=?").get(id) as { n: number };
  if (bound.n > 0) throw new Error(`line has ${bound.n} card(s) — delete or reassign them first`);
  return getDb().prepare("DELETE FROM lines WHERE id=?").run(id).changes > 0;
}

export function cardsBoundToLine(lineId: string): number {
  const r = getDb().prepare("SELECT COUNT(*) AS n FROM cards WHERE line_id=?").get(lineId) as { n: number };
  return r.n;
}

/* ---------------- Column meanings at lines registration ---------------- */

export interface LineColumnMeta {
  lineId: string;
  tableName: string;
  columnName: string;
  meaning: string;
  datatype: string;
}

export function listLineColumnMeta(lineId: string): LineColumnMeta[] {
  const rows = getDb().prepare("SELECT line_id, table_name, column_name, meaning, datatype FROM line_column_meta WHERE line_id=? ORDER BY table_name, column_name").all(lineId) as Record<string, unknown>[];
  return rows.map((r) => ({
    lineId: r.line_id as string,
    tableName: r.table_name as string,
    columnName: r.column_name as string,
    meaning: (r.meaning as string) ?? "",
    datatype: (r.datatype as string) ?? "",
  }));
}

export function getLineTableAnalyzed(lineId: string, tableName: string): { total: number; filled: number; analyzed: boolean } {
  const rows = listLineColumnMeta(lineId).filter((r) => r.tableName.toLowerCase() === tableName.toLowerCase());
  const total = rows.length;
  const filled = rows.filter((r) => r.meaning.trim().length > 0).length;
  return { total, filled, analyzed: total > 0 && filled === total };
}

export interface GlobalTableMeta {
  tableName: string;
  connectionId: string;
  sourceLineId: string;
  sourceLineName: string;
  total: number;
  filled: number;
  analyzed: boolean;
  columns: { name: string; meaning: string; datatype: string }[];
}

export function listGlobalTableMeta(connectionId?: string): GlobalTableMeta[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT lcm.line_id, lcm.table_name, lcm.column_name, lcm.meaning, lcm.datatype,
           l.connection_id, l.name as line_name
    FROM line_column_meta lcm JOIN lines l ON l.id = lcm.line_id
    ${connectionId ? "WHERE l.connection_id = ?" : ""}
    ORDER BY lcm.table_name, lcm.line_id, lcm.column_name
  `).all(...(connectionId ? [connectionId] : [])) as Record<string, unknown>[];
  // group by (lower tableName, line_id)
  const byTableLine = new Map<string, Map<string, LineColumnMeta[]>>();
  for (const r of rows) {
    const t = String(r.table_name);
    const lid = String(r.line_id);
    const key = t.toLowerCase();
    if (!byTableLine.has(key)) byTableLine.set(key, new Map());
    const m = byTableLine.get(key)!;
    if (!m.has(lid)) m.set(lid, []);
    m.get(lid)!.push({ lineId: lid, tableName: t, columnName: String(r.column_name), meaning: String(r.meaning ?? ""), datatype: String(r.datatype ?? "") });
  }
  const out: GlobalTableMeta[] = [];
  for (const [lower, lineMap] of byTableLine.entries()) {
    // pick first line where analyzed true, else first line
    let best: { lid: string; cols: LineColumnMeta[]; total: number; filled: number; analyzed: boolean; conn: string; lname: string } | null = null;
    for (const [lid, cols] of lineMap.entries()) {
      const total = cols.length;
      const filled = cols.filter((c) => c.meaning.trim()).length;
      const analyzed = total > 0 && filled === total;
      const sample = rows.find((rr) => String(rr.line_id) === lid && String(rr.table_name).toLowerCase() === lower) as Record<string, unknown> | undefined;
      const conn = sample ? String(sample.connection_id) : "";
      const lname = sample ? String(sample.line_name) : lid;
      const cand = { lid, cols, total, filled, analyzed, conn, lname };
      if (!best) best = cand;
      else if (cand.analyzed && !best.analyzed) best = cand;
    }
    if (!best) continue;
    // original casing from first col
    const tableName = best.cols[0]?.tableName ?? lower;
    out.push({
      tableName,
      connectionId: best.conn,
      sourceLineId: best.lid,
      sourceLineName: best.lname,
      total: best.total,
      filled: best.filled,
      analyzed: best.analyzed,
      columns: best.cols.map((c) => ({ name: c.columnName, meaning: c.meaning, datatype: c.datatype })),
    });
  }
  return out;
}

export function upsertLineColumnMeta(lineId: string, tableName: string, cols: { name: string; meaning: string; datatype?: string }[]): LineColumnMeta[] {
  if (!getLine(lineId)) throw new Error("line not found");
  const db = getDb();
  const tx = db.transaction(() => {
    for (const c of cols) {
      db.prepare(
        `INSERT INTO line_column_meta (line_id, table_name, column_name, meaning, datatype)
         VALUES (?,?,?,?,?)
         ON CONFLICT(line_id, table_name, column_name) DO UPDATE SET meaning=excluded.meaning, datatype=excluded.datatype`
      ).run(lineId, tableName, c.name, c.meaning ?? "", c.datatype ?? "");
    }
  });
  tx();
  return listLineColumnMeta(lineId).filter((r) => r.tableName.toLowerCase() === tableName.toLowerCase());
}

export function deleteLineTableMeta(lineId: string, tableName: string): void {
  getDb().prepare("DELETE FROM line_column_meta WHERE line_id=? AND table_name=?").run(lineId, tableName);
}

/* ---------------- Column templates (global, reusable) ---------------- */

export interface ColumnTemplate {
  id: string;
  name: string;
  columns: { name: string; meaning: string; datatype: string }[];
  createdAt: string;
  updatedAt: string;
}

function columnTemplateRow(r: Record<string, unknown>): ColumnTemplate {
  return {
    id: r.id as string,
    name: r.name as string,
    columns: JSON.parse((r.columns_json as string) ?? "[]") as ColumnTemplate["columns"],
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function listColumnTemplates(): ColumnTemplate[] {
  return (getDb().prepare("SELECT * FROM column_templates ORDER BY updated_at DESC").all() as Record<string, unknown>[]).map(columnTemplateRow);
}

export function createColumnTemplate(name: string, columns: { name: string; meaning: string; datatype: string }[]): ColumnTemplate {
  if (!name.trim()) throw new Error("template name required");
  if (columns.length === 0) throw new Error("columns required");
  const id = `ctpl-${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  try {
    getDb().prepare("INSERT INTO column_templates (id,name,columns_json,created_at,updated_at) VALUES (?,?,?,?,?)").run(id, name.trim(), JSON.stringify(columns), now, now);
  } catch (e) {
    if (String((e as Error).message).includes("UNIQUE")) throw new Error(`template "${name}" already exists`);
    throw e;
  }
  return columnTemplateRow(getDb().prepare("SELECT * FROM column_templates WHERE id=?").get(id) as Record<string, unknown>);
}

export function deleteColumnTemplate(id: string): boolean {
  return getDb().prepare("DELETE FROM column_templates WHERE id=?").run(id).changes > 0;
}

export function getColumnTemplate(id: string): ColumnTemplate | null {
  const r = getDb().prepare("SELECT * FROM column_templates WHERE id=?").get(id);
  return r ? columnTemplateRow(r as Record<string, unknown>) : null;
}

/* ---------------- F3: context component cards ---------------- */

export type Granularity = "hourly" | "shift" | "daily";

/** Ingest streams. Finest checked = base sampler (plant queries); coarser
 *  checked = scheduled readers (wider windows + rollup, no extra plant load
 *  beyond the wider read). All checked by default; unchecking unschedules. */
export type StreamResolution = "5min" | "hourly" | "daily" | "weekly" | "monthly";
export const ALL_RESOLUTIONS: StreamResolution[] = ["5min", "hourly", "daily", "weekly", "monthly"];

/** Weekly skip schedule: running windows per weekday. Empty array = full day skipped. */
export interface SkipWindow {
  from: string;
  to: string;
}
export type SkipSchedule = Record<string, SkipWindow[]>;

export const SKIP_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const HHMM_END = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/;

function toMinutes(s: string): number | null {
  if (s === "24:00") return 1440;
  const m = HHMM.exec(s);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function defaultSkipSchedule(): SkipSchedule {
  const s: SkipSchedule = {};
  for (const d of SKIP_DAYS) s[d] = [{ from: "00:00", to: "24:00" }];
  return s;
}

/** Sanitize stored JSON: bad windows dropped, missing days default to full-on. */
export function parseSkipSchedule(v: unknown): SkipSchedule {
  const out = defaultSkipSchedule();
  try {
    const o = typeof v === "string" ? JSON.parse(v) : v;
    if (!o || typeof o !== "object" || Array.isArray(o)) return out;
    for (const d of SKIP_DAYS) {
      const arr = (o as Record<string, unknown>)[d];
      if (!Array.isArray(arr)) continue;
      const wins: SkipWindow[] = [];
      for (const w of arr.slice(0, 3)) {
        if (!w || typeof w !== "object") continue;
        const rec = w as Record<string, unknown>;
        if (typeof rec.from !== "string" || typeof rec.to !== "string") continue;
        const f = toMinutes(rec.from.trim());
        const t = rec.to.trim() === "24:00" ? 1440 : toMinutes(rec.to.trim());
        if (f == null || t == null || t <= f) continue;
        wins.push({ from: rec.from.trim(), to: rec.to.trim() });
      }
      out[d] = wins;
    }
  } catch {
    // fall through with defaults
  }
  return out;
}

/** True when a custom (non-24/7) schedule is set — drives badges/summaries. */
export function hasCustomSkip(s: SkipSchedule | undefined): boolean {
  if (!s) return false;
  for (const d of SKIP_DAYS) {
    const w = s[d] ?? [];
    if (w.length !== 1 || w[0].from !== "00:00" || w[0].to !== "24:00") return true;
  }
  return false;
}

export function parseResolutions(v: unknown): StreamResolution[] {
  try {
    const arr = typeof v === "string" ? JSON.parse(v) : v;
    if (!Array.isArray(arr)) return [...ALL_RESOLUTIONS];
    const ok = arr.filter((r): r is StreamResolution => (ALL_RESOLUTIONS as string[]).includes(r));
    return ok.length > 0 ? [...new Set(ok)] : [...ALL_RESOLUTIONS];
  } catch {
    return [...ALL_RESOLUTIONS];
  }
}
export type CardStatus = "live" | "dormant";

/**
 * One ranked chart candidate recommended by the LLM for a feature's data
 * shape. Stored once per template (feature registration); inherited by cards.
 * `conditions` states when the chart is meaningful (e.g. "breach=true").
 */
/** One plotted series: stable identity (column), human legend (label),
 *  per-series unit, and explicit color so renders and future
 *  chart-pic readers agree on which series is which. */
export interface ChartSeriesMeta {
  column: string;
  label: string;
  unit: string;
  color: string;
}

export interface ChartSuggestion {
  chartType: ChartType;
  xColumn: string;
  yColumns: string[];
  title: string;
  rationale: string;
  conditions: string;
  /** User toggle at template level. Only enabled suggestions are inherited
   *  by cards; top-2 enabled feed RAG. Defaults true. */
  enabled?: boolean;
  /** Per-series legend metadata (label/unit/color). Absent on pre-enrichment
   *  suggestions — renderers fall back to column names + palette order. */
  series?: ChartSeriesMeta[];
  /** Display axis titles. Absent → renderers derive from column/resolution. */
  xTitle?: string;
  yTitle?: string;
  /** One-to-two line chart story: seed for future context building. */
  summary?: string;
  /** Sample the suggestion was based on (traceability for later contexts). */
  provenance?: { rows: number; from: string | null; to: string | null };
  /**
   * Stored chart-creation recipe (single source of truth for every renderer:
   * UI preview, prompt builder, AI response). Fixed resolution ladder;
   * x/y conditions state when the chart is meaningful.
   */
  resolutions?: string[];
  xCondition?: { column: string; bucket: string } | null;
  yConditions?: { column: string; op: string; value: number }[];
}

export const RESOLUTION_LADDER = ["hourly", "daily", "weekly", "monthly", "yearly"];

export function parseChartSuggestions(raw: unknown): ChartSuggestion[] {
  try {
    const arr = JSON.parse((raw as string) ?? "[]") as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (s): s is ChartSuggestion =>
        !!s && typeof s === "object"
        && ["table", "line", "bar", "area", "histogram"].includes((s as { chartType?: string }).chartType ?? "")
        && typeof (s as { xColumn?: string }).xColumn === "string"
        && Array.isArray((s as { yColumns?: unknown }).yColumns)
    );
  } catch {
    return [];
  }
}

export interface CardTemplate {
  id: string;
  name: string;
  description: string;
  referenceLineId: string | null;
  sqlTemplate: string;
  granularity: Granularity;
  shiftStart: string;
  shiftHours: number;
  resolutions: StreamResolution[];
  skipSchedule: SkipSchedule;
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
  granularity: Granularity;
  shiftStart: string;
  shiftHours: number;
  resolutions: StreamResolution[];
  skipSchedule: SkipSchedule;
  unit: string;
  extractHint: string;
  context: string;
  threshold: number | null;
  status: CardStatus;
  version: number;
  lastTest: { at: string; ok: boolean; sqlHash: string | null; error: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

export function sqlHash(sql: string): string {
  let h = 5381;
  for (let i = 0; i < sql.length; i++) h = ((h << 5) + h + sql.charCodeAt(i)) | 0;
  return `h${(h >>> 0).toString(36)}`;
}

function tplRow(r: Record<string, unknown>): CardTemplate {
  return {
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string) ?? "",
    referenceLineId: (r.reference_line_id as string) ?? null,
    sqlTemplate: (r.sql_template as string) ?? "",
    granularity: r.granularity as Granularity,
    shiftStart: (r.shift_start as string) ?? "00:00",
    shiftHours: (r.shift_hours as number) ?? 8,
    resolutions: parseResolutions(r.resolutions),
    skipSchedule: parseSkipSchedule(r.skip_schedule),
    unit: (r.unit as string) ?? "",
    extractHint: (r.extract_hint as string) ?? "",
    context: (r.context as string) ?? "",
    chartSuggestions: parseChartSuggestions(r.chart_suggestions),
    version: r.version as number,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

function cardRow(r: Record<string, unknown>): Card {
  const ok = r.last_test_ok as number | null;
  return {
    id: r.id as string,
    templateId: (r.template_id as string) ?? null,
    templateVersion: (r.template_version as number) ?? null,
    lineId: r.line_id as string,
    name: r.name as string,
    tables: JSON.parse((r.tables_json as string) ?? "[]") as string[],
    sql: (r.sql_text as string) ?? "",
    granularity: r.granularity as Granularity,
    shiftStart: (r.shift_start as string) ?? "00:00",
    shiftHours: (r.shift_hours as number) ?? 8,
    resolutions: parseResolutions(r.resolutions),
    skipSchedule: parseSkipSchedule(r.skip_schedule),
    unit: (r.unit as string) ?? "",
    extractHint: (r.extract_hint as string) ?? "",
    context: (r.context as string) ?? "",
    threshold: (r.threshold as number) ?? null,
    status: r.status as CardStatus,
    version: r.version as number,
    lastTest:
      r.last_test_at == null
        ? null
        : {
            at: r.last_test_at as string,
            ok: ok === 1,
            sqlHash: (r.last_test_sql_hash as string) ?? null,
            error: (r.last_test_error as string) ?? null,
          },
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

function logCardEvent(cardId: string, kind: string, detail = ""): void {
  getDb()
    .prepare("INSERT INTO card_events (card_id,at,kind,detail) VALUES (?,?,?,?)")
    .run(cardId, new Date().toISOString(), kind, detail);
}

export function listTemplates(): CardTemplate[] {
  return (getDb().prepare("SELECT * FROM card_templates ORDER BY name").all() as Record<string, unknown>[]).map(tplRow);
}

export function createTemplate(t: Omit<CardTemplate, "id" | "version" | "createdAt" | "updatedAt">): CardTemplate {
  const id = `tpl-${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO card_templates (id,name,description,reference_line_id,sql_template,granularity,shift_start,shift_hours,resolutions,skip_schedule,unit,extract_hint,context,chart_suggestions,version,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`
    )
    .run(id, t.name, t.description, t.referenceLineId ?? null, t.sqlTemplate, t.granularity, t.shiftStart ?? "00:00", t.shiftHours ?? 8, JSON.stringify(t.resolutions ?? ALL_RESOLUTIONS), JSON.stringify(t.skipSchedule ?? defaultSkipSchedule()), t.unit, t.extractHint, t.context ?? "", JSON.stringify(t.chartSuggestions ?? []), now, now);
  return getTemplate(id)!;
}

export function getTemplate(id: string): CardTemplate | null {
  const r = getDb().prepare("SELECT * FROM card_templates WHERE id=?").get(id);
  return r ? tplRow(r as Record<string, unknown>) : null;
}

export function updateTemplate(id: string, patch: Partial<Omit<CardTemplate, "id" | "version" | "createdAt" | "updatedAt">>): CardTemplate | null {
  const cur = getTemplate(id);
  if (!cur) return null;
  const bump = patch.sqlTemplate !== undefined && patch.sqlTemplate !== cur.sqlTemplate;
  getDb()
    .prepare(
      `UPDATE card_templates SET name=?,description=?,reference_line_id=?,sql_template=?,granularity=?,shift_start=?,shift_hours=?,resolutions=?,skip_schedule=?,unit=?,extract_hint=?,context=?,chart_suggestions=?,
       version=version+?,updated_at=? WHERE id=?`
    )
    .run(
      patch.name ?? cur.name,
      patch.description ?? cur.description,
      patch.referenceLineId !== undefined ? patch.referenceLineId : cur.referenceLineId,
      patch.sqlTemplate ?? cur.sqlTemplate,
      patch.granularity ?? cur.granularity,
      patch.shiftStart ?? cur.shiftStart,
      patch.shiftHours ?? cur.shiftHours,
      JSON.stringify(patch.resolutions ?? cur.resolutions),
      JSON.stringify(patch.skipSchedule ?? cur.skipSchedule),
      patch.unit ?? cur.unit,
      patch.extractHint ?? cur.extractHint,
      patch.context ?? cur.context,
      patch.chartSuggestions !== undefined ? JSON.stringify(patch.chartSuggestions) : JSON.stringify(cur.chartSuggestions),
      bump ? 1 : 0,
      new Date().toISOString(),
      id
    );
  return getTemplate(id);
}

export function deleteTemplate(id: string): boolean {
  return getDb().prepare("DELETE FROM card_templates WHERE id=?").run(id).changes > 0;
}

export interface CardInput {
  lineId: string;
  name: string;
  tables: string[];
  sql: string;
  granularity: Granularity;
  shiftStart?: string;
  shiftHours?: number;
  resolutions?: StreamResolution[];
  skipSchedule?: SkipSchedule;
  unit?: string;
  extractHint?: string;
  context?: string;
  threshold?: number | null;
  templateId?: string | null;
}

function tablesSubsetOfLine(tables: string[], lineId: string): string[] {
  const line = getLine(lineId);
  if (!line) return ["line not found"];
  const members = new Set(line.memberTables.map((t) => t.toLowerCase()));
  return tables.filter((t) => !members.has(t.toLowerCase()));
}

export function listCards(lineId?: string): Card[] {
  const rows = (
    lineId
      ? getDb().prepare("SELECT * FROM cards WHERE line_id=? ORDER BY name").all(lineId)
      : getDb().prepare("SELECT * FROM cards ORDER BY line_id,name").all()
  ) as Record<string, unknown>[];
  return rows.map(cardRow);
}

export function getCard(id: string): Card | null {
  const r = getDb().prepare("SELECT * FROM cards WHERE id=?").get(id);
  return r ? cardRow(r as Record<string, unknown>) : null;
}

export function copiesOfTemplate(templateId: string): Card[] {
  return (getDb().prepare("SELECT * FROM cards WHERE template_id=?").all(templateId) as Record<string, unknown>[]).map(cardRow);
}

export function createCard(input: CardInput): Card {
  const line = getLine(input.lineId);
  if (!line) throw new Error("line not found");
  if (!line.active) throw new Error("line is deregistered");
  const outside = tablesSubsetOfLine(input.tables, input.lineId);
  if (outside.length > 0) throw new Error(`tables not in line members: ${outside.join(", ")}`);
  const id = `card-${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  const tpl = input.templateId ? getTemplate(input.templateId) : null;
  getDb()
    .prepare(
      `INSERT INTO cards (id,template_id,template_version,line_id,name,tables_json,sql_text,granularity,shift_start,shift_hours,resolutions,skip_schedule,unit,extract_hint,context,threshold,status,version,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'dormant',1,?,?)`
    )
    .run(
      id, tpl?.id ?? null, tpl?.version ?? null, input.lineId, input.name,
      JSON.stringify(input.tables), input.sql, input.granularity,
      input.shiftStart ?? tpl?.shiftStart ?? "00:00", input.shiftHours ?? tpl?.shiftHours ?? 8,
      JSON.stringify(input.resolutions ?? tpl?.resolutions ?? ALL_RESOLUTIONS),
      JSON.stringify(input.skipSchedule ?? tpl?.skipSchedule ?? defaultSkipSchedule()),
      input.unit ?? "", input.extractHint ?? "", input.context ?? "", input.threshold ?? null, now, now
    );
  logCardEvent(id, "created", `from ${tpl ? `template ${tpl.name} v${tpl.version}` : "scratch"}`);
  return getCard(id)!;
}

/** Instantiate a template onto a line: independent copy, free to diverge. */
export function instantiateTemplate(templateId: string, lineId: string, overrides?: Partial<Pick<CardInput, "name" | "tables" | "sql">>): Card {
  const tpl = getTemplate(templateId);
  if (!tpl) throw new Error("template not found");
  const line = getLine(lineId);
  if (!line) throw new Error("line not found");
  // Guardrail: one copy per feature per line — re-stamping is Check/Apply's
  // job, not instantiate's. Surfaces as 409 through the route handler.
  const dupe = listCards(lineId).find((c) => c.templateId === templateId);
  if (dupe) throw new Error(`"${tpl.name}" is already registered on ${lineId} as ${dupe.id} — edit or reapply it instead`);
  const card = createCard({
    lineId,
    name: overrides?.name ?? tpl.name,
    tables: overrides?.tables ?? [...line.memberTables],
    sql: overrides?.sql ?? tpl.sqlTemplate,
    granularity: tpl.granularity,
    unit: tpl.unit,
    extractHint: tpl.extractHint,
    context: tpl.context,
    templateId: tpl.id,
  });
  // Inherit the feature's chart suggestions as the card's default specs.
  // Only enabled suggestions inherit; top-2 enabled pre-selected for RAG.
  // Tunable anytime from the card afterwards.
  const inheritable = tpl.chartSuggestions.filter((s) => s.enabled !== false);
  inheritable.forEach((s, i) => {
    createGraphSpec({
      cardId: card.id,
      name: s.title || `Suggested ${s.chartType} ${i + 1}`,
      chartType: s.chartType,
      xColumn: s.xColumn,
      yColumns: s.yColumns,
      title: s.title,
      config: {
        source: "ai-recommended",
        selected_for_rag: i < 2,
        rationale: s.rationale,
        conditions: s.conditions,
        units: tpl.unit || undefined,
        summary: tpl.description || undefined,
        xTitle: s.xTitle,
        yTitle: s.yTitle,
        series: s.series,
      },
    });
  });
  return getCard(card.id)!;
}

export type ChangeMode = "forward" | "reingest";

export function updateCard(
  id: string,
  patch: Partial<Pick<CardInput, "name" | "tables" | "sql" | "granularity" | "shiftStart" | "shiftHours" | "resolutions" | "skipSchedule" | "unit" | "extractHint" | "context" | "threshold">>,
  opts?: { mode?: ChangeMode; reingestFrom?: string }
): Card | null {
  const cur = getCard(id);
  if (!cur) return null;
  if (cur.status === "live") throw new Error("card is LIVE — take it dormant before editing");
  // Validate BEFORE touching anything: a rejected change must leave no trace.
  if ((opts?.mode ?? "forward") === "reingest" && (patch.sql ?? cur.sql) !== cur.sql && !opts?.reingestFrom) {
    throw new Error("re-ingest needs a from-date");
  }
  const tables = patch.tables ?? cur.tables;  const outside = tablesSubsetOfLine(tables, cur.lineId);
  if (outside.length > 0) throw new Error(`tables not in line members: ${outside.join(", ")}`);
  const sqlChanged = patch.sql !== undefined && patch.sql !== cur.sql;
  getDb()
    .prepare(
      `UPDATE cards SET name=?,tables_json=?,sql_text=?,granularity=?,shift_start=?,shift_hours=?,resolutions=?,skip_schedule=?,unit=?,extract_hint=?,context=?,threshold=?,
       version=version+?,updated_at=? WHERE id=?`
    )
    .run(
      patch.name ?? cur.name, JSON.stringify(tables), patch.sql ?? cur.sql,
      patch.granularity ?? cur.granularity, patch.shiftStart ?? cur.shiftStart, patch.shiftHours ?? cur.shiftHours,
      JSON.stringify(patch.resolutions ?? cur.resolutions), JSON.stringify(patch.skipSchedule ?? cur.skipSchedule), patch.unit ?? cur.unit,
      patch.extractHint ?? cur.extractHint, patch.context ?? cur.context, patch.threshold ?? cur.threshold,
      sqlChanged ? 1 : 0, new Date().toISOString(), id
    );
  if (sqlChanged) {
    const mode = opts?.mode ?? "forward";
    logCardEvent(id, `mode-${mode}`, opts?.reingestFrom ? `from ${opts.reingestFrom} (historical rewrite pending engine backfill; ticks continue forward)` : "applies from now on");
  }
  return getCard(id);
}

export function deleteCard(id: string): boolean {
  const cur = getCard(id);
  if (!cur) return false;
  if (cur.status === "live") throw new Error("card is LIVE — take it dormant before deleting");
  logCardEvent(id, "deleted", "");
  return getDb().prepare("DELETE FROM cards WHERE id=?").run(id).changes > 0;
}

export function recordCardTest(id: string, ok: boolean, sql: string, error: string | null): void {
  getDb()
    .prepare(
      `UPDATE cards SET last_test_at=?,last_test_ok=?,last_test_sql_hash=?,last_test_error=? WHERE id=?`
    )
    .run(new Date().toISOString(), ok ? 1 : 0, sqlHash(sql), error, id);
  logCardEvent(id, ok ? "test-passed" : "test-failed", error ?? "");
}

/**
 * Activation guard (F3 lock): a card goes live only with tested SQL —
 * last test must pass AND match the current sql hash.
 */
export function activateCard(id: string): Card {
  const cur = getCard(id);
  if (!cur) throw new Error("card not found");
  if (!cur.sql.trim()) throw new Error("card has no SQL");
  if (!cur.lastTest?.ok) throw new Error("no passing test-run — test before activating");
  if (cur.lastTest.sqlHash !== sqlHash(cur.sql)) throw new Error("SQL changed since last test — re-test before activating");
  getDb().prepare("UPDATE cards SET status='live',updated_at=? WHERE id=?").run(new Date().toISOString(), id);
  logCardEvent(id, "activated", `v${cur.version}`);
  return getCard(id)!;
}

export function dormCard(id: string): Card {
  const cur = getCard(id);
  if (!cur) throw new Error("card not found");
  getDb().prepare("UPDATE cards SET status='dormant',updated_at=? WHERE id=?").run(new Date().toISOString(), id);
  logCardEvent(id, "dormant", "");
  return getCard(id)!;
}

export function cardEvents(cardId: string): { at: string; kind: string; detail: string }[] {
  return (getDb().prepare("SELECT at,kind,detail FROM card_events WHERE card_id=? ORDER BY id DESC LIMIT 50").all(cardId) as {
    at: string; kind: string; detail: string;
  }[]);
}

/* ---------------- F4: run log (tests today, ticks tomorrow) ---------------- */

export interface RunRecord {
  id: number;
  at: string;
  lineId: string;
  cardId: string;
  cardVersion: number;
  kind: "test" | "tick";
  /** Ingest stream: base sampler vs derived reader resolution. */
  resolution: string;
  ok: boolean;
  rowsPulled: number;
  unitsBuilt: number;
  factsStored: number;
  durationMs: number | null;
  error: string | null;
}

export function recordRun(r: Omit<RunRecord, "id" | "resolution"> & { resolution?: string }): number {
  const res = getDb()
    .prepare(
      `INSERT INTO runs (at,line_id,card_id,card_version,kind,resolution,ok,rows_pulled,units_built,facts_stored,duration_ms,error)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(r.at, r.lineId, r.cardId, r.cardVersion, r.kind, r.resolution ?? "base", r.ok ? 1 : 0, r.rowsPulled, r.unitsBuilt, r.factsStored, r.durationMs, r.error);
  return Number(res.lastInsertRowid);
}

export function runsForLine(lineId: string, from: string, to: string): RunRecord[] {
  return (getDb()
    .prepare("SELECT * FROM runs WHERE line_id=? AND at>=? AND at<? ORDER BY at DESC LIMIT 500")
    .all(lineId, from, to) as Record<string, unknown>[]).map((x) => ({
    id: x.id as number,
    at: x.at as string,
    lineId: x.line_id as string,
    cardId: x.card_id as string,
    cardVersion: x.card_version as number,
    kind: x.kind as "test" | "tick",
    resolution: (x.resolution as string) ?? "base",
    ok: (x.ok as number) === 1,
    rowsPulled: x.rows_pulled as number,
    unitsBuilt: x.units_built as number,
    factsStored: x.facts_stored as number,
    durationMs: (x.duration_ms as number) ?? null,
    error: (x.error as string) ?? null,
  }));
}

export function getSetting(key: string): string | null {
  const r = getDb().prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined;
  return r?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key,value,updated_at) VALUES (?,?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`
    )
    .run(key, value, new Date().toISOString());
}

/** Last successful run per derived-reader stream (idempotent schedules). */
export function getResolutionRun(cardId: string, resolution: string): string | null {
  const r = getDb()
    .prepare("SELECT last_run FROM resolution_runs WHERE card_id=? AND resolution=?")
    .get(cardId, resolution) as { last_run: string } | undefined;
  return r?.last_run ?? null;
}

export function setResolutionRun(cardId: string, resolution: string, at: string): void {
  getDb()
    .prepare(
      `INSERT INTO resolution_runs (card_id,resolution,last_run) VALUES (?,?,?)
       ON CONFLICT(card_id,resolution) DO UPDATE SET last_run=excluded.last_run`
    )
    .run(cardId, resolution, at);
}

export function lastFactWrite(): string | null {
  const r = getDb().prepare("SELECT MAX(at) AS at FROM runs WHERE facts_stored>0").get() as { at: string | null };
  return r.at;
}

/* ---------------- F6: LLM providers ---------------- */

export interface LlmProvider {
  id: string;
  label: string;
  baseUrl: string;
  hasKey: boolean;
  activeModel: string;
  isActive: boolean;
  lastOk: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface LlmRow extends Omit<LlmProvider, "hasKey" | "isActive" | "baseUrl" | "activeModel" | "lastOk" | "lastError" | "createdAt" | "updatedAt" | "label" | "id"> {
  id: string;
  label: string;
  base_url: string;
  api_key: string;
  active_model: string;
  is_active: number;
  last_ok: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function llmRow(r: LlmRow, withKey: boolean): LlmProvider & { apiKey?: string } {
  const base = {
    id: r.id,
    label: r.label,
    baseUrl: r.base_url,
    hasKey: r.api_key.length > 0,
    activeModel: r.active_model,
    isActive: r.is_active === 1,
    lastOk: r.last_ok,
    lastError: r.last_error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  return withKey ? { ...base, apiKey: r.api_key } : base;
}

export function listLlmProviders(): LlmProvider[] {
  return (getDb().prepare("SELECT * FROM llm_providers ORDER BY label").all() as LlmRow[]).map((r) => llmRow(r, false));
}

export function getLlmProvider(id: string, withKey = false): (LlmProvider & { apiKey?: string }) | null {
  const r = getDb().prepare("SELECT * FROM llm_providers WHERE id=?").get(id) as LlmRow | undefined;
  return r ? llmRow(r, withKey) : null;
}

export function activeLlmProvider(): (LlmProvider & { apiKey?: string }) | null {
  const r = getDb().prepare("SELECT * FROM llm_providers WHERE is_active=1 LIMIT 1").get() as LlmRow | undefined;
  return r ? llmRow(r, true) : null;
}

export function createLlmProvider(input: { label: string; baseUrl: string; apiKey?: string; activeModel?: string }): LlmProvider {
  const id = `llm-${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO llm_providers (id,label,base_url,api_key,active_model,is_active,created_at,updated_at)
       VALUES (?,?,?,?,'',0,?,?)`
    )
    .run(id, input.label, input.baseUrl.replace(/\/$/, ""), input.apiKey ?? "", now, now);
  if (input.activeModel) {
    getDb().prepare("UPDATE llm_providers SET is_active=0").run();
    getDb().prepare("UPDATE llm_providers SET active_model=?,is_active=1,updated_at=? WHERE id=?").run(input.activeModel, now, id);
  }
  return getLlmProvider(id)!;
}

export function updateLlmProvider(
  id: string,
  patch: Partial<{ label: string; baseUrl: string; apiKey: string }>
): LlmProvider | null {
  const cur = getLlmProvider(id, true);
  if (!cur) return null;
  getDb()
    .prepare("UPDATE llm_providers SET label=?,base_url=?,api_key=?,updated_at=? WHERE id=?")
    .run(
      patch.label ?? cur.label,
      (patch.baseUrl ?? cur.baseUrl).replace(/\/$/, ""),
      patch.apiKey ?? cur.apiKey ?? "",
      new Date().toISOString(),
      id
    );
  return getLlmProvider(id);
}

export function deleteLlmProvider(id: string): boolean {
  return getDb().prepare("DELETE FROM llm_providers WHERE id=?").run(id).changes > 0;
}

export function activateLlmModel(id: string, model: string): LlmProvider | null {
  const cur = getLlmProvider(id);
  if (!cur) return null;
  getDb().prepare("UPDATE llm_providers SET is_active=0").run();
  getDb()
    .prepare("UPDATE llm_providers SET active_model=?,is_active=1,updated_at=? WHERE id=?")
    .run(model, new Date().toISOString(), id);
  return getLlmProvider(id);
}

export function deactivateLlm(id: string): void {
  getDb().prepare("UPDATE llm_providers SET is_active=0,updated_at=? WHERE id=?").run(new Date().toISOString(), id);
}

export function markLlmCheck(id: string, ok: boolean, error: string | null): void {
  getDb()
    .prepare("UPDATE llm_providers SET last_ok=CASE WHEN ? THEN ? ELSE last_ok END,last_error=? WHERE id=?")
    .run(ok ? 1 : 0, new Date().toISOString(), error, id);
}

export function getRun(id: number): RunRecord | null {
  const x = getDb().prepare("SELECT * FROM runs WHERE id=?").get(id) as Record<string, unknown> | undefined;
  if (!x) return null;
  return {
    id: x.id as number, at: x.at as string, lineId: x.line_id as string,
    cardId: x.card_id as string, cardVersion: x.card_version as number,
    kind: x.kind as "test" | "tick", resolution: (x.resolution as string) ?? "base",
    ok: (x.ok as number) === 1,
    rowsPulled: x.rows_pulled as number, unitsBuilt: x.units_built as number,
    factsStored: x.facts_stored as number, durationMs: (x.duration_ms as number) ?? null,
    error: (x.error as string) ?? null,
  };
}

/* ---------------- Graph specs (F3: stored visualizations) ---------------- */

export type ChartType = "table" | "line" | "bar" | "area" | "histogram";

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

function graphRow(r: Record<string, unknown>): GraphSpec {
  return {
    id: r.id as string,
    cardId: r.card_id as string,
    name: (r.name as string) ?? "",
    chartType: r.chart_type as ChartType,
    xColumn: (r.x_column as string) ?? "",
    yColumns: JSON.parse((r.y_columns as string) ?? "[]") as string[],
    title: (r.title as string) ?? "",
    config: JSON.parse((r.config as string) ?? "{}") as Record<string, unknown>,
    version: r.version as number,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function listGraphsForCard(cardId: string): GraphSpec[] {
  return (getDb().prepare("SELECT * FROM graph_specs WHERE card_id=? ORDER BY name").all(cardId) as Record<string, unknown>[]).map(graphRow);
}

export function getGraph(id: string): GraphSpec | null {
  const r = getDb().prepare("SELECT * FROM graph_specs WHERE id=?").get(id);
  return r ? graphRow(r as Record<string, unknown>) : null;
}

export function createGraphSpec(input: { cardId: string; name?: string; chartType?: ChartType; xColumn?: string; yColumns?: string[]; title?: string; config?: Record<string, unknown> }): GraphSpec {
  // ms timestamp alone collides when several specs are created in one pass
  // (e.g. template suggestion inherit) — add randomness.
  const id = `gph-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO graph_specs (id,card_id,name,chart_type,x_column,y_columns,title,config,version,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,1,?,?)`
    )
    .run(
      id, input.cardId, input.name ?? "", input.chartType ?? "table",
      input.xColumn ?? "", JSON.stringify(input.yColumns ?? []),
      input.title ?? "", JSON.stringify(input.config ?? {}),
      now, now
    );
  return getGraph(id)!;
}

export function updateGraphSpec(id: string, patch: Partial<Pick<GraphSpec, "name" | "chartType" | "xColumn" | "yColumns" | "title" | "config">>): GraphSpec | null {
  const cur = getGraph(id);
  if (!cur) return null;
  const bump = patch.xColumn !== undefined && patch.xColumn !== cur.xColumn
    || patch.yColumns !== undefined && JSON.stringify(patch.yColumns) !== JSON.stringify(cur.yColumns)
    || patch.chartType !== undefined && patch.chartType !== cur.chartType;
  getDb()
    .prepare(
      `UPDATE graph_specs SET name=?,chart_type=?,x_column=?,y_columns=?,title=?,config=?,
       version=version+?,updated_at=? WHERE id=?`
    )
    .run(
      patch.name ?? cur.name, patch.chartType ?? cur.chartType,
      patch.xColumn ?? cur.xColumn, JSON.stringify(patch.yColumns ?? cur.yColumns),
      patch.title ?? cur.title, JSON.stringify(patch.config ?? cur.config),
      bump ? 1 : 0, new Date().toISOString(), id
    );
  return getGraph(id);
}

export function deleteGraph(id: string): boolean {
  return getDb().prepare("DELETE FROM graph_specs WHERE id=?").run(id).changes > 0;
}

/* ---------------- Query history (playground) ---------------- */

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

export function recordQueryHistory(entry: { lineId: string; sql: string; rowCount?: number; durationMs?: number; ok?: boolean; error?: string }): number {
  const r = getDb()
    .prepare(
      `INSERT INTO query_history (line_id,sql,row_count,duration_ms,ok,error,created_at)
       VALUES (?,?,?,?,?,?,?)`
    )
    .run(
      entry.lineId, entry.sql, entry.rowCount ?? null, entry.durationMs ?? null,
      (entry.ok ?? true) ? 1 : 0, entry.error ?? null, new Date().toISOString()
    );
  return Number(r.lastInsertRowid);
}

export function queryHistory(lineId: string, limit = 20): QueryHistoryEntry[] {
  return (getDb()
    .prepare("SELECT * FROM query_history WHERE line_id=? ORDER BY id DESC LIMIT ?")
    .all(lineId, limit) as Record<string, unknown>[])
    .map((x) => ({
      id: x.id as number,
      lineId: x.line_id as string,
      sql: x.sql as string,
      rowCount: (x.row_count as number) ?? null,
      durationMs: (x.duration_ms as number) ?? null,
      ok: (x.ok as number) === 1,
      error: (x.error as string) ?? null,
      createdAt: x.created_at as string,
    }));
}

/* ---------------- LLM call audit log (F6 AI Logs) ---------------- */

/** One row per llmChatJson call — success or failure, always explainable. */
export interface LlmCallAttempt {
  n: number;
  outcome: "ok" | "failed" | "rejected";
  /** Transport/parse failure, or the extraction stage on success. */
  detail: string;
  latencyMs: number;
  /** Sampling temperature of this attempt (rises per retry to break loops). */
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

/** Max rows retained; prune runs on every insert. */
export const LLM_CALLS_CAP = 2000;
/** Payload cap per text column so one wild completion can't bloat the DB. */
export const LLM_CALL_TEXT_CAP = 8000;

function capText(s: string): string {
  return s.length > LLM_CALL_TEXT_CAP ? `${s.slice(0, LLM_CALL_TEXT_CAP)}…[truncated]` : s;
}

function llmCallRow(x: Record<string, unknown>): LlmCallRecord {
  let attemptsJson: LlmCallAttempt[] = [];
  try {
    const v = JSON.parse((x.attempts_json as string) ?? "[]") as unknown;
    if (Array.isArray(v)) attemptsJson = v as LlmCallAttempt[];
  } catch { /* corrupt row: show empty timeline */ }
  let parsedJson: unknown | null = null;
  try {
    const raw = (x.parsed_json as string) ?? "";
    parsedJson = raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    parsedJson = x.parsed_json as string;
  }
  return {
    id: x.id as number,
    at: x.at as string,
    route: (x.route as string) ?? "",
    lineId: (x.line_id as string) ?? null,
    cardId: (x.card_id as string) ?? null,
    templateId: (x.template_id as string) ?? null,
    model: (x.model as string) ?? "",
    success: (x.success as number) === 1,
    reason: (x.reason as string) ?? null,
    attempts: (x.attempts as number) ?? 0,
    latencyMs: (x.latency_ms as number) ?? 0,
    attemptsJson,
    prompt: (x.prompt as string) ?? "",
    responseText: (x.response_text as string) ?? "",
    parsedJson,
  };
}

export function recordLlmCall(entry: {
  route: string;
  lineId?: string | null;
  cardId?: string | null;
  templateId?: string | null;
  model: string;
  success: boolean;
  reason: string | null;
  attempts: number;
  latencyMs: number;
  attemptsJson: LlmCallAttempt[];
  prompt: string;
  responseText: string;
  parsedJson: string;
}): number {
  const db = getDb();
  const r = db
    .prepare(
      `INSERT INTO llm_calls (at,route,line_id,card_id,template_id,model,success,reason,attempts,latency_ms,attempts_json,prompt,response_text,parsed_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      new Date().toISOString(),
      entry.route,
      entry.lineId ?? null,
      entry.cardId ?? null,
      entry.templateId ?? null,
      entry.model,
      entry.success ? 1 : 0,
      entry.reason,
      entry.attempts,
      entry.latencyMs,
      JSON.stringify(entry.attemptsJson),
      capText(entry.prompt),
      capText(entry.responseText),
      capText(entry.parsedJson)
    );
  db.prepare(
    `DELETE FROM llm_calls WHERE id NOT IN (SELECT id FROM llm_calls ORDER BY id DESC LIMIT ?)`
  ).run(LLM_CALLS_CAP);
  return Number(r.lastInsertRowid);
}

export interface LlmCallFilter {
  route?: string;
  lineId?: string;
  /** YYYY-MM-DD day filter (UTC). */
  date?: string;
  ok?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
}

export function listLlmCalls(f: LlmCallFilter = {}): { rows: LlmCallRecord[]; total: number } {
  const where: string[] = [];
  const args: unknown[] = [];
  if (f.route) {
    where.push("route = ?");
    args.push(f.route);
  }
  if (f.lineId) {
    where.push("line_id = ?");
    args.push(f.lineId);
  }
  if (f.date) {
    where.push("at >= ? AND at < date(?,'+1 day')");
    args.push(f.date, f.date);
  }
  if (f.ok != null) {
    where.push("success = ?");
    args.push(f.ok ? 1 : 0);
  }
  if (f.q) {
    where.push("(route LIKE ? OR model LIKE ? OR reason LIKE ? OR card_id LIKE ? OR template_id LIKE ?)");
    const like = `%${f.q}%`;
    args.push(like, like, like, like, like);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const total = (getDb().prepare(`SELECT COUNT(*) AS n FROM llm_calls ${whereSql}`).get(...args) as { n: number }).n;
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const offset = Math.max(f.offset ?? 0, 0);
  const rows = (getDb()
    .prepare(`SELECT * FROM llm_calls ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, offset) as Record<string, unknown>[])
    .map(llmCallRow);
  return { rows, total };
}

export function getLlmCall(id: number): LlmCallRecord | null {
  const x = getDb().prepare("SELECT * FROM llm_calls WHERE id=?").get(id) as Record<string, unknown> | undefined;
  return x ? llmCallRow(x) : null;
}

export interface LlmCallStats {
  last24h: number;
  okRate: number | null;
  avgLatencyMs: number;
  retries24h: number;
  retained: number;
  cap: number;
}

export function llmCallStats(): LlmCallStats {
  const db = getDb();
  const day = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(success),0) AS okCount,
              COALESCE(AVG(latency_ms),0) AS avgMs,
              COALESCE(SUM(CASE WHEN attempts>1 THEN attempts-1 ELSE 0 END),0) AS retries
       FROM llm_calls WHERE at >= datetime('now','-1 day')`
    )
    .get() as { total: number; okCount: number; avgMs: number; retries: number };
  const retained = (db.prepare("SELECT COUNT(*) AS n FROM llm_calls").get() as { n: number }).n;
  return {
    last24h: day.total,
    okRate: day.total > 0 ? day.okCount / day.total : null,
    avgLatencyMs: Math.round(day.avgMs),
    retries24h: day.retries,
    retained,
    cap: LLM_CALLS_CAP,
  };
}
