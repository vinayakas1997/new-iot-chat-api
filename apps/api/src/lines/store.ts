/**
 * Lines registry store — the master list of valid line names.
 * Backed by the dedicated `lines` table (never free text anywhere else).
 */
import { asc, eq } from 'drizzle-orm';
import { getAppDb } from '../db/app/client.js';
import { lines, type LineRow } from '../db/app/schema.js';
import type { LineEntry } from '@app/shared';

function toDto(r: LineRow): LineEntry {
  return {
    id: r.id,
    name: r.name,
    displayName: r.displayName ?? undefined,
    active: r.active,
    sortOrder: r.sortOrder,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listLines(activeOnly: boolean): Promise<LineEntry[]> {
  const db = getAppDb();
  const rows = activeOnly
    ? await db.select().from(lines).where(eq(lines.active, true)).orderBy(asc(lines.sortOrder), asc(lines.name))
    : await db.select().from(lines).orderBy(asc(lines.sortOrder), asc(lines.name));
  return rows.map(toDto);
}

/** Resolve scope: empty request = ALL active lines; otherwise intersect + report unknowns. */
export async function resolveLineScope(requested?: string[]): Promise<{
  lineIds: string[];
  unknown: string[];
  valid: string[];
}> {
  const active = await listLines(true);
  const activeNames = active.map((l) => l.name);
  if (!requested || requested.length === 0) return { lineIds: activeNames, unknown: [], valid: activeNames };
  const wanted = [...new Set(requested.map((s) => s.trim()).filter(Boolean))];
  const unknown = wanted.filter((w) => !activeNames.includes(w));
  return { lineIds: wanted.filter((w) => activeNames.includes(w)), unknown, valid: activeNames };
}

export async function createLine(input: { name: string; displayName?: string; sortOrder?: number }): Promise<LineEntry> {
  const [row] = await getAppDb()
    .insert(lines)
    .values({ name: input.name.trim(), displayName: input.displayName?.trim() || null, sortOrder: input.sortOrder ?? 0 })
    .returning();
  return toDto(row!);
}

export async function updateLine(
  id: string,
  patch: { displayName?: string | null; active?: boolean; sortOrder?: number },
): Promise<LineEntry | null> {
  const [row] = await getAppDb()
    .update(lines)
    .set({
      ...(patch.displayName !== undefined ? { displayName: patch.displayName?.trim() || null } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
    })
    .where(eq(lines.id, id))
    .returning();
  return row ? toDto(row) : null;
}

export async function deleteLine(id: string): Promise<boolean> {
  const rows = await getAppDb().delete(lines).where(eq(lines.id, id)).returning({ id: lines.id });
  return rows.length > 0;
}
