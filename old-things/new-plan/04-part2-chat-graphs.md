# 04 — Part 2: Chat + Graphs (where DB-GPT plays its role)

> Scope: everything AFTER ingestion. The user asks → we answer with summary + chart.
> DB-GPT concepts land here — ported to TypeScript, no Python runtime.

## 1. Answer contract (what the API returns — why an envelope?)

Old trail returned `text/plain` stream (prose only, graphs impossible).
Fresh contract — `POST /chat` returns/streams an **envelope**:

```ts
// packages/shared/src/chart-schema.ts (new, port of DB-GPT report_schma.py)
ChartType = 'Table' | 'LineChart' | 'BarChart' | 'PieChart' | 'IndicatorValue';
ChartValue = { name: string; type?: string; value: unknown };
ChartData = {
  chart_uid: string; chart_name: string; chart_type: ChartType;
  chart_desc?: string; chart_sql?: string;
  column_name: string[]; values: ChartValue[];
};
ChatAnswer = { summary: string; charts: ChartData[]; sources: { tool: string; detail?: string }[] };
```

- **Why:** one question can need prose ("downtime was caused by tool change") AND a
  picture ("here is the 7-day OEE trend"). A plain string cannot carry both reliably.
- **Streaming:** stream `summary` tokens live; emit `charts[]` + `sources[]` as a final
  JSON block. History stores the same envelope so History view renders graphs too.
- **Concept reference:** DB-GPT
  `packages/dbgpt-app/src/dbgpt_app/scene/chat_dashboard/data_preparation/report_schma.py`
  (`ValueItem{name,type,value}`, `ChartData{chart_uid,chart_name,chart_type,chart_desc,
  chart_sql,column_name,values}`, `ReportData{conv_uid,template_name,charts}`) and
  `template/report/dashboard.json` (`supported_chart_type: [Table, LineChart, BarChart,
  PieChart, IndicatorValue]`). **Explanation:** DB-GPT's dashboard agent always returns
  typed chart objects, never raw markdown tables — the frontend switches renderer by
  `chart_type`. We copy the **type names and field names** (renamed to camelCase where
  idiomatic) so the mapping is 1:1 and future DB-GPT templates stay compatible.

## 2. Tool loop (how the LLM decides what to call)

Vercel AI SDK `streamText({system, messages, tools, maxSteps:5})` with three tools
(bound per `bankId = "line:<id>"`):

### Tool A — `recall_memory({query, granularity?})` (summary path, always first)
- **What:** Hindsight `recall(bankId, query, {budget:'high', granularity?})` → format
  facts as `- (score) statement [granularity]` or `No matching memories.`
- **Why needed:** answers questions already ingested ("what was yesterday's OEE?",
  "why was line-3 down?"). This is the accuracy path — no SQL, no computation.
- **Where:** `apps/api/src/chat/tools.ts` + `apps/api/src/hindsight/recall.ts`.
- **Concept reference:** DB-GPT RAG chat
  `packages/dbgpt-app/src/dbgpt_app/scene/chat_knowledge/v1/chat.py|prompt.py` and
  retriever pipeline `packages/dbgpt-core/src/dbgpt/rag/retriever/{embedding,rerank,rewrite}.py`.
  **Explanation:** retrieve → (rewrite) → rerank → inject into prompt. We keep Hindsight
  as the retriever and port only the **prompt-injection shape** (scored bullet list).

### Tool B — `text_to_sql({question})` + `verify_sql` + `run_sql` (fresh/calculated path)
- **What:** NL → SQL → validated SQL → rows. Three steps, never one:
  1. `generate` — LLM with schema context returns strict JSON
     `{thoughts, sql, display_type}`.
  2. `verify` — TS validator: single statement, starts with `SELECT`/`WITH`, strips `;`,
     blocks `INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/TRUNCATE/GRANT/REVOKE/COPY`,
     `MAX_ROWS=200`, timeout enforced.
  3. `run` — `machineDb.executeQuery(sql)` → `{rowCount, rows}`.
- **Why needed:** "right now" or computed questions ("OEE trend last 7 days as a chart",
  "compare shift 1 vs 2 today") that ingestion hasn't pre-aggregated. Also feeds charts.
- **Where:** `apps/api/src/chat/{text-to-sql.ts, verify-sql.ts, tools.ts}`,
  schema context from `apps/api/src/db/schema-summary.ts`,
  prompt in `apps/api/src/chat/sql-prompt.ts`.
