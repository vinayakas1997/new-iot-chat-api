/**
 * SQL query set (see new-plan/02-part1-ingestion.md §2, new-plan/03-granularity-matrix.md).
 *
 * Mock mode calls the fixture MachineDb with shapes it recognises; live mode runs
 * the same SQL against the real plant Postgres. Daily is INDEPENDENTLY queried
 * (decision #3) — never derived as sum-of-hourly.
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

export async function fetchDailySummary(lineId: string, dateIso: string): Promise<HourlyRow[]> {
  const db = getMachineDb();
  const res = await db.executeQuery<HourlyRow>(
    'SELECT line_id, ts::date AS hour, sum(units_produced) units_produced, ' +
      'sum(units_scrapped) units_scrapped, avg(oee) avg_oee, sum(downtime_min) downtime_min ' +
      'FROM production_rows WHERE line_id = $1 AND ts::date = $2 GROUP BY 1,2 ORDER BY 2',
    [lineId, dateIso],
  );
  return res.rows;
}

export async function fetchShiftAggregates(lineId: string, dateIso: string): Promise<HourlyRow[]> {
  const db = getMachineDb();
  const res = await db.executeQuery<HourlyRow>(
    'SELECT line_id, date_trunc(\'hour\', ts) AS hour, sum(units_produced) units_produced, ' +
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
