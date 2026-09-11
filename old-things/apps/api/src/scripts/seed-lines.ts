/**
 * Seed the master lines registry. Idempotent — existing names are skipped.
 *
 *   pnpm --filter @app/api seed:lines
 *   pnpm --filter @app/api seed:lines -- --names line-1,line-2,line-3
 */
import { closeAppDb, getAppDb } from '../db/app/client.js';
import { lines } from '../db/app/schema.js';
import { logger } from '../logger.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const names = (arg('names') ?? 'line-1,line-2,line-3')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const db = getAppDb();
  for (const [i, name] of names.entries()) {
    await db.insert(lines).values({ name, sortOrder: i }).onConflictDoNothing({ target: lines.name });
  }
  logger.info({ names }, 'lines seeded');
  await closeAppDb();
}

main().catch((err) => {
  logger.error({ err }, 'seed:lines failed');
  process.exit(1);
});
