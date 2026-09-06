/**
 * Fixture-backed MachineDb for RUNTIME_MODE=mock.
 *
 * It does NOT parse SQL. It recognises the handful of query shapes the current
 * stubs use (matched loosely on keywords) and returns sample rows. Anything it
 * doesn't recognise throws a loud error so mock gaps are obvious rather than
 * silently returning [].
 *
 * Replace nothing here when going live — live mode uses PgMachineDb instead.
 */
import type { Pool, QueryResultRow } from 'pg';
import { logger } from '../logger.js';
import type { MachineDb, QueryResult } from './machine-db.js';
import { SAMPLE_HOURLY_ROWS, SAMPLE_NEW_ROWS } from './sample-data.js';

export class MockMachineDb implements MachineDb {
  async checkDbConnection(): Promise<boolean> {
    return true;
  }

  getConnectionPool(): Pool {
    throw new Error('getConnectionPool() is not available in mock mode');
  }

  async executeQuery<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    const q = sql.toLowerCase().replace(/\s+/g, ' ').trim();
    logger.debug({ q, params }, 'mock machine-db query');

    if (q === 'select 1' || q.startsWith('select 1 ')) {
      return this.wrap([{ ok: 1 }] as unknown as T[]);
    }
    // ingest: incremental pull of not-yet-picked-up rows
    if (q.includes('from production_rows') && q.includes('where') && q.includes('status')) {
      return this.wrap(SAMPLE_NEW_ROWS as unknown as T[]);
    }
    // context builder / live tool: hourly breakdown
    if (q.includes('hourly') || (q.includes('date_trunc') && q.includes("'hour'"))) {
      return this.wrap(SAMPLE_HOURLY_ROWS as unknown as T[]);
    }
    // ingest: flip status flags — accept and report affected count
    if (q.startsWith('update production_rows set status')) {
      const ids = (params[0] as unknown[] | undefined) ?? [];
      return { rows: [], rowCount: Array.isArray(ids) ? ids.length : 0 };
    }

    throw new Error(
      `MockMachineDb: unrecognised query. Add a fixture branch in mock-machine-db.ts.\n  SQL: ${sql}`,
    );
  }

  async close(): Promise<void> {
    /* nothing to close */
  }

  private wrap<T extends QueryResultRow>(rows: T[]): QueryResult<T> {
    return { rows, rowCount: rows.length };
  }
}
