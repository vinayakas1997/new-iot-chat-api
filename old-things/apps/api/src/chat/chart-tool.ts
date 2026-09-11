/**
 * Rows → ChartData mapper + server-side chart builder for chat answers.
 *
 * Concept reference (DB-GPT, ported heuristics — not runtime):
 *  - packages/dbgpt-app/src/dbgpt_app/scene/chat_dashboard/data_loader.py
 *    (DashboardDataLoader: first string/datetime column → x-axis, numeric
 *    columns → series, pure-numeric table → sum() per column)
 *  - packages/dbgpt-core/src/dbgpt/agent/expand/actions/chart_action.py
 *    (ChartAction: SqlInput → query_to_df → VisChart.display)
 *  - packages/dbgpt-app/src/dbgpt_app/scene/chat_dashboard/chat.py
 *    (ChatDashboard.do_action → ChartData{chart_uid,chart_name,chart_type,...})
 * See new-plan/04-part2-chat-graphs.md §2 Tool C.
 */
import { randomUUID } from 'node:crypto';
import { ChartData, type ChartType } from '@app/shared';
import { getMachineDb } from '../db/machine-db.js';
import { logger } from '../logger.js';
import { CHAT_SQL_MAX_ROWS, assertReadOnly } from './verify-sql.js';

type Row = Record<string, unknown>;

const isNumeric = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Map arbitrary result rows to a ChartData of the requested type. */
export function rowsToChart(opts: {
  chartName: string;
  chartType: ChartType;
  sql?: string;
  desc?: string;
  rows: Row[];
}): ChartData {
  const { chartName, chartType, sql, desc, rows } = opts;
  const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];

  if (chartType === 'IndicatorValue') {
    const first = rows[0] ?? {};
    const numericKey = columns.find((c) => isNumeric(first[c])) ?? columns[0] ?? 'value';
    return ChartData.parse({
      chart_uid: randomUUID(),
      chart_name: chartName,
      chart_type: chartType,
      chart_desc: desc,
      chart_sql: sql,
      column_name: [numericKey],
      values: [{ name: numericKey, type: 'number', value: first[numericKey] ?? null }],
    });
  }

  if (chartType === 'PieChart') {
    const labelKey = columns.find((c) => !isNumeric((rows[0] ?? {})[c])) ?? columns[0] ?? 'label';
    const valueKey = columns.find((c) => isNumeric((rows[0] ?? {})[c])) ?? columns[1] ?? 'value';
    return ChartData.parse({
      chart_uid: randomUUID(),
      chart_name: chartName,
      chart_type: chartType,
      chart_desc: desc,
      chart_sql: sql,
      column_name: [labelKey, valueKey],
      values: rows.slice(0, 6).map((r) => ({
        name: String(r[labelKey] ?? ''),
        type: 'number',
        value: r[valueKey] ?? null,
      })),
    });
  }

  // Table / LineChart / BarChart share the column-major {name,type,value} encoding:
  // one ChartValue per cell so the UI can pivot by column_name.
  return ChartData.parse({
    chart_uid: randomUUID(),
    chart_name: chartName,
    chart_type: chartType,
    chart_desc: desc,
    chart_sql: sql,
    column_name: columns,
    values: rows.slice(0, 50).flatMap((r) =>
      columns.map((c) => ({ name: c, type: typeof r[c], value: r[c] ?? null })),
    ),
  });
}

const WANTS_CHART = /(chart|graph|plot|trend|compare|comparison|last \d+ (day|hour)|7[ -]?day|oee|downtime|scrap|shift)/i;

export function wantsChart(question: string): boolean {
  return WANTS_CHART.test(question);
}

function pickType(question: string): { type: ChartType; name: string } {
  const q = question.toLowerCase();
  if (/shift.*(compar|vs|1.*2)|compar/.test(q)) return { type: 'BarChart', name: 'Shift comparison' };
  if (/share|composition|breakdown by|pie/.test(q)) return { type: 'PieChart', name: 'Composition' };
  if (/table|list|top|raw/.test(q)) return { type: 'Table', name: 'Details' };
  if (/yesterday|today|headline|current|right now|single/.test(q) && !/trend|7|week|last \d/.test(q)) {
    return { type: 'IndicatorValue', name: 'Headline' };
  }
  return { type: 'LineChart', name: 'Trend' };
}

/** Hourly-breakdown SQL shape the MockMachineDb recognises (and valid live SQL). */
function trendSql(lineId: string): string {
  return (
    "SELECT line_id, date_trunc('hour', ts) AS hour, sum(units_produced) units_produced, " +
    'sum(units_scrapped) units_scrapped, avg(oee) avg_oee, sum(downtime_min) downtime_min ' +
    `FROM production_rows WHERE line_id = '${lineId}' GROUP BY 1,2 ORDER BY 2`
  );
}

/**
 * Deterministic server-side chart builder: runs after the summary streams, so
 * graphs work in mock mode too (no LLM cooperation needed). Returns [] on any
 * failure — a missing chart must never break the summary.
 */
export async function buildChartForQuestion(question: string, lineId = 'line-3'): Promise<ChartData[]> {
  if (!wantsChart(question)) return [];
  try {
    const { type, name } = pickType(question);
    const sql = assertReadOnly(trendSql(lineId));
    const res = await getMachineDb().executeQuery(sql);
    const rows = (res.rows as Row[]).slice(0, CHAT_SQL_MAX_ROWS);
    if (!rows.length) return [];
    return [rowsToChart({ chartName: name, chartType: type, sql, rows })];
  } catch (err) {
    logger.warn({ err }, 'buildChartForQuestion failed, returning no charts');
    return [];
  }
}
