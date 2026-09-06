/**
 * §5.2 SQL QUERY SET — STUB (build-later).
 *
 * The real versions run parameterised SQL through @app/api/db/machine. For now
 * they call the MachineDb with query shapes the MockMachineDb recognises, so the
 * pipeline is exercised end to end. When the calc layer lands, replace the SQL
 * strings here — nothing downstream changes.
 */
import { getMachineDb } from '@app/api/db/machine';
import type { ProductionRow, HourlyRow } from './row-types.js';

export async function fetchNewRowsSince(_lastCheckpoint: string | null): Promise<ProductionRow[]> {
  const db = getMachineDb();
  const res = await db.executeQuery<ProductionRow>(
    "SELECT * FROM production_rows WHERE status = 'new' ORDER BY ts LIMIT 500",
  );
  return res.rows;
}

export async function fetchHourlyBreakdown(lineId: string, dateIso: string): Promise<HourlyRow[]> {
  const db = getMachineDb();
  const res = await db.executeQuery<HourlyRow>(
    "SELECT line_id, date_trunc('hour', ts) AS hour, sum(units_produced) units_produced, " +
      'sum(units_scrapped) units_scrapped, avg(oee) avg_oee, sum(downtime_min) downtime_min ' +
      'FROM production_rows WHERE line_id = $1 AND ts::date = $2 GROUP BY 1,2 ORDER BY 2',
    [lineId, dateIso],
  );
  return res.rows;
}

export async function markRowsAsPicked(rowIds: number[]): Promise<void> {
  if (!rowIds.length) return;
  const db = getMachineDb();
  await db.executeQuery("UPDATE production_rows SET status = 'pending' WHERE id = ANY($1)", [rowIds]);
}

export async function markRowsAsIngested(rowIds: number[]): Promise<void> {
  if (!rowIds.length) return;
  const db = getMachineDb();
  await db.executeQuery("UPDATE production_rows SET status = 'ingested' WHERE id = ANY($1)", [rowIds]);
}
