---
name: line-oee
version: 1.0.0
description: OEE / downtime / scrap analysis for a manufacturing line. Use when extracting facts from production context or answering questions about OEE, downtime, or scrap.
allowed_tools: [recall_memory, text_to_sql, chart_spec]
tags: [manufacturing, oee, ingestion, chat]
---

# Line OEE Skill

Pattern reference (DB-GPT concept, not runtime): `skills.py` progressive disclosure +
`skills/csv-data-analysis/SKILL.md` (script + template structure). Here the "script" is
the TypeScript ingest pipeline + chat tools; this file is the domain knowledge.

## 1. Definitions

- **OEE** = Availability × Performance × Quality, ratio 0–1. Availability =
  runtime / planned time. Report as ratio (0.72), never percent strings in facts.
- **Downtime** in minutes per window (`downtime_min`, sum). Severity: <10 info,
  10–30 warning, >30 critical.
- **Scrap rate** = scrapped / produced, ratio 0–1 (breach if > 0.05).

## 2. Thresholds (defaults — plant config wins)

| metric | breach |
|---|---|
| `oee` | below 0.75 |
| `downtime_min` | above 30 per day |
| `scrap_rate` | above 0.05 |

## 3. Extraction rules (for `apps/ingest/src/extract/`)

1. One fact per metric per window — never blend hourly and daily in one statement.
2. Statement shape: "Line line-3 OEE averaged 0.72 over hour 2026-09-01T08:00 (420 produced, 18 scrapped, 12 min downtime)."
3. Entities: at least `{type:'line', name}` + `{type:'metric', name:'oee'}`.
4. `timeScope.granularity` must equal the ContextUnit granularity.
5. `metric.aggregation`: hourly/daily OEE → `avg`; downtime/units → `sum`; events → `raw`.
6. Events (alarm/maintenance/changeover/quality/downtime) become separate `instant` facts
   with `event{kind,severity,durationMin?}`, never merged into metric facts.
7. `source.queryName` = originating SQL function; `rowIds` = contributing row ids.
8. `tags`: `granularity:<g>`, `line:<id>`, `machine:<id>?`, `metric:<name>?`, `event:<kind>?`.

## 4. Chat rules (for `apps/api/src/chat/`)

1. Prefer `recall_memory` with the question's time-scope as granularity filter.
2. `text_to_sql` only for fresh/computed/trend questions; charts: trends → LineChart,
   shift compare → BarChart, single headline → IndicatorValue, raw lists → Table,
   composition → PieChart.
3. Never invent numbers; if recall empty and SQL 0 rows → "not yet ingested".
