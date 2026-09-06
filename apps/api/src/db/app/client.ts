/**
 * App-store Drizzle client. Always a real Postgres connection (even in mock
 * runtime mode) — mock mode only fakes the *plant* database and the LLMs, not
 * our own store. Point APP_DATABASE_URL at the local docker Postgres.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from '../../config.js';
import { logger } from '../../logger.js';
import * as schema from './schema.js';

let pool: Pool | null = null;
let db: NodePgDatabase<typeof schema> | null = null;

export function getAppDb(): NodePgDatabase<typeof schema> {
  if (db) return db;
  pool = new Pool({ connectionString: config.appDb.url, max: config.appDb.poolMax });
  pool.on('error', (err) => logger.error({ err }, 'app-db idle client error'));
  db = drizzle(pool, { schema });
  return db;
}

export async function closeAppDb(): Promise<void> {
  await pool?.end();
  pool = null;
  db = null;
}

export { schema };
