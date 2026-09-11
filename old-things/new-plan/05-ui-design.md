# 05 — UI Design (adopt DB-GPT layout, rebuild in our stack)

> Principle: adopt DB-GPT's **information architecture and component split**,
> rebuild every pixel in **Vite + React + Tailwind + shadcn/ui + Recharts + depth.css**.
> No Next.js, no antd, no @antv/g2 in our repo.

## 1. What we copy vs what we rebuild

| DB-GPT (source) | Our fresh equivalent | Why |
|---|---|---|
| `web/components/chat/chat-container.tsx` — chat shell, `scene==='chat_dashboard'` splits 3/4 chart + 1/4 chat | `apps/web-user/src/views/Chat.tsx` — same split when `charts.length>0` | dashboard questions need room for graphs |
| `web/components/chat/chat-content/chart-view.tsx` — `ChartView{data,type,sql}` → Tabs `[Chart,SQL,Data]` | `apps/web-user/src/components/ChartBlock.tsx` — Tabs `[Chart,Data,SQL]` (shadcn Tabs) | user trusts numbers when they can inspect SQL + raw rows |
| `web/components/chart/{bar-chart,line-chart,pie-chart,table-chart}.tsx` | Recharts mappers: `LineChart→LineChart`, `BarChart→BarChart`, `PieChart→Pie`, `Table→shadcn Table`, `IndicatorValue→big-number card` | same chart vocabulary, our render lib |
| `web/components/chart/autoChart/index.tsx` (AVA Advisor auto-pick) | `pickChartType()` heuristic in `ChartBlock` + LLM `display_type` wins | avoid AVA dependency; LLM + 10-line heuristic is enough for v1 |
| `web/components/chat/chat-content/config.tsx` (`chart-view` tag + GPTVis renderers) | envelope renderer: `summary` (react-markdown + remarkGfm + rehypeSanitize) + `charts.map(ChartBlock)` + `sources` collapsible | same idea (tagged payload → renderer switch), our tag is `chart_type` |
| `web/components/chat/header/{db-selector,model-selector,agent-selector}.tsx` | **omit** — user must never see DB/model selectors (internal concern) | trust boundary: user-facing side stays dumb |
| `web/types/chat.ts` `ChartData{chart_desc,chart_name,chart_sql,chart_type,chart_uid,column_name,values[]}` | `packages/shared/src/chart-schema.ts` (same fields, camelCase alias) | 1:1 mapping keeps future template reuse possible |
| `skills/*/templates/report_template.html` (ECharts+Tailwind static report) | scheduled-report view reuses `ChartBlock` (no separate ECharts bundle) | one chart stack, not two |

DB-GPT web stack for reference only: `web/package.json`
(`next:13.4.7`, `react:18`, `antd:5`, `@antv/g2`, `@antv/gpt-vis`, `@berryv/g2-react`,
`@ant-design/plots`, `tailwindcss:3.3`). We install none of these.

## 2. Screens (what / why / how)

### 2.1 Chat (primary — the only screen most users need)
- **What:** message list + composer + suggestion chips. Each assistant message =
  `summary` markdown + 0..N `ChartBlock`s + `sources` collapsible
  (`[tool:recall_memory]`, `[tool:text_to_sql]` parsed out of the stream, shown as
  `<details>`, stripped from visible prose).
- **Why:** mirrors how operators actually ask: "what happened?" (summary) then
  "show me" (graph). One envelope serves both.
- **How:** `lib/api.ts:api.chat(messages)` yields envelope chunks
  (`AsyncGenerator<ChatChunk>`); `Chat.tsx` appends `summary` tokens live, mounts
  `ChartBlock`s on final chunk. Chips: `["Yesterday's OEE", "Show OEE chart",
  "Downtime reason", "Shift comparison"]` → `send(text)`.
- Layout: when `charts.length>0`, content area splits ~3/4 chart + 1/4 chat context
  (port of DB-GPT dashboard split); text-only answers stay single column.

### 2.2 ChartBlock (the graph component)
- **What:** per-`ChartData`: header (`chart_name` + `chart_desc`), body by type,
  footer Tabs `[Chart | Data | SQL]`.
- **Type map (Recharts):**
  - `LineChart` → `LineChart` (x = first datetime/string col, y = numerics)
  - `BarChart` → `BarChart` (shift compare, top/bottom)
  - `PieChart` → `Pie` (composition only, ≤6 slices)
  - `Table` → shadcn `Table` (raw rows, paginate >20)
  - `IndicatorValue` → big-number card (headline OEE/downtime + delta vs prev window)
- **Why Recharts not G2/ECharts:** already in `package.json`, React-native, no extra
  bundle, sufficient for line/bar/pie/table/indicator. Graduate to ECharts only if
  heatmaps/box-plots needed (DB-GPT `csv-data-analysis` template scope — out of v1).

### 2.3 History (past answers with graphs)
- **What:** date picker → list of that day's envelopes (chat + report), full
  `ChartBlock` rendering (not truncated `pre-wrap`).
- **Why:** reports live here by default (delivery = in-app history; webhook opt-in).
- **How:** `GET /history?from=&to=` returns envelopes; same renderer as Chat.

### 2.4 Schedule settings (per-user report time)
- **What:** FullCalendar CRUD + natural-language box ("run line-3 OEE at 8:15am weekdays").
- **Why:** report time is user-configurable, not a fixed backend cron.
- **How:** `POST /schedules/parse` (LLM → `{query, cron_expr, recurrence}`, zod-validated,
  echoed for confirm) + CRUD routes. `nextRunAt` computed tz-aware (`PLANT_TZ`).

### 2.5 Ops dashboard (builder-only, minimal)
- **What:** 4 plain panels (TanStack Table, no design system): job status
  (last run, success/fail, pending count from `job_runs`), retry button
  (`POST /ops/retry`), per-user report status, cron health (flag missed tick).
- **Why:** Hindsight's built-in Control Plane shows *what got stored*; our dashboard
  shows *pipeline health* (which Hindsight cannot know).
- **Auth:** separate cookie, internal network only.

## 3. Theme (elegant depth — keep)

`styles/depth.css` elevation tokens (layered surfaces, soft multi-stop shadows, slight
card perspective) + Framer Motion message transitions. No WebGL. DB-GPT's antd theme
is **not** adopted — only layout ideas cross over.
