/**
 * Report scheduler (Job 3, §5.7). A standalone process. Ticks once a minute,
 * asks the app store which user schedules are due, and runs each report. Reads
 * only from Hindsight via the shared report module — never Postgres directly.
 *
 * Design (plan.md §3): fully separate from ingestion. If ingestion is late,
 * recall simply returns fewer facts and the report says so.
 */
import cron from 'node-cron';
import { config } from '@app/api/config';
import { logger } from '@app/api/logger';
import { closeAppDb } from '@app/api/db/app';
import { getDueSchedules } from '@app/api/report/due';
import { runReportForSchedule } from '@app/api/report/run';
import { finishJobRun, startJobRun } from '@app/api/jobrun';

let running = false;

async function tick() {
  if (running) return; // never overlap ticks
  running = true;
  const runId = await startJobRun('scheduler');
  let processed = 0;
  try {
    const due = await getDueSchedules(new Date());
    for (const s of due) {
      logger.info({ scheduleId: s.id, user: s.userId, q: s.queryText }, 'running due report');
      try {
        const result = await runReportForSchedule(s);
        logger.info({ scheduleId: s.id, result }, 'report done');
      } catch (err) {
        logger.error({ err, scheduleId: s.id }, 'report run failed');
      }
      processed++;
    }
    await finishJobRun(runId, { status: 'ok', pendingCount: 0 });
  } catch (err) {
    logger.error({ err }, 'scheduler tick failed');
    await finishJobRun(runId, { status: 'error', error: (err as Error).message });
  } finally {
    running = false;
    if (processed) logger.info({ processed }, 'tick complete');
  }
}

logger.info({ mode: config.runtimeMode }, 'scheduler starting — ticking every minute');
const task = cron.schedule('* * * * *', () => void tick());
void tick(); // run once on boot too

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, async () => {
    task.stop();
    await closeAppDb();
    process.exit(0);
  });
}
