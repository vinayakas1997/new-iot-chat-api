/**
 * Schema summary injected into the Text-to-SQL prompt so the model never
 * invents table/column names.
 *
 * Concept reference (DB-GPT, ported idea — not runtime):
 *  - packages/dbgpt-serve/src/dbgpt_serve/datasource/service/db_summary_client.py
 *    + service.py (`get_db_summary` feeding `{table_info}` into the prompt)
 * See new-plan/04-part2-chat-graphs.md §2 Tool B.
 *
 * v1 is a static description of the known plant tables (fixture == live shape).
 * A future version may introspect `information_schema` in live mode; the prompt
 * contract (`table_info` string) stays the same.
 */

export const PLANT_TABLE_INFO = [
  'Table production_rows(id, line_id, machine_id, ts timestamptz, units_produced int,',
  '  units_scrapped int, runtime_min int, downtime_min int, oee float 0..1, status text).',
  '  One row per machine per reporting tick. status in (new, pending, ingested).',
  'Table events(id, line_id, machine_id, ts timestamptz, kind text, severity text,',
  '  duration_min float nullable). kind in',
  "  (downtime, alarm, maintenance, changeover, quality, other).",
  'Metric names for facts/charts: oee (avg, ratio), downtime_min (sum, min),',
  '  scrap_rate (scrapped/(produced+scrapped), ratio), units_produced (sum),',
  '  units_scrapped (sum), runtime_min (sum).',
  "Default line in this deployment: line-3 (bankId 'line:line-3').",
].join('\n');

export function getTableInfo(): string {
  return PLANT_TABLE_INFO;
}
