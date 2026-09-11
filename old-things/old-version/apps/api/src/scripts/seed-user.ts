/**
 * Create a user account. This is the ONLY way accounts are made — there is no
 * signup form and no email (by design, see implementation-plan.md §5).
 *
 *   pnpm --filter @app/api seed:user -- --username alice --password 's3cret'
 *
 * If --password is omitted a random one is generated and printed once.
 */
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { closeAppDb, getAppDb } from '../db/app/client.js';
import { themes, users } from '../db/app/schema.js';
import { logger } from '../logger.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const username = arg('username');
  if (!username) {
    // eslint-disable-next-line no-console
    console.error('usage: seed:user -- --username <name> [--password <pw>]');
    process.exit(1);
  }
  const password = arg('password') ?? randomBytes(9).toString('base64url');
  const generated = !arg('password');

  const db = getAppDb();
  const existing = await db.select().from(users).where(eq(users.username, username)).limit(1);
  if (existing.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`user "${username}" already exists`);
    process.exit(1);
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const [row] = await db.insert(users).values({ username, passwordHash }).returning();
  await db.insert(themes).values({ userId: row!.id }).onConflictDoNothing();

  logger.info({ userId: row!.id, username }, 'user created');
  // eslint-disable-next-line no-console
  if (generated) console.log(`generated password for "${username}": ${password}`);

  await closeAppDb();
}

main().catch((err) => {
  logger.error({ err }, 'seed:user failed');
  process.exit(1);
});
