/**
 * Text-to-SQL prompt fragment (strict-JSON instruction).
 *
 * Concept reference (DB-GPT, ported wording — not runtime):
 *  - packages/dbgpt-app/src/dbgpt_app/scene/chat_db/auto_execute/prompt.py
 *    (prompt vars {db_name, table_info, dialect, top_k, display_type} +
 *    strict JSON output instruction {thoughts, sql, display_type})
 *  - packages/dbgpt-app/src/dbgpt_app/scene/chat_dashboard/prompt.py
 *    (≤4 columns, supported_chart_type constraint)
 * See new-plan/04-part2-chat-graphs.md §2 Tool B/C.
 */
import { getTableInfo } from '../db/schema-summary.js';

export const SUPPORTED_DISPLAY_TYPES = ['Table', 'LineChart', 'BarChart', 'PieChart', 'IndicatorValue'] as const;

export function textToSqlGuidance(bankId: string): string {
  return [
    `Memory bank = ${bankId}. Tables:`,
    getTableInfo(),
    '',
    'When you need fresh or computed numbers, call `live_sql` with a single SELECT.',
    'Rules for the SQL you pass:',
    '- Query production_rows / events only. Filter line_id from the question (default line-3).',
    '- One statement, SELECT/WITH only, no trailing semicolon, max 200 rows.',
    '- Prefer date_trunc buckets for trends, GROUP BY shift/hour for comparisons.',
    'When the answer deserves a picture, also pass `display_type` (one of:',
    `${SUPPORTED_DISPLAY_TYPES.join(', ')}): trends → LineChart, shift compare → BarChart,`,
    'single headline → IndicatorValue, raw lists → Table, composition → PieChart.',
  ].join('\n');
}
