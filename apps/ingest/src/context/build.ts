/**
 * Context builder — one structured, metadata-enriched unit PER GRANULARITY.
 *
 * Groups raw rows into hourly / shift / daily units. The `granularity` tag set
 * here must survive through fact extraction into the stored fact (see
 * packages/shared fact-schema TimeScope). See new-plan/02-part1-ingestion.md §3
 * and new-plan/03-granularity-matrix.md.
 */
import type { Granularity } from '@app/shared';
import type { ProductionRow } from '../sql/row-types.js';
import { shiftForTimestamp } from './shift.js';

export interface ContextUnit {
  lineId: string;
  granularity: Granularity;
  /** ISO window. */
  windowStart: string;
  windowEnd: string;
  rowIds: number[];
  /** Human-readable block the extractor reads. */
  text: string;
}

function fmt(n: number, d = 1) {
  return Number.isInteger(n) ? String(n) : n.toFixed(d);
}

/** Hourly units — one ContextUnit per (line, hour). */
export function buildHourlyUnits(rows: ProductionRow[]): ContextUnit[] {
  const byKey = new Map<string, ProductionRow[]>();
  for (const r of rows) {
    const hour = r.ts.slice(0, 13) + ':00:00.000Z';
    const key = `${r.line_id}|${hour}`;
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(r);
  }

  const units: ContextUnit[] = [];
  for (const [key, group] of byKey) {
    const [lineId, hour] = key.split('|');
    const produced = group.reduce((a, r) => a + r.units_produced, 0);
    const scrapped = group.reduce((a, r) => a + r.units_scrapped, 0);
    const downtime = group.reduce((a, r) => a + r.downtime_min, 0);
    const avgOee = group.reduce((a, r) => a + r.oee, 0) / group.length;
    const end = new Date(new Date(hour!).getTime() + 3600_000).toISOString();
    const scrapRate = produced ? scrapped / (produced + scrapped) : 0;
    units.push({
      lineId: lineId!,
      granularity: 'hourly',
      windowStart: hour!,
      windowEnd: end,
      rowIds: group.map((r) => r.id),
      text:
        `Line ${lineId}, hour starting ${hour}: produced ${produced} units, scrapped ${scrapped} ` +
        `(scrap rate ${fmt(scrapRate * 100)}%), average OEE ${fmt(avgOee * 100)}%, ` +
        `downtime ${fmt(downtime)} min across ${group.length} machine-record(s).`,
    });
  }
  return units;
}

/**
 * Daily summary — one ContextUnit per (line, date). Per new-plan/03 decision #3
 * daily is INDEPENDENTLY queried in live mode (see fetchDailySummary); this
 * builder shapes whichever daily rows it receives and must not be assumed to be
 * a sum of the hourly units.
 */
export function buildDailyUnits(rows: ProductionRow[]): ContextUnit[] {
  const byKey = new Map<string, ProductionRow[]>();
  for (const r of rows) {
    const date = r.ts.slice(0, 10);
    const key = `${r.line_id}|${date}`;
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(r);
  }

  const units: ContextUnit[] = [];
  for (const [key, group] of byKey) {
    const [lineId, date] = key.split('|');
    const produced = group.reduce((a, r) => a + r.units_produced, 0);
    const scrapped = group.reduce((a, r) => a + r.units_scrapped, 0);
    const downtime = group.reduce((a, r) => a + r.downtime_min, 0);
    const avgOee = group.reduce((a, r) => a + r.oee, 0) / group.length;
    const scrapRate = produced ? scrapped / (produced + scrapped) : 0;
    units.push({
      lineId: lineId!,
      granularity: 'daily',
      windowStart: `${date}T00:00:00.000Z`,
      windowEnd: `${date}T23:59:59.999Z`,
      rowIds: group.map((r) => r.id),
      text:
        `Line ${lineId}, ${date} (daily total): produced ${produced} units, scrapped ${scrapped} ` +
        `(scrap rate ${fmt(scrapRate * 100)}%), average OEE ${fmt(avgOee * 100)}%, ` +
        `total downtime ${fmt(downtime)} min.`,
    });
  }
  return units;
}

export function buildShiftUnits(rows: ProductionRow[]): ContextUnit[] {
  const byKey = new Map<string, { shift: string; group: ProductionRow[] }>();
  for (const r of rows) {
    const date = r.ts.slice(0, 10);
    const shift = shiftForTimestamp(r.ts).name;
    const key = `${r.line_id}|${date}|${shift}`;
    const slot = byKey.get(key) ?? { shift, group: [] as ProductionRow[] };
    slot.group.push(r);
    byKey.set(key, slot);
  }

  const units: ContextUnit[] = [];
  for (const [key, { shift, group }] of byKey) {
    const [lineId, date] = key.split('|');
    const produced = group.reduce((a, r) => a + r.units_produced, 0);
    const scrapped = group.reduce((a, r) => a + r.units_scrapped, 0);
    const downtime = group.reduce((a, r) => a + r.downtime_min, 0);
    const avgOee = group.reduce((a, r) => a + r.oee, 0) / group.length;
    const scrapRate = produced ? scrapped / (produced + scrapped) : 0;
    units.push({
      lineId: lineId!,
      granularity: 'shift',
      windowStart: `${date}T00:00:00.000Z`,
      windowEnd: `${date}T23:59:59.999Z`,
      rowIds: group.map((r) => r.id),
      text:
        `Line ${lineId}, ${date} shift ${shift}: produced ${produced} units, scrapped ${scrapped} ` +
        `(scrap rate ${fmt(scrapRate * 100)}%), average OEE ${fmt(avgOee * 100)}%, ` +
        `total downtime ${fmt(downtime)} min across ${group.length} machine-record(s).`,
    });
  }
  return units;
}

export function buildAllUnits(rows: ProductionRow[]): ContextUnit[] {
  return [...buildHourlyUnits(rows), ...buildShiftUnits(rows), ...buildDailyUnits(rows)];
}
