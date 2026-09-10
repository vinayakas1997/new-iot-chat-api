# 08 — Open Decisions (lock before coding the phase they block)

| # | Decision | Recommendation (trail v1) | Blocks |
|---|---|---|---|
| 1 | Fact schema | **LOCKED v1** — `packages/shared/src/fact-schema.ts`, additive-only changes | Phase 0 |
| 2 | Bank scheme | **per-line** (`line:<id>`), env `HINDSIGHT_BANK_SCHEME` | Phase 2 |
| 3 | Daily totals: independent query vs sum-of-hourly | **independent query** (`fetchDailySummary`) — hourly is drill-down only | Phase 1 |
| 4 | Chart contract | **new `chart-schema.ts`**: `Table\|LineChart\|BarChart\|PieChart\|IndicatorValue` (DB-GPT names), `ChatAnswer{summary,charts[],sources[]}` | Phase 0 |
| 5 | Chat transport | **break to envelope** (stream summary tokens + final charts JSON) — safe because fresh start | Phase 3 |
| 6 | Chart types v1 | **Table + Line + Bar + Indicator**; Pie optional; heatmap/box/radar deferred (DB-GPT advanced templates) | Phase 4 |
| 7 | History storage | **envelope persisted** (`answer` object, not plain string) so graphs replay | Phase 3 |
| 8 | Sandbox / Python exec | **No** — TS + Recharts only; revisit if box-plots/heatmaps demanded | Phase 3 |
| 9 | Workflow engine | **No AWEL** — Vercel AI SDK `maxSteps:5` + `node-cron` suffice | Phase 3/5 |
| 10 | Report delivery | **in-app history always**; webhook opt-in; SMTP stub (log only) | Phase 5 |
| 11 | Timezone | **single `PLANT_TZ`** (e.g. `Asia/Ho_Chi_Minh`) for shifts/daily/schedules | Phase 1 |
| 12 | Weekly facts | **do not store** — aggregate 7x daily at chart time | Phase 1 |
| 13 | Auth shape | **username+password, no email**, seeded via CLI; single-user variant = hardcode `userId='default'` if ever needed | Phase 3 |
| 14 | Reference pin | **record DB-GPT commit SHA** in `06` §1 on first clone | Phase 0 |

Change rule: flipping 1/2/3/5/7 later requires re-ingestion or migration — decide in writing here first.
