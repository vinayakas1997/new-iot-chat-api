/**
 * Applies generated SQL migrations to the app store.
 * Run `pnpm --filter @app/api db:generate` first to (re)generate them from schema.ts.
 */
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeAppDb, getAppDb } from './client.js';
import { logger } from '../../logger.js';

async function main() {
  const db = getAppDb();
  const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));
  await migrate(db, { migrationsFolder });
  logger.info('app-db migrations applied');
  await closeAppDb();
}

main().catch((err) => {
  logger.error({ err }, 'migration failed');
  process.exit(1);
});
