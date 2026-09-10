/**
 * The app store — OUR Postgres. Separate database from the plant data and from
 * Hindsight's own store. Holds identity, per-user settings, schedules, answer
 * history, and job-run bookkeeping for the ops dashboard.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(), // argon2; NO email column by design
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const themes = pgTable('themes', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  theme: text('theme').notNull().default('system'), // system | light | dark
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const schedules = pgTable('schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  heading: text('heading'),
  queryText: text('query_text').notNull(),
  timeOfDay: text('time_of_day').notNull(), // "HH:MM" local
  recurrence: text('recurrence').notNull(), // daily | weekdays | weekly | once | hourly
  weekday: integer('weekday'), // 0..6 when recurrence = weekly
  onDate: text('on_date'), // "YYYY-MM-DD" when recurrence = once
  timezone: text('timezone').notNull(),
  cronExpr: text('cron_expr').notNull(),
  active: boolean('active').notNull().default(true),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastResult: text('last_result'), // ok | condition_met | condition_not_met | error
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const history = pgTable('history', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  source: text('source').notNull(), // chat | report
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  scheduleId: uuid('schedule_id').references(() => schedules.id, { onDelete: 'set null' }),
  meta: jsonb('meta').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const jobRuns = pgTable('job_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobName: text('job_name').notNull(), // ingest | scheduler
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: text('status').notNull().default('running'), // running | ok | error
  pendingCount: integer('pending_count').notNull().default(0),
  error: text('error'),
});

export type UserRow = typeof users.$inferSelect;
export type ScheduleRow = typeof schedules.$inferSelect;
export type HistoryRow = typeof history.$inferSelect;
export type JobRunRow = typeof jobRuns.$inferSelect;
