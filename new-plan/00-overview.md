# 00 — Overview: What We Are Building and Why

## 1. One-line goal

A trail (fresh-start, no real data yet) Industrial RAG chatbot where the **user never sees or touches the data source**.
Everything about data is handled internally. The user only asks a question and gets back a **summary + calculated graph** in chat.

## 2. Why fresh start?

The existing `apps/* + packages/shared` code in this repo is a working mock trail, but it is
text-only (markdown + tables, zero graphs — `recharts` is installed but never imported)
and its ingestion is stubbed. Rather than patching stubs, we rebuild from zero with the
correct contracts (Fact schema + Chart schema + granularity matrix) locked on day one.

## 3. The core promise (accuracy first)

Live-query-everything chatbots hallucinate numbers. We do the opposite:

```
WE write SQL -> WE form context -> AI reads context -> AI extracts facts
  -> facts ingested into Hindsight (vector + graph + temporal memory)
    -> USER asks -> recall facts -> show SUMMARY (+ graph if numeric)
```

If something was not ingested, the bot says "not yet ingested" — it never invents numbers.

## 4. Where DB-GPT fits (and where it does not)

DB-GPT (`https://github.com/eosphoros-ai/DB-GPT`, cloned on demand — see
`06-dbgpt-reference.md`) is a Python agentic data assistant. We do **not** run its code.
We **port 7 concepts** from it into TypeScript:

| # | Concept taken | DB-GPT source | Where it lands here | Why |
|---|---|---|---|---|
| 1 | Text-to-SQL strict-JSON prompt | `packages/dbgpt-app/src/dbgpt_app/scene/chat_db/auto_execute/prompt.py` + `out_parser.py` | `apps/api/src/chat/text-to-sql.ts` | generate safe SQL from NL without hallucination |
| 2 | SQL validation | `packages/dbgpt-app/src/dbgpt_app/scene/chat_data/chat_excel/excel_learning/verify_sql.py` + `packages/dbgpt-core/src/dbgpt/datasource/rdbms/base.py` | `apps/api/src/chat/verify-sql.ts` | enforce read-only, row limits |
| 3 | Schema summary for prompt | `packages/dbgpt-serve/src/dbgpt_serve/datasource/service/db_summary_client.py` + `service.py` | `apps/api/src/db/schema-summary.ts` | LLM needs table/column context |
| 4 | ChartData / ReportData contract | `packages/dbgpt-app/src/dbgpt_app/scene/chat_dashboard/data_preparation/report_schma.py` + `template/report/dashboard.json` | `packages/shared/src/chart-schema.ts` | graphs need a typed contract |
| 5 | SQL -> data -> chart flow | `packages/dbgpt-core/src/dbgpt/agent/expand/actions/chart_action.py` + `dashboard_action.py` + `packages/dbgpt-app/src/dbgpt_app/scene/chat_dashboard/data_loader.py` | `apps/api/src/chat/chart-tool.ts` | turn query results into chart specs |
| 6 | Chart UI with [Chart\|SQL\|Data] tabs | `web/components/chat/chat-content/chart-view.tsx` + `web/components/chart/*` + `web/types/chat.ts` | `apps/web-user/src/components/ChartBlock.tsx` | proven UX for data answers |
| 7 | Skills pattern (SKILL.md) | `skills.py` + `skills/csv-data-analysis/SKILL.md` + `skills/walmart-sales-analyzer/` | `skills/*` | reusable plant procedures (OEE, downtime) |

Explicitly **ignored**: `packages/dbgpt-sandbox/*` (Docker python exec — too heavy),
`packages/dbgpt-core/src/dbgpt/core/awel/*` (DAG engine — we already have Vercel AI SDK +
node-cron), DB-GPT vector stores (we already have Hindsight).

## 5. Who this plan is for

Anyone opening `new-plan/` should understand without prior context:
- `01-architecture.md` — boxes, arrows, trust boundary
- `02-part1-ingestion.md` + `03-granularity-matrix.md` — everything up to Hindsight
- `04-part2-chat-graphs.md` + `05-ui-design.md` — everything from Hindsight to pixels
- `06-dbgpt-reference.md` — how to re-download the reference and what to read
- `07-build-order.md` — in what order to build + how to verify each step
- `08-open-decisions.md` — the few choices still open

## 6. Non-goals for trail v1

- No real plant connection (fixture Postgres only).
- No email/Slack delivery (in-app history only).
- No arbitrary Python execution (TypeScript + Recharts only).
- No multi-plant multi-tenancy (single plant, per-line banks).