- **Concept reference (exact):**
  - Prompt: DB-GPT `packages/dbgpt-app/src/dbgpt_app/scene/chat_db/auto_execute/prompt.py`
    (vars `{db_name, table_info, dialect, top_k, display_type}`, strict JSON instruction).
    **Explanation:** constraining output to JSON with named fields eliminates prose
    around SQL and makes parsing deterministic.
  - Parser: `.../auto_execute/out_parser.py` (`DbChatOutputParser`: `sqlparse` check +
    `json.loads → SqlAction`) and DBA variant `.../professional_qa/out_parser.py`.
    **Explanation:** parse-then-validate-then-run; reject non-SQL before execution.
  - Validation example: `.../chat_data/chat_excel/excel_learning/verify_sql.py`
    (quote-fix + statement check). **Explanation:** last-mile syntax repair + safety gate.
  - Schema retrieval: `packages/dbgpt-serve/src/dbgpt_serve/datasource/service/db_summary_client.py`
    (`get_db_summary`). **Explanation:** prompt must contain live table/column list
    (`table_info`), else the LLM invents column names.
  - Declarative flow template: `packages/dbgpt-serve/src/dbgpt_serve/flow/templates/en/chat-data-awel-flow-template.json`.
    We do **not** run AWEL; the JSON is useful as documentation of the step order.

### Tool C — `chart_spec({sql, display_type, question})` (graph path)
- **What:** rows from Tool B → `ChartData` (column mapping + type selection).
  Heuristics ported from DB-GPT `data_loader.py`: first string/datetime column → x-axis,
  numeric columns → series (pure-numeric table → `sum()` per column); ≤4 columns, 4–8
  data points ideal for readability.
- **Why needed:** the user asked for graphs. The LLM picks `display_type`
  (LineChart for trends, BarChart for shift comparison, IndicatorValue for single
  headline, Table for raw lists, PieChart for composition), the UI renders it.
- **Where:** `apps/api/src/chat/chart-tool.ts` (+ `apps/api/src/report/run.ts` reuses it
  for scheduled reports).
- **Concept reference (exact):**
  - `packages/dbgpt-core/src/dbgpt/agent/expand/actions/chart_action.py` (`ChartAction`:
    `SqlInput → DBResource.query_to_df → VisChart.display`) and `dashboard_action.py`
    (multi-chart loop → `VisDashboard`). **Explanation:** single-chart vs dashboard are
    the same primitive run N times; our `charts[]` array mirrors `VisDashboard.charts`.
  - `packages/dbgpt-app/src/dbgpt_app/scene/chat_dashboard/chat.py`
    (`ChatDashboard.do_action → DashboardDataLoader.get_chart_values_by_conn`) +
    `data_loader.py` (field detection) + `prompt.py` (≤4 cols, `supported_chat_type`) +
    `out_parser.py` (`ChartItem{sql,title,thoughts,showcase}`). **Explanation:** prompt
    constrains shape first, loader fills values second — same split we use
    (`sql-prompt.ts` → `chart-tool.ts`).
  - Vis tags `packages/dbgpt-core/src/dbgpt/vis/tags/vis_chart.py` (`vis-db-chart`) and
    `vis_dashboard.py` (`vis-dashboard`). **Explanation:** backend emits tagged payloads,
    frontend switches renderer — our envelope's `chart_type` field is that tag.

## 3. System prompt (how tools are orchestrated in prose)

`apps/api/src/chat/prompt.ts` — `chatSystemPrompt(bankId, tableInfo)`:

```
You are a plant assistant. bankId=<line>.
1. Always try recall_memory first (filter by granularity when the question has a time-scope).
2. Use text_to_sql only for "right now" / computed / trend questions. Never invent numbers.
3. Lead with the number, one line of context. Then emit charts[] when numeric series exist.
4. If recall is empty and SQL returns 0 rows: say "not yet ingested".
```

Replaces DB-GPT Python ReAct loop (`packages/dbgpt-core/src/dbgpt/agent/expand/
react_agent.py`, `tool_calling_agent.py`, `core/base_agent.py`) with the Vercel AI SDK
`maxSteps` loop — same reasoning pattern, TS runtime.

## 4. Scheduler reports (same envelope, different trigger)

`apps/scheduler` (node-cron every minute) → `getDueSchedules(now)` →
`runReportForSchedule(s)`:

```
recall(budget:'high') -> evaluateCondition (PURE, no LLM: regex oee/downtime/scrap
  vs DEFAULT_THRESHOLDS {minOee:0.75, maxDowntime:30, maxScrap:0.05})
  -> draft summary via llm.complete(DRAFT_SYSTEM: 3-6 sentences + headline)
  -> attach ChartData trend (reuse chart-tool.ts)
  -> writeHistory(source:'report', answer: envelope) -> update schedules {lastRunAt,lastResult,nextRunAt}
  -> deliverExternal: POST webhook {subject, body} (SMTP = documented stub)
```

## 5. Verify Part 2 (done = ?)

1. "OEE yesterday line-3?" → summary from recall, `sources:[recall_memory]`, no chart.
2. "OEE trend last 7 days, show chart" → summary + 1 LineChart + Data tab,
   `sources:[recall_memory, text_to_sql, chart_spec]`.
3. "Shift 1 vs 2 scrap today" → BarChart with 2 bars.
4. History view renders the same graphs (envelope persisted, not plain string).
5. Forbidden SQL (`DROP`, `DELETE`) rejected by verifier test; `MAX_ROWS` enforced.
