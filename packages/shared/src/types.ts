/**
 * Shared contract types across API, jobs, and both UIs.
 * Keep this framework-free (zod + plain types only).
 */
import { z } from 'zod';

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

export const Recurrence = z.enum(['daily', 'weekdays', 'weekly', 'once']);
export type Recurrence = z.infer<typeof Recurrence>;

/** Result of parsing a natural-language schedule request. */
export const ParsedSchedule = z.object({
  queryText: z.string().min(1),
  /** 24h local time "HH:MM". */
  timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  recurrence: Recurrence,
  /** 0=Sun..6=Sat; required when recurrence === 'weekly'. */
  weekday: z.number().int().min(0).max(6).optional(),
  /** ISO date "YYYY-MM-DD"; required when recurrence === 'once'. */
  onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** IANA tz, e.g. "Asia/Kolkata". */
  timezone: z.string().min(1),
});
export type ParsedSchedule = z.infer<typeof ParsedSchedule>;

export const Schedule = ParsedSchedule.extend({
  id: z.string(),
  userId: z.string(),
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
  answer: z.string(),
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
