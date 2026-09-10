# 06 — DB-GPT Reference (download on demand + what to read)

> The DB-GPT repo is **not vendored** here. Clone it any time you need the reference.
> This file pins what to download and exactly which files matter.

## 1. Clone instructions (reproducible)

```bash
# from repo root:
git clone https://github.com/eosphoros-ai/DB-GPT.git z_research-work/DB-GPT
cd z_research-work/DB-GPT
git checkout 9c8b3c9   # <-- replace with the commit you audited; record it here
```

- `z_research-work/` is git-ignored (see root `.gitignore`) — the clone never gets committed.
- License: MIT (per DB-GPT `LICENSE`) — porting ideas + small snippets with attribution
  is fine; do not copy large files verbatim without keeping the license header.
- No install needed for reference use (reading only). Do **not** `pip install` / `uv sync`
  unless you deliberately want to run the Python server.

## 2. Reading map (concept → exact file → what to take)

### A. Text-to-SQL loop (→ `04-part2-chat-graphs.md` §2 Tool B)
| File | Role | Take |
|---|---|---|
| `packages/dbgpt-app/src/dbgpt_app/scene/chat_db/auto_execute/chat.py` (`ChatWithDbAutoExecute`) | agent loop: schema-retrieve → prompt → `database.run_to_df` | step order |
| `.../auto_execute/prompt.py` | system prompt vars `{db_name, table_info, dialect, top_k, display_type}` + strict JSON `{thoughts, direct_response, sql, display_type}` | prompt shape |
| `.../auto_execute/out_parser.py` (`DbChatOutputParser`) | `sqlparse` check + `json.loads → SqlAction` | validate-then-run |
| `.../auto_execute/config.py` (`ChatWithDBExecuteConfig`) | `schema_retrieve_top_k, schema_max_tokens, max_num_results` | budget constants |
| `packages/dbgpt-app/src/dbgpt_app/scene/chat_db/professional_qa/chat.py\|prompt.py\|out_parser.py` | DBA variant (full schema + graph `top_k`) | skip unless DBA mode needed |
| `packages/dbgpt-app/src/dbgpt_app/scene/chat_data/chat_excel/excel_learning/verify_sql.py` | quote-fix validation example | verifier edge cases |
| `packages/dbgpt-serve/src/dbgpt_serve/datasource/service/db_summary_client.py` + `service.py` | schema summarization feeding the prompt | `table_info` builder |
| `packages/dbgpt-serve/src/dbgpt_serve/flow/templates/en/chat-data-awel-flow-template.json` | declarative flow doc | step-order doc only |

### B. Datasource abstraction (→ `02-part1-ingestion.md` §2)
| File | Role | Take |
|---|---|---|
| `packages/dbgpt-core/src/dbgpt/datasource/base.py` (`BaseConnector`) | ABC: `run, run_to_df, get_table_info, get_columns, close` | port interface |
| `packages/dbgpt-core/src/dbgpt/datasource/rdbms/base.py` (`RDBMSConnector`, ~910 lines) | SQLAlchemy engine+pool+reflect | pool/retry idea only |
| `packages/dbgpt-core/src/dbgpt/datasource/parameter.py` | `RDBMSDatasourceParameters{host,port,user,database,driver,pool_*}` | config shape |
| `packages/dbgpt-ext/src/dbgpt_ext/datasource/rdbms/conn_postgresql.py` (+ siblings `conn_mysql\|sqlite\|duckdb\|...`) | Postgres dialect | dialect reference |
| `packages/dbgpt-ext/src/dbgpt_ext/datasource/schema.py` (`DBType` enum) | supported DB list | scope reference |
| `packages/dbgpt-serve/src/dbgpt_serve/datasource/manages/connector_manager.py` | registry + TTL cache + locks | simplify to singleton |

