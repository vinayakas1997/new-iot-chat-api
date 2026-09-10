/**
 * §5.3 CONTEXT BUILDER — STUB (build-later).
 *
 * Groups raw rows into one structured, metadata-enriched unit PER GRANULARITY.
 * The `granularity` tag set here must survive through fact extraction into the
 * stored fact (see fact-schema TimeScope). Real version will do line-hierarchy
 * enrichment and oversize chunking.
 */
import type { Granularity } from '@app/shared';
import type { ProductionRow } from '../sql/row-types.js';

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
 * Daily summary — one ContextUnit per (line, date). NOTE (open decision #3):
 * this stub DERIVES daily from the same rows (sum of hourly). Keep it that way
 * until the team decides whether daily is queried independently.
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

export function buildAllUnits(rows: ProductionRow[]): ContextUnit[] {
  return [...buildHourlyUnits(rows), ...buildDailyUnits(rows)];
}
