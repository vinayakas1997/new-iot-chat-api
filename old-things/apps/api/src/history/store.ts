import type { HistorySource } from '@app/shared';
import { and, desc, eq, gte, lt } from 'drizzle-orm';
import { getAppDb } from '../db/app/client.js';
import { history } from '../db/app/schema.js';
import { logger } from '../logger.js';

export interface WriteHistoryInput {
  userId: string;
  source: HistorySource;
  question: string;
  answer: string;
  scheduleId: string | null;
  meta?: Record<string, unknown>;
}

export async function writeHistory(input: WriteHistoryInput): Promise<void> {
  try {
    await getAppDb()
      .insert(history)
      .values({
        userId: input.userId,
        source: input.source,
        question: input.question,
        answer: input.answer,
        scheduleId: input.scheduleId,
        meta: input.meta ?? {},
      });
  } catch (err) {
    logger.error({ err }, 'writeHistory failed');
  }
}

export async function historyForRange(userId: string, fromIso: string, toIso: string, line?: string) {
  const rows = await getAppDb()
    .select()
    .from(history)
    .where(
      and(
        eq(history.userId, userId),
        gte(history.createdAt, new Date(fromIso)),
        lt(history.createdAt, new Date(toIso)),
      ),
    )
    .orderBy(desc(history.createdAt));
  // Surface persisted charts/lines (stored in meta JSONB by chat/report writers).
  const mapped = rows.map((r) => {
    const meta = (r.meta ?? {}) as Record<string, unknown>;
    return {
      ...r,
      charts: Array.isArray(meta['charts']) ? (meta['charts'] as unknown[]) : [],
      lineIds: Array.isArray(meta['lineIds']) ? (meta['lineIds'] as string[]) : [],
    };
  });
  // Optional line filter: rows recorded before line-scoping carry no lineIds and
  // are excluded when a filter is active (they predate the dimension).
  if (line) return mapped.filter((r) => r.lineIds.includes(line));
  return mapped;
}

/** Distinct YYYY-MM-DD strings that have at least one entry, for the calendar dots. */
export async function historyDays(userId: string): Promise<string[]> {
  const rows = await getAppDb()
    .select({ createdAt: history.createdAt })
    .from(history)
    .where(eq(history.userId, userId));
  return [...new Set(rows.map((r) => r.createdAt.toISOString().slice(0, 10)))].sort();
}
