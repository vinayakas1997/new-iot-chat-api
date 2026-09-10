/** Bookkeeping for the ops dashboard — one row per job execution. */
import type { JobName } from '@app/shared';
import { eq } from 'drizzle-orm';
import { getAppDb } from './db/app/client.js';
import { jobRuns } from './db/app/schema.js';

export async function startJobRun(jobName: JobName): Promise<string> {
  const [row] = await getAppDb()
    .insert(jobRuns)
    .values({ jobName, status: 'running' })
    .returning({ id: jobRuns.id });
  return row!.id;
}

export async function finishJobRun(
  id: string,
  outcome: { status: 'ok' | 'error'; pendingCount?: number; error?: string },
): Promise<void> {
  await getAppDb()
    .update(jobRuns)
    .set({
      status: outcome.status,
      finishedAt: new Date(),
      pendingCount: outcome.pendingCount ?? 0,
      error: outcome.error ?? null,
    })
    .where(eq(jobRuns.id, id));
}
