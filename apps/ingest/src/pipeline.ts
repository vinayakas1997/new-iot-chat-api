/**
 * The combined Job 1 + Job 2 pipeline (plan.md §3):
 *   fetch new rows -> mark 'pending' -> build context units (per granularity)
 *   -> extract facts -> RETAIN to Hindsight -> only then mark rows 'ingested'.
 *
 * Order matters: write to the store BEFORE flipping the flag, never the reverse.
 */
import { getBankId, getHindsight } from '@app/api/hindsight';
import { logger } from '@app/api/logger';
import { newCheckpoint } from './checkpoint.js';
import { buildAllUnits } from './context/build.js';
import { extractFacts } from './extract/extract.js';
import {
  fetchNewRowsSince,
  markRowsAsIngested,
  markRowsAsPicked,
} from './sql/queries.js';

export interface IngestSummary {
  rowsPicked: number;
  unitsBuilt: number;
  factsRetained: number;
  rowsIngested: number;
  pendingAfter: number;
}

export async function runPipeline(): Promise<IngestSummary> {
  const hindsight = getHindsight();
  const checkpoint = newCheckpoint();

  const rows = await fetchNewRowsSince(null);
  if (rows.length === 0) {
    logger.info('ingest: no new rows');
    return { rowsPicked: 0, unitsBuilt: 0, factsRetained: 0, rowsIngested: 0, pendingAfter: 0 };
  }

  // 1. claim the rows
  await markRowsAsPicked(rows.map((r) => r.id));

  // 2. context units, grouped by line so we retain into the right bank
  const units = buildAllUnits(rows);
  const byLine = new Map<string, typeof units>();
  for (const u of units) (byLine.get(u.lineId) ?? byLine.set(u.lineId, []).get(u.lineId)!).push(u);

  let factsRetained = 0;
  const ingestedRowIds = new Set<number>();

  for (const [lineId, lineUnits] of byLine) {
    const bankId = getBankId({ lineId });
    for (const unit of lineUnits) {
      const facts = await extractFacts(unit, checkpoint);
      if (facts.length === 0) continue;
      // 3. RETAIN first — must resolve before we flip any flag
      const { retained } = await hindsight.retain(bankId, facts);
      factsRetained += retained;
      unit.rowIds.forEach((id) => ingestedRowIds.add(id));
    }
  }

  // 4. only now mark the successfully-retained rows as ingested
  await markRowsAsIngested([...ingestedRowIds]);

  const pendingAfter = rows.length - ingestedRowIds.size;
  logger.info(
    { rowsPicked: rows.length, factsRetained, rowsIngested: ingestedRowIds.size, pendingAfter },
    'ingest pipeline complete',
  );
  return {
    rowsPicked: rows.length,
    unitsBuilt: units.length,
    factsRetained,
    rowsIngested: ingestedRowIds.size,
    pendingAfter,
  };
}
