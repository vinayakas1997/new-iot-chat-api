/**
 * ────────────────────────────────────────────────────────────────────────────
 *  §5.1  POSTGRES CONNECTION LAYER  —  the industrial / plant database
 * ────────────────────────────────────────────────────────────────────────────
 *
 *  Read-only from our side. Consumed by:
 *    - the ingestion job (batch pulls)
 *    - the ops dashboard health check
 *    - the chat "live SQL" tool (via a narrower read-only wrapper)
 *
 *  Public surface (per plan.md §5.1):
 *    - checkDbConnection()          -> SELECT 1 ping
 *    - getConnectionPool()          -> pooled connection (live mode only)
 *    - executeQuery(sql, params)    -> retry-on-transient + hard statement timeout
 *
 *  In RUNTIME_MODE=mock a fixture-backed implementation is returned so the whole
 *  system runs with no plant database present.
 */
import { Pool, type PoolConfig, type QueryResultRow } from 'pg';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { MockMachineDb } from './mock-machine-db.js';

export interface QueryResult<T extends QueryResultRow = QueryResultRow> {
  rows: T[];
  rowCount: number;
}

export interface MachineDb {
  /** Cheap liveness probe. Never throws — returns false on any failure. */
  checkDbConnection(): Promise<boolean>;
  /** Parameterized query with transient-failure retry and a hard timeout. */
  executeQuery<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
  /** Underlying pool (live mode). Throws in mock mode. */
  getConnectionPool(): Pool;
  close(): Promise<void>;
}

/** Postgres error codes worth retrying (connection dropped / admin shutdown / too many clients). */
const TRANSIENT_CODES = new Set(['57P01', '57P02', '57P03', '53300', '08000', '08003', '08006', 'XX000']);
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class PgMachineDb implements MachineDb {
  private readonly pool: Pool;

  constructor() {
    const poolConfig: PoolConfig = {
      connectionString: config.machineDb.url,
      max: config.machineDb.poolMax,
      connectionTimeoutMillis: config.machineDb.connectTimeoutMs,
      idleTimeoutMillis: 30_000,
      // Enforced per-connection so a single slow query can't wedge a pool slot.
      statement_timeout: config.machineDb.statementTimeoutMs,
      query_timeout: config.machineDb.statementTimeoutMs,
      application_name: 'industrial-rag-sql',
    };
    this.pool = new Pool(poolConfig);
    this.pool.on('error', (err) => logger.error({ err }, 'machine-db idle client error'));
  }

  getConnectionPool(): Pool {
    return this.pool;
  }

  async checkDbConnection(): Promise<boolean> {
    try {
      const res = await this.pool.query('SELECT 1 AS ok');
      return res.rows[0]?.ok === 1;
    } catch (err) {
      logger.warn({ err }, 'machine-db checkDbConnection failed');
      return false;
    }
  }

  async executeQuery<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await this.pool.query<T>(sql, params);
        return { rows: res.rows, rowCount: res.rowCount ?? res.rows.length };
      } catch (err) {
        lastErr = err;
        const code = (err as { code?: string }).code;
        const retryable = code !== undefined && TRANSIENT_CODES.has(code);
        if (!retryable || attempt === MAX_ATTEMPTS) break;
        const backoff = BASE_BACKOFF_MS * 2 ** (attempt - 1);
        logger.warn({ code, attempt, backoff }, 'machine-db transient error, retrying');
        await sleep(backoff);
      }
    }
    throw lastErr;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

let singleton: MachineDb | null = null;

export function getMachineDb(): MachineDb {
  if (singleton) return singleton;
  singleton = config.isMock ? new MockMachineDb() : new PgMachineDb();
  logger.info({ mode: config.runtimeMode }, 'machine-db initialised');
  return singleton;
}