### C. Skills system (→ plant skills `skills/line-oee/SKILL.md`)
| File | Role | Take |
|---|---|---|
| `skills.py` (repo root, `SkillsMiddleware/SkillsLoader`) | progressive disclosure: metadata in prompt, `SKILL.md` on demand, YAML frontmatter | loading pattern |
| `packages/dbgpt-core/src/dbgpt/agent/skill/{base,loader,middleware,middleware_v2,manage,agent}.py` | skill lifecycle + prompt injection | pattern only |
| `skills/csv-data-analysis/SKILL.md` + `scripts/csv_analyzer.py` + `templates/report_template.html` | canonical skill: `execute_skill_script → ###MARKERS### → html_interpreter` | template for `line-oee` skill |
| `skills/walmart-sales-analyzer/` | multi-chart example (trend/compare/heatmap/scatter) | chart variety ideas |
| `skills/INTEGRATION_GUIDE.md`, `README.md` | integration docs | onboarding reference |

### D. Charts / dashboard (→ `04` §2 Tool C + `05` §2.2)
| File | Role | Take |
|---|---|---|
| `packages/dbgpt-app/src/dbgpt_app/scene/chat_dashboard/chat.py` (`ChatDashboard`) | multi-`ChartData` generation | orchestration |
| `.../chat_dashboard/prompt.py` + `out_parser.py` (`ChartItem{sql,title,thoughts,showcase}`) | prompt caps (4–8 dims, ≤4 cols) | prompt caps |
| `.../chat_dashboard/data_loader.py` (`DashboardDataLoader`: string/datetime/id heuristics, numeric `sum()`) | column mapping | heuristics |
| `.../chat_dashboard/data_preparation/report_schma.py` (`ValueItem/ChartData/ReportData`) | **the contract** | field names |
| `.../chat_dashboard/template/report/dashboard.json` (`supported_chart_type`) | allowed types | type list |
| `packages/dbgpt-core/src/dbgpt/agent/expand/actions/chart_action.py` + `dashboard_action.py` | `SQL → DF → VisChart/VisDashboard` | single vs multi pattern |
| `packages/dbgpt-app/src/dbgpt_app/scene/chat_db/data_loader.py` (`DbDataLoader`: DF → `chart-view` XML) | table-view wire format | XML idea (we use JSON) |
| `packages/dbgpt-core/src/dbgpt/vis/tags/vis_chart.py` + `vis_dashboard.py` | `vis-db-chart` / `vis-dashboard` tags | tag→renderer idea |

### E. UI components (→ `05-ui-design.md`)
| File | Role | Take |
|---|---|---|
| `web/components/chat/chat-container.tsx` | shell + dashboard 3/4+1/4 split | layout |
| `web/components/chat/chat-content/chart-view.tsx` + `vis-chart.tsx` + `vis-dashboard.tsx` | `ChartView → Tabs[Chart,SQL,Data]` | tab pattern |
| `web/components/chart/{bar-chart,line-chart,pie-chart,table-chart}.tsx` + `autoChart/index.tsx` | renderers + AVA auto-pick | renderer split |
| `web/types/chat.ts` (`ChartData`) | frontend type | mirror in zod |
| `web/package.json` | stack list (next, antd, g2, gpt-vis) | explicitly do NOT install |

### F. Explicitly out of scope (do not read deeply)
- `packages/dbgpt-sandbox/*` (`docker_runtime.py`, `control_layer.py`, …) — isolated
  Python exec; we stay TS-only in v1.
- `packages/dbgpt-core/src/dbgpt/core/awel/**/*` (`dag/base.py`, runners, triggers) —
  workflow engine; our `Vercel AI SDK maxSteps + node-cron` covers v1.
- `packages/dbgpt-core/src/dbgpt/storage/vector_store/*` + `graph_store/*` — we use Hindsight.
- `packages/dbgpt-app/src/dbgpt_app/knowledge/*` + `packages/dbgpt-ext/src/dbgpt_ext/rag/*` —
  file loaders useful later (CSV/PDF), not v1.

## 3. How to update the reference

1. `cd z_research-work/DB-GPT && git pull && git rev-parse HEAD`
2. Paste the new SHA into §1 above + date.
3. Re-check the 6 port files for breaking renames (paths are stable historically).
