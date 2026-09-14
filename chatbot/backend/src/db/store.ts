import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

let db: Database.Database | null = null;

export function openStore(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New chat',
      line_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user','assistant')),
      content TEXT NOT NULL DEFAULT '',
      charts TEXT NOT NULL DEFAULT '[]',
      sources TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id);
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      line_id TEXT NOT NULL,
      questions TEXT NOT NULL DEFAULT '[]',
      format TEXT NOT NULL DEFAULT 'headline' CHECK (format IN ('headline','kpi','table')),
      cron TEXT NOT NULL DEFAULT '30 8 * * *',
      timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run TEXT,
      last_status TEXT,
      next_run TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      at TEXT NOT NULL,
      questions TEXT NOT NULL DEFAULT '[]',
      answer TEXT NOT NULL DEFAULT '{}',
      ok INTEGER NOT NULL DEFAULT 1,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_reports_schedule ON reports(schedule_id, at DESC);
  `);
  return db;
}

function conn(): Database.Database {
  if (!db) throw new Error("store not open");
  return db;
}

const now = () => new Date().toISOString();

/* ---- sessions ---- */

export interface ChatSession {
  id: string;
  title: string;
  lineIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: number;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  charts: unknown[];
  sources: unknown[];
  createdAt: string;
}

function rowToSession(r: Record<string, unknown>): ChatSession {
  return {
    id: r.id as string,
    title: r.title as string,
    lineIds: JSON.parse((r.line_ids as string) || "[]"),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function createSession(lineIds: string[], title?: string): ChatSession {
  const t = now();
  const s: ChatSession = {
    id: randomUUID().slice(0, 8),
    title: title ?? "New chat",
    lineIds,
    createdAt: t,
    updatedAt: t,
  };
  conn()
    .prepare("INSERT INTO chat_sessions (id,title,line_ids,created_at,updated_at) VALUES (?,?,?,?,?)")
    .run(s.id, s.title, JSON.stringify(s.lineIds), s.createdAt, s.updatedAt);
  return s;
}

export function listSessions(): ChatSession[] {
  return conn().prepare("SELECT * FROM chat_sessions ORDER BY updated_at DESC LIMIT 100").all().map((r) => rowToSession(r as Record<string, unknown>));
}

export function getSession(id: string): ChatSession | null {
  const r = conn().prepare("SELECT * FROM chat_sessions WHERE id=?").get(id) as Record<string, unknown> | undefined;
  return r ? rowToSession(r) : null;
}

export function touchSession(id: string, title?: string): void {
  if (title) conn().prepare("UPDATE chat_sessions SET title=?, updated_at=? WHERE id=?").run(title, now(), id);
  else conn().prepare("UPDATE chat_sessions SET updated_at=? WHERE id=?").run(now(), id);
}

export function deleteSession(id: string): boolean {
  conn().prepare("DELETE FROM chat_messages WHERE session_id=?").run(id);
  return conn().prepare("DELETE FROM chat_sessions WHERE id=?").run(id).changes > 0;
}

export function addMessage(sessionId: string, role: "user" | "assistant", content: string, charts: unknown[] = [], sources: unknown[] = []): ChatMessage {
  const t = now();
  const info = conn()
    .prepare("INSERT INTO chat_messages (session_id,role,content,charts,sources,created_at) VALUES (?,?,?,?,?,?)")
    .run(sessionId, role, content, JSON.stringify(charts), JSON.stringify(sources), t);
  touchSession(sessionId);
  return { id: Number(info.lastInsertRowid), sessionId, role, content, charts, sources, createdAt: t };
}

export function listMessages(sessionId: string): ChatMessage[] {
  return (conn().prepare("SELECT * FROM chat_messages WHERE session_id=? ORDER BY id ASC LIMIT 200").all(sessionId) as Record<string, unknown>[]).map((r) => ({
    id: r.id as number,
    sessionId: r.session_id as string,
    role: r.role as "user" | "assistant",
    content: r.content as string,
    charts: JSON.parse((r.charts as string) || "[]"),
    sources: JSON.parse((r.sources as string) || "[]"),
    createdAt: r.created_at as string,
  }));
}

/* ---- schedules / reports ---- */

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

function rowToSchedule(r: Record<string, unknown>): Schedule {
  return {
    id: r.id as string,
    name: r.name as string,
    lineId: r.line_id as string,
    questions: JSON.parse((r.questions as string) || "[]"),
    format: r.format as Schedule["format"],
    cron: r.cron as string,
    timezone: r.timezone as string,
    enabled: (r.enabled as number) === 1,
    lastRun: (r.last_run as string) ?? null,
    lastStatus: (r.last_status as string) ?? null,
    nextRun: (r.next_run as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function createSchedule(input: { name: string; lineId: string; questions: string[]; format: Schedule["format"]; cron: string; timezone?: string }): Schedule {
  const t = now();
  const s: Schedule = {
    id: randomUUID().slice(0, 8),
    name: input.name,
    lineId: input.lineId,
    questions: input.questions,
    format: input.format,
    cron: input.cron,
    timezone: input.timezone ?? "Asia/Kolkata",
    enabled: true,
    lastRun: null,
    lastStatus: null,
    nextRun: null,
    createdAt: t,
    updatedAt: t,
  };
  conn()
    .prepare("INSERT INTO schedules (id,name,line_id,questions,format,cron,timezone,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(s.id, s.name, s.lineId, JSON.stringify(s.questions), s.format, s.cron, s.timezone, 1, s.createdAt, s.updatedAt);
  return s;
}

export function listSchedules(): Schedule[] {
  return (conn().prepare("SELECT * FROM schedules ORDER BY created_at DESC").all() as Record<string, unknown>[]).map(rowToSchedule);
}

export function getSchedule(id: string): Schedule | null {
  const r = conn().prepare("SELECT * FROM schedules WHERE id=?").get(id) as Record<string, unknown> | undefined;
  return r ? rowToSchedule(r) : null;
}

export function updateSchedule(id: string, patch: Partial<Pick<Schedule, "name" | "lineId" | "questions" | "format" | "cron" | "timezone" | "enabled">>): Schedule | null {
  const cur = getSchedule(id);
  if (!cur) return null;
  const next = { ...cur, ...patch, updatedAt: now() };
  conn()
    .prepare("UPDATE schedules SET name=?,line_id=?,questions=?,format=?,cron=?,timezone=?,enabled=?,updated_at=? WHERE id=?")
    .run(next.name, next.lineId, JSON.stringify(next.questions), next.format, next.cron, next.timezone, next.enabled ? 1 : 0, next.updatedAt, id);
  return { ...next };
}

export function deleteSchedule(id: string): boolean {
  conn().prepare("DELETE FROM reports WHERE schedule_id=?").run(id);
  return conn().prepare("DELETE FROM schedules WHERE id=?").run(id).changes > 0;
}

export function markScheduleRun(id: string, ok: boolean, detail: string | null): void {
  conn().prepare("UPDATE schedules SET last_run=?, last_status=?, updated_at=? WHERE id=?").run(now(), ok ? "ok" : `failed: ${detail ?? ""}`.slice(0, 500), now(), id);
}

export interface Report {
  id: number;
  scheduleId: string;
  at: string;
  questions: string[];
  answer: Record<string, unknown>;
  ok: boolean;
  error: string | null;
}

export function saveReport(scheduleId: string, questions: string[], answer: Record<string, unknown>, ok: boolean, error: string | null): Report {
  const at = now();
  const info = conn()
    .prepare("INSERT INTO reports (schedule_id,at,questions,answer,ok,error) VALUES (?,?,?,?,?,?)")
    .run(scheduleId, at, JSON.stringify(questions), JSON.stringify(answer), ok ? 1 : 0, error);
  return { id: Number(info.lastInsertRowid), scheduleId, at, questions, answer, ok, error };
}

export function listReports(scheduleId?: string, date?: string, limit = 60): Report[] {
  let sql = "SELECT * FROM reports";
  const args: unknown[] = [];
  const conds: string[] = [];
  if (scheduleId) {
    conds.push("schedule_id=?");
    args.push(scheduleId);
  }
  if (date) {
    conds.push("substr(at,1,10)=?");
    args.push(date);
  }
  if (conds.length) sql += " WHERE " + conds.join(" AND ");
  sql += " ORDER BY at DESC LIMIT ?";
  args.push(limit);
  return (conn().prepare(sql).all(...args) as Record<string, unknown>[]).map((r) => ({
    id: r.id as number,
    scheduleId: r.schedule_id as string,
    at: r.at as string,
    questions: JSON.parse((r.questions as string) || "[]"),
    answer: JSON.parse((r.answer as string) || "{}"),
    ok: (r.ok as number) === 1,
    error: (r.error as string) ?? null,
  }));
}

export function getReport(id: number): Report | null {
  const r = conn().prepare("SELECT * FROM reports WHERE id=?").get(id) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: r.id as number,
    scheduleId: r.schedule_id as string,
    at: r.at as string,
    questions: JSON.parse((r.questions as string) || "[]"),
    answer: JSON.parse((r.answer as string) || "{}"),
    ok: (r.ok as number) === 1,
    error: (r.error as string) ?? null,
  };
}
