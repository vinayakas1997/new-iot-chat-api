import type { ParsedSchedule, Schedule } from '@app/shared';
import { and, eq } from 'drizzle-orm';
import { getAppDb } from '../db/app/client.js';
import { schedules, type ScheduleRow } from '../db/app/schema.js';
import { nextRunAt, toCronExpr } from './cron.js';

function toDto(r: ScheduleRow): Schedule {
  return {
    id: r.id,
    userId: r.userId,
    heading: (r as any).heading ?? undefined,
    queryText: r.queryText,
    timeOfDay: r.timeOfDay,
    recurrence: r.recurrence as Schedule['recurrence'],
    weekday: r.weekday ?? undefined,
    onDate: r.onDate ?? undefined,
    timezone: r.timezone,
    cronExpr: r.cronExpr,
    active: r.active,
    nextRunAt: r.nextRunAt?.toISOString() ?? null,
    lastRunAt: r.lastRunAt?.toISOString() ?? null,
    lastResult: (r.lastResult as Schedule['lastResult']) ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listSchedules(userId: string): Promise<Schedule[]> {
  const rows = await getAppDb().select().from(schedules).where(eq(schedules.userId, userId));
  return rows.map(toDto);
}

export async function createSchedule(userId: string, p: ParsedSchedule): Promise<Schedule> {
  const [row] = await getAppDb()
    .insert(schedules)
    .values({
      userId,
      heading: (p as any).heading ?? null,
      queryText: p.queryText,
      timeOfDay: p.timeOfDay,
      recurrence: p.recurrence,
      weekday: p.weekday ?? null,
      onDate: p.onDate ?? null,
      timezone: p.timezone,
      cronExpr: toCronExpr(p),
      active: true,
      nextRunAt: nextRunAt(p),
    } as any)
    .returning();
  return toDto(row!);
}

export async function setScheduleActive(
  userId: string,
  id: string,
  active: boolean,
): Promise<Schedule | null> {
  const [row] = await getAppDb()
    .update(schedules)
    .set({ active })
    .where(and(eq(schedules.id, id), eq(schedules.userId, userId)))
    .returning();
  return row ? toDto(row) : null;
}

export async function deleteSchedule(userId: string, id: string): Promise<boolean> {
  const rows = await getAppDb()
    .delete(schedules)
    .where(and(eq(schedules.id, id), eq(schedules.userId, userId)))
    .returning({ id: schedules.id });
  return rows.length > 0;
}
