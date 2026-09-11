/**
 * Chart contract — port of DB-GPT's ReportData schema into TypeScript.
 * See new-plan/04-part2-chat-graphs.md §1 and new-plan/06-dbgpt-reference.md §D.
 *
 * DB-GPT sources (concept reference, not runtime):
 *  - packages/dbgpt-app/src/dbgpt_app/scene/chat_dashboard/data_preparation/report_schma.py
 *    (ValueItem{name,type,value}, ChartData{chart_uid,chart_name,chart_type,chart_desc,
 *    chart_sql,column_name,values}, ReportData{conv_uid,template_name,charts})
 *  - packages/dbgpt-app/src/dbgpt_app/scene/chat_dashboard/template/report/dashboard.json
 *    (supported_chart_type: Table, LineChart, BarChart, PieChart, IndicatorValue)
 *  - web/types/chat.ts (frontend ChartData mirror)
 *
 * Field names are kept 1:1 (snake_case) so future DB-GPT template reuse stays trivial.
 * v1 renders: Table, LineChart, BarChart, PieChart, IndicatorValue (per 08-open-decisions #6).
 */
import { z } from 'zod';

export const CHART_SCHEMA_VERSION = 1 as const;

export const ChartType = z.enum(['Table', 'LineChart', 'BarChart', 'PieChart', 'IndicatorValue']);
export type ChartType = z.infer<typeof ChartType>;

export const ChartValue = z.object({
  name: z.string().min(1),
  type: z.string().optional(),
  value: z.unknown(),
});
export type ChartValue = z.infer<typeof ChartValue>;

export const ChartData = z.object({
  schemaVersion: z.literal(CHART_SCHEMA_VERSION).default(CHART_SCHEMA_VERSION),
  chart_uid: z.string().min(1),
  chart_name: z.string().min(1),
  chart_type: ChartType,
  chart_desc: z.string().optional(),
  chart_sql: z.string().optional(),
  column_name: z.array(z.string()).default([]),
  values: z.array(ChartValue).default([]),
});
export type ChartData = z.infer<typeof ChartData>;

/** Tool-call result source tag shown in the UI sources tray. */
export const AnswerSource = z.object({
  tool: z.enum(['recall_memory', 'text_to_sql', 'chart_spec']),
  detail: z.string().optional(),
});
export type AnswerSource = z.infer<typeof AnswerSource>;

/**
 * The fresh chat/report answer envelope (breaks the old text/plain contract —
 * safe because this is a fresh build, see 08-open-decisions.md #5).
 * `summary` streams as tokens; `charts` + `sources` arrive as the final block.
 *
 * Multi-line chats return SEPARATE answers per line (`lines[]`); `summary` is a
 * short combined lead, `charts` the union for backwards-compatible renderers.
 */
export const LineAnswer = z.object({
  lineId: z.string().min(1),
  summary: z.string(),
  charts: z.array(ChartData).default([]),
  sources: z.array(AnswerSource).default([]),
});
export type LineAnswer = z.infer<typeof LineAnswer>;

export const ChatAnswer = z.object({
  summary: z.string(),
  charts: z.array(ChartData).default([]),
  sources: z.array(AnswerSource).default([]),
  lines: z.array(LineAnswer).default([]),
});
export type ChatAnswer = z.infer<typeof ChatAnswer>;

/** Wire form of POST /chat streaming: text chunks then a final JSON chunk. */
export const ChatChunk = z.union([
  z.object({ type: z.literal('text'), delta: z.string() }),
  z.object({ type: z.literal('final'), answer: ChatAnswer }),
]);
export type ChatChunk = z.infer<typeof ChatChunk>;
