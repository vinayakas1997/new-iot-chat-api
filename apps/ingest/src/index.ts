/**
 * Ingestion entrypoint (Job 1 + Job 2 combined, plan.md §3). Runs ONCE and
 * exits — an external cron (or the ops "run now" button, or a bare `node-cron`
 * wrapper) invokes it on a cadence. Records a job_runs row for the ops dashboard.
 */
import { closeAppDb } from '@app/api/db/app';
import { getMachineDb } from '@app/api/db/machine';
import { logger } from '@app/api/logger';
import { finishJobRun, startJobRun } from '@app/api/jobrun';
import { runPipeline } from './pipeline.js';

async function main() {
  const runId = await startJobRun('ingest');
  try {
    const summary = await runPipeline();
    await finishJobRun(runId, { status: 'ok', pendingCount: summary.pendingAfter });
    logger.info(summary, 'ingest run ok');
  } catch (err) {
    logger.error({ err }, 'ingest run failed');
    await finishJobRun(runId, { status: 'error', error: (err as Error).message });
    process.exitCode = 1;
  } finally {
    await getMachineDb().close();
    await closeAppDb();
  }
}

void main();
