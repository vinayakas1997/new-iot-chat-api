/**
 * Tools the chat model may call:
 *   - recall_memory : semantic/graph/temporal recall from the line's Hindsight bank
 *   - live_sql      : read-only "right now" numbers straight from the plant DB
 *                     (the live-SQL fallback; MCP-equivalent, called directly)
 *   - chart_spec    : run a verified SELECT and return a ChartData spec for graphs
 *
 * live_sql / chart_spec share the verify-sql guard: SELECT-only, single statement,
 * hard row cap. chart_spec maps rows → ChartData with the DB-GPT DashboardDataLoader
 * heuristics (see ../chat/chart-tool.ts).
 */
import type { LlmTool } from '../llm/index.js';
import { getMachineDb } from '../db/machine-db.js';
import { getHindsight } from '../hindsight/index.js';
import { CHAT_SQL_MAX_ROWS, assertReadOnly } from './verify-sql.js';
import { rowsToChart } from './chart-tool.js';
import { SUPPORTED_DISPLAY_TYPES } from './sql-prompt.js';
import type { ChartType } from '@app/shared';

export function buildChatTools(bankId: string): LlmTool[] {
  const hindsight = getHindsight();
  const machineDb = getMachineDb();

  return [
    {
      name: 'recall_memory',
      description:
        'Recall stored facts about the production line (OEE, downtime, throughput, events, thresholds) from long-term memory. Use for anything not strictly "at this second".',
      parameters: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', description: 'what to recall' },
          granularity: {
            type: 'string',
            enum: ['instant', 'hourly', 'shift', 'daily'],
            description: 'optional time-scope filter',
          },
        },
      },
      execute: async (input) => {
        const r = await hindsight.recall(bankId, String(input.query), {
          budget: 'high',
          granularity: input.granularity ? String(input.granularity) : undefined,
        });
        if (!r.facts.length) return 'No matching memories.';
        return r.facts.map((f) => `- (${f.score}) ${f.statement} [${f.granularity}]`).join('\n');
      },
    },
    {
      name: 'live_sql',
      description:
        'Run ONE read-only SELECT against the live plant database for a value too fresh to be in memory. Returns up to 200 rows as JSON.',
      parameters: {
        type: 'object',
        required: ['sql'],
        properties: {
          sql: { type: 'string', description: 'a single SELECT statement' },
          display_type: {
            type: 'string',
            enum: [...SUPPORTED_DISPLAY_TYPES],
            description: 'hint for how the result should be visualised',
          },
        },
      },
      execute: async (input) => {
        const sql = assertReadOnly(String(input.sql));
        const res = await machineDb.executeQuery(sql);
        const rows = res.rows.slice(0, CHAT_SQL_MAX_ROWS);
        return JSON.stringify({ rowCount: res.rowCount, rows }, null, 2);
      },
    },
    {
      name: 'chart_spec',
      description:
        'Run ONE verified read-only SELECT and return the result as a chart spec (ChartData JSON). Use when the user asks for a chart, trend, or comparison.',
      parameters: {
        type: 'object',
        required: ['sql'],
        properties: {
          sql: { type: 'string', description: 'a single SELECT statement' },
          display_type: {
            type: 'string',
            enum: [...SUPPORTED_DISPLAY_TYPES],
            description: 'chart type to produce',
          },
          chart_name: { type: 'string', description: 'human title for the chart' },
        },
      },
      execute: async (input) => {
        const sql = assertReadOnly(String(input.sql));
        const chartType = (SUPPORTED_DISPLAY_TYPES as readonly string[]).includes(String(input.display_type))
          ? (String(input.display_type) as ChartType)
          : ('LineChart' as ChartType);
        const res = await machineDb.executeQuery(sql);
        const rows = res.rows.slice(0, CHAT_SQL_MAX_ROWS) as Record<string, unknown>[];
        const spec = rowsToChart({
          chartName: input.chart_name ? String(input.chart_name) : 'Chart',
          chartType,
          sql,
          rows,
        });
        return JSON.stringify(spec);
      },
    },
  ];
}
