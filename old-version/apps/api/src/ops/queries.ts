/**
 * §5.8 ops-dashboard reads. Pure data assembly over `job_runs` + `schedules`.
 */
import type { JobName, JobStatus } from '@app/shared';
import { desc, eq } from 'drizzle-orm';
import { getAppDb } from '../db/app/client.js';
import { jobRuns, schedules } from '../db/app/schema.js';

/** A job is "unhealthy" if its last run errored, or if the newest run is older than this. */
const STALE_AFTER_MS: Record<JobName, number> = {
  ingest: 6 * 60 * 60 * 1000, // expect ingestion at least every 6h
  scheduler: 5 * 60 * 1000, // scheduler ticks every minute; 5 min gap = problem
};

export async function getJobStatus(jobName: JobName): Promise<JobStatus> {
  const [last] = await getAppDb()
    .select()
    .from(jobRuns)
    .where(eq(jobRuns.jobName, jobName))
    .orderBy(desc(jobRuns.startedAt))
    .limit(1);

  if (!last) {
    return { jobName, lastRun: null, healthy: false, reason: 'no runs recorded yet' };
  }

  const lastRun = {
    id: last.id,
    jobName,
    startedAt: last.startedAt.toISOString(),
    finishedAt: last.finishedAt?.toISOString() ?? null,
    status: last.status as 'running' | 'ok' | 'error',
    pendingCount: last.pendingCount,
    error: last.error ?? null,
  };

  const age = Date.now() - last.startedAt.getTime();
  let healthy = true;
  let reason: string | undefined;
  if (last.status === 'error') {
    healthy = false;
    reason = `last run errored: ${last.error ?? 'unknown'}`;
  } else if (last.status !== 'running' && age > STALE_AFTER_MS[jobName]) {
    healthy = false;
    reason = `last run was ${Math.round(age / 60000)} min ago (expected sooner)`;
  }
  return { jobName, lastRun, healthy, reason };
}

export async function getAllJobStatus(): Promise<JobStatus[]> {
  return Promise.all((['ingest', 'scheduler'] as JobName[]).map(getJobStatus));
}

export async function getSchedulerOverview() {
  const rows = await getAppDb().select().from(schedules);
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    queryText: r.queryText,
    active: r.active,
    timeOfDay: r.timeOfDay,
    timezone: r.timezone,
    lastRunAt: r.lastRunAt?.toISOString() ?? null,
    lastResult: r.lastResult,
    nextRunAt: r.nextRunAt?.toISOString() ?? null,
  }));
}

export async function recentRuns(jobName: JobName, limit = 20) {
  const rows = await getAppDb()
    .select()
    .from(jobRuns)
    .where(eq(jobRuns.jobName, jobName))
    .orderBy(desc(jobRuns.startedAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    status: r.status,
    pendingCount: r.pendingCount,
    error: r.error,
  }));
}
