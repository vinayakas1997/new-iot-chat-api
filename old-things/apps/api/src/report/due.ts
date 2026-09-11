/** get_due_schedules (§5.7) — active schedules whose nextRunAt has passed. */
import type { Schedule } from '@app/shared';
import { and, eq, isNotNull, lte } from 'drizzle-orm';
import { getAppDb } from '../db/app/client.js';
import { schedules, type ScheduleRow } from '../db/app/schema.js';

function toDto(r: ScheduleRow): Schedule {
  return {
    id: r.id,
    userId: r.userId,
    queryText: r.queryText,
    lineId: r.lineId ?? undefined,
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

export async function getDueSchedules(now: Date = new Date()): Promise<Schedule[]> {
  const rows = await getAppDb()
    .select()
    .from(schedules)
    .where(
      and(eq(schedules.active, true), isNotNull(schedules.nextRunAt), lte(schedules.nextRunAt, now)),
    );
  return rows.map(toDto);
}
