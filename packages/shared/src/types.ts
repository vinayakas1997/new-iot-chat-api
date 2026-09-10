/**
 * Shared contract types across API, jobs, and both UIs.
 * Framework-free (zod + plain types only).
 * History answers store the full envelope so graphs replay (08-open-decisions #7).
 */
import { z } from 'zod';
import { ChartData } from './chart-schema.js';

/* ------------------------------------------------------------------ lines --- */

export const LineEntry = z.object({
  id: z.string(),
  /** Canonical name, e.g. "line-1". Matches industrial line_id + bank suffix. */
  name: z.string().min(1),
  displayName: z.string().optional(),
  active: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: z.string().datetime(),
});
export type LineEntry = z.infer<typeof LineEntry>;

/* ------------------------------------------------------------------ auth --- */

export const Credentials = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});
export type Credentials = z.infer<typeof Credentials>;

export const AuthUser = z.object({
  userId: z.string(),
  username: z.string(),
});
export type AuthUser = z.infer<typeof AuthUser>;

/* ---------------------------------------------------------------- themes --- */

export const Theme = z.enum(['system', 'light', 'dark']);
export type Theme = z.infer<typeof Theme>;

/* ------------------------------------------------------------- schedules --- */

export const Recurrence = z.enum(['daily', 'weekdays', 'weekly', 'once', 'hourly']);
export type Recurrence = z.infer<typeof Recurrence>;

/** Result of parsing a natural-language schedule request. */
export const ParsedSchedule = z.object({
  heading: z.string().min(1).max(120).optional(),
  queryText: z.string().min(1),
  /** 24h local time "HH:MM". For hourly this is the minute offset (HH ignored, MM is minute). */
  timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  recurrence: Recurrence,
  /** 0=Sun..6=Sat; required when recurrence === 'weekly'. */
  weekday: z.number().int().min(0).max(6).optional(),
  /** ISO date "YYYY-MM-DD"; required when recurrence === 'once'. */
  onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** IANA tz, e.g. "Asia/Ho_Chi_Minh". */
  timezone: z.string().min(1),
  /** Single line scope (clone-per-line). Omitted = not mentioned. */
  lineId: z.string().min(1).optional(),
});
export type ParsedSchedule = z.infer<typeof ParsedSchedule>;

export const Schedule = ParsedSchedule.extend({
  id: z.string(),
  userId: z.string(),
  /** Single line scope (clone-per-line). Undefined = legacy row → default line. */
  lineId: z.string().min(1).optional(),
  active: z.boolean(),
  cronExpr: z.string(),
  nextRunAt: z.string().datetime().nullable(),
  lastRunAt: z.string().datetime().nullable(),
  lastResult: z.enum(['ok', 'condition_met', 'condition_not_met', 'error']).nullable(),
  createdAt: z.string().datetime(),
});
export type Schedule = z.infer<typeof Schedule>;

/* --------------------------------------------------------------- history --- */

export const HistorySource = z.enum(['chat', 'report']);
export type HistorySource = z.infer<typeof HistorySource>;

export const HistoryEntry = z.object({
  id: z.string(),
  userId: z.string(),
  source: HistorySource,
  question: z.string(),
  /** Full answer envelope (summary + charts), so History renders graphs too. */
  answer: z.string(),
  charts: z.array(ChartData).default([]),
  scheduleId: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type HistoryEntry = z.infer<typeof HistoryEntry>;

/* ------------------------------------------------------------------ chat --- */

export const ChatRole = z.enum(['user', 'assistant']);
export const ChatMessage = z.object({
  role: ChatRole,
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const ChatRequest = z.object({
  messages: z.array(ChatMessage).min(1),
  /** Line scope. Omitted/empty = all active lines (resolved server-side). */
  lineIds: z.array(z.string().min(1)).max(50).optional(),
});
export type ChatRequest = z.infer<typeof ChatRequest>;

/* --------------------------------------------------------- ops dashboard --- */

export const JobName = z.enum(['ingest', 'scheduler']);
export type JobName = z.infer<typeof JobName>;

export const JobRun = z.object({
  id: z.string(),
  jobName: JobName,
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  status: z.enum(['running', 'ok', 'error']),
  pendingCount: z.number().int().nonnegative(),
  error: z.string().nullable(),
});
export type JobRun = z.infer<typeof JobRun>;

export const JobStatus = z.object({
  jobName: JobName,
  lastRun: JobRun.nullable(),
  healthy: z.boolean(),
  /** Populated when healthy === false. */
  reason: z.string().optional(),
});
export type JobStatus = z.infer<typeof JobStatus>;

/* --------------------------------------------------------------- runtime --- */

export const RuntimeMode = z.enum(['mock', 'live']);
export type RuntimeMode = z.infer<typeof RuntimeMode>;
