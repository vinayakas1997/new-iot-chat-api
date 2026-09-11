/**
 * evaluate_condition (§5.7) — PURE logic, no LLM. Given recalled facts and a
 * threshold set, decide whether today's report should flag a problem.
 *
 * Thresholds are hard-coded defaults for now; a later iteration reads them from
 * the `threshold` entities stored in Hindsight.
 */
import type { RecalledFact } from '../hindsight/port.js';

export interface Thresholds {
  minOee: number;
  maxDowntimeMin: number;
  maxScrapRate: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  minOee: 0.75,
  maxDowntimeMin: 30,
  maxScrapRate: 0.05,
};

export interface ConditionResult {
  status: 'condition_met' | 'condition_not_met';
  breaches: string[];
  observations: { oee?: number; downtimeMin?: number; scrapRate?: number };
}

const num = (re: RegExp, s: string): number | undefined => {
  const m = re.exec(s);
  return m ? Number(m[1]) : undefined;
};

export function evaluateCondition(
  facts: RecalledFact[],
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): ConditionResult {
  const text = facts.map((f) => f.statement).join(' \n ');

  const oeePct = num(/\boee[^0-9]{0,12}(\d{1,3}(?:\.\d+)?)\s*%/i, text);
  const oee = oeePct !== undefined ? oeePct / 100 : num(/\boee[^0-9]{0,12}(0?\.\d+)\b/i, text);
  const downtimeMin = num(/downtime[^0-9]{0,12}(\d+(?:\.\d+)?)\s*min/i, text);
  const scrapRate =
    num(/scrap rate[^0-9]{0,12}(0?\.\d+)/i, text) ??
    (() => {
      const pct = num(/scrap[^0-9]{0,12}(\d{1,2}(?:\.\d+)?)\s*%/i, text);
      return pct !== undefined ? pct / 100 : undefined;
    })();

  const breaches: string[] = [];
  if (oee !== undefined && oee < thresholds.minOee)
    breaches.push(`OEE ${(oee * 100).toFixed(1)}% is below the ${(thresholds.minOee * 100).toFixed(0)}% target`);
  if (downtimeMin !== undefined && downtimeMin > thresholds.maxDowntimeMin)
    breaches.push(`downtime ${downtimeMin} min exceeds the ${thresholds.maxDowntimeMin} min limit`);
  if (scrapRate !== undefined && scrapRate > thresholds.maxScrapRate)
    breaches.push(`scrap rate ${(scrapRate * 100).toFixed(1)}% exceeds ${(thresholds.maxScrapRate * 100).toFixed(0)}%`);

  return {
    status: breaches.length ? 'condition_met' : 'condition_not_met',
    breaches,
    observations: { oee, downtimeMin, scrapRate },
  };
}
