/**
 * Tools the chat model may call:
 *   - recall_memory : semantic/graph/temporal recall from the line's Hindsight bank
 *   - live_sql      : read-only "right now" numbers straight from the plant DB
 *                     (the §5.6 live-SQL fallback; MCP-equivalent, called directly)
 *
 * live_sql is guarded: SELECT-only, single statement, hard row cap. In mock mode
 * it routes to the fixture MachineDb which only understands a few query shapes.
 */
import type { LlmTool } from '../llm/index.js';
import { getMachineDb } from '../db/machine-db.js';
import { getHindsight } from '../hindsight/index.js';

const MAX_ROWS = 200;

function assertReadOnly(sql: string) {
  const s = sql.trim().replace(/;+\s*$/, '');
  if (/;/.test(s)) throw new Error('only a single statement is allowed');
  if (!/^(select|with)\b/i.test(s)) throw new Error('only SELECT / WITH queries are allowed');
  if (/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy)\b/i.test(s))
    throw new Error('write/DDL keywords are not allowed');
  return s;
}

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
        },
      },
      execute: async (input) => {
        const sql = assertReadOnly(String(input.sql));
        const res = await machineDb.executeQuery(sql);
        const rows = res.rows.slice(0, MAX_ROWS);
        return JSON.stringify({ rowCount: res.rowCount, rows }, null, 2);
      },
    },
  ];
}
