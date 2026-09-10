/**
 * Crash-safety bookkeeping (plan.md §3). The authoritative status lives on the
 * plant rows themselves: 'new' -> 'pending' (picked up) -> 'ingested' (retained).
 * A crash mid-run just leaves rows 'pending'; the next run re-processes them
 * because fetchNewRowsSince also picks up stale 'pending' rows.
 *
 * The checkpoint marker (last processed ts) is stored in our app store so we
 * don't rescan the whole table. Here it's kept in job_runs.error-free metadata;
 * for the stub we simply use the current time.
 */
export function newCheckpoint(): string {
  return new Date().toISOString();
}
