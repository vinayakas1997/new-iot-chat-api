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
    CREATE TABLE IF NOT EXISTS card_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sql_template TEXT NOT NULL DEFAULT '',
      granularity TEXT NOT NULL DEFAULT 'hourly' CHECK (granularity IN ('hourly','shift','daily')),
      unit TEXT NOT NULL DEFAULT '',
      extract_hint TEXT NOT NULL DEFAULT '',
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

/* ---------------- F3: context component cards ---------------- */

export type Granularity = "hourly" | "shift" | "daily";
export type CardStatus = "live" | "dormant";

export interface CardTemplate {
  id: string;
  name: string;
  description: string;
  sqlTemplate: string;
  granularity: Granularity;
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
  granularity: Granularity;
  unit: string;
  extractHint: string;
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
    sqlTemplate: (r.sql_template as string) ?? "",
    granularity: r.granularity as Granularity,
    unit: (r.unit as string) ?? "",
    extractHint: (r.extract_hint as string) ?? "",
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
    unit: (r.unit as string) ?? "",
    extractHint: (r.extract_hint as string) ?? "",
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
      `INSERT INTO card_templates (id,name,description,sql_template,granularity,unit,extract_hint,version,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,1,?,?)`
    )
    .run(id, t.name, t.description, t.sqlTemplate, t.granularity, t.unit, t.extractHint, now, now);
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
      `UPDATE card_templates SET name=?,description=?,sql_template=?,granularity=?,unit=?,extract_hint=?,
       version=version+?,updated_at=? WHERE id=?`
    )
    .run(
      patch.name ?? cur.name,
      patch.description ?? cur.description,
      patch.sqlTemplate ?? cur.sqlTemplate,
      patch.granularity ?? cur.granularity,
      patch.unit ?? cur.unit,
      patch.extractHint ?? cur.extractHint,
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
  unit?: string;
  extractHint?: string;
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
      `INSERT INTO cards (id,template_id,template_version,line_id,name,tables_json,sql_text,granularity,unit,extract_hint,threshold,status,version,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?, 'dormant',1,?,?)`
    )
    .run(
      id, tpl?.id ?? null, tpl?.version ?? null, input.lineId, input.name,
      JSON.stringify(input.tables), input.sql, input.granularity,
      input.unit ?? "", input.extractHint ?? "", input.threshold ?? null, now, now
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
  return createCard({
    lineId,
    name: overrides?.name ?? tpl.name,
    tables: overrides?.tables ?? [...line.memberTables],
    sql: overrides?.sql ?? tpl.sqlTemplate,
    granularity: tpl.granularity,
    unit: tpl.unit,
    extractHint: tpl.extractHint,
    templateId: tpl.id,
  });
}

export function updateCard(
  id: string,
  patch: Partial<Pick<CardInput, "name" | "tables" | "sql" | "granularity" | "unit" | "extractHint" | "threshold">>
): Card | null {
  const cur = getCard(id);
  if (!cur) return null;
  if (cur.status === "live") throw new Error("card is LIVE — take it dormant before editing");
  const tables = patch.tables ?? cur.tables;
  const outside = tablesSubsetOfLine(tables, cur.lineId);
  if (outside.length > 0) throw new Error(`tables not in line members: ${outside.join(", ")}`);
  const sqlChanged = patch.sql !== undefined && patch.sql !== cur.sql;
  getDb()
    .prepare(
      `UPDATE cards SET name=?,tables_json=?,sql_text=?,granularity=?,unit=?,extract_hint=?,threshold=?,
       version=version+?,updated_at=? WHERE id=?`
    )
    .run(
      patch.name ?? cur.name, JSON.stringify(tables), patch.sql ?? cur.sql,
      patch.granularity ?? cur.granularity, patch.unit ?? cur.unit,
      patch.extractHint ?? cur.extractHint, patch.threshold ?? cur.threshold,
      sqlChanged ? 1 : 0, new Date().toISOString(), id
    );
  if (sqlChanged) logCardEvent(id, "edited", "sql changed → re-test required before activation");
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
  ok: boolean;
  rowsPulled: number;
  unitsBuilt: number;
  factsStored: number;
  durationMs: number | null;
  error: string | null;
}

export function recordRun(r: Omit<RunRecord, "id">): number {
  const res = getDb()
    .prepare(
      `INSERT INTO runs (at,line_id,card_id,card_version,kind,ok,rows_pulled,units_built,facts_stored,duration_ms,error)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(r.at, r.lineId, r.cardId, r.cardVersion, r.kind, r.ok ? 1 : 0, r.rowsPulled, r.unitsBuilt, r.factsStored, r.durationMs, r.error);
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

export function lastFactWrite(): string | null {
  const r = getDb().prepare("SELECT MAX(at) AS at FROM runs WHERE facts_stored>0").get() as { at: string | null };
  return r.at;
}

export function getRun(id: number): RunRecord | null {
  const x = getDb().prepare("SELECT * FROM runs WHERE id=?").get(id) as Record<string, unknown> | undefined;
  if (!x) return null;
  return {
    id: x.id as number, at: x.at as string, lineId: x.line_id as string,
    cardId: x.card_id as string, cardVersion: x.card_version as number,
    kind: x.kind as "test" | "tick", ok: (x.ok as number) === 1,
    rowsPulled: x.rows_pulled as number, unitsBuilt: x.units_built as number,
    factsStored: x.facts_stored as number, durationMs: (x.duration_ms as number) ?? null,
    error: (x.error as string) ?? null,
  };
}
