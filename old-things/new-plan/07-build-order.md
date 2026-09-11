# 07 — Build Order (fresh start, phases + verification)

> Each phase ends with a check. Do not start the next phase until the check passes.
> Runtime modes: `mock` (zero external services: fixture PG + offline LLM + file Hindsight)
> first, then `live` (real PG + Claude + Hindsight :8888).

## Phase 0 — Contracts + scaffold
1. `pnpm` workspace (`apps/*`, `packages/shared`, `skills/*`), root tsconfig, eslint/prettier.
2. `docker-compose.yml`: `app-postgres` (+ `hindsight` + `hindsight-postgres` under `live` profile).
3. `packages/shared`: **lock** `fact-schema.ts` (v1, unchanged) + **new** `chart-schema.ts`
   (`ChartData`, `ChatAnswer` — see `04` §1) + `types.ts` (envelope-aware `HistoryEntry`).
4. `.env.example`: `MACHINE_DATABASE_URL, APP_DATABASE_URL, HINDSIGHT_API_URL,
   HINDSIGHT_LLM_API_KEY, ANTHROPIC_API_KEY, AUTH_JWT_SECRET, OPS_*,
   PLANT_TZ, HINDSIGHT_BANK_SCHEME=per-line`.
- ✅ `pnpm -r typecheck` clean.

## Phase 1 — Ingestion input (SQL + context)
5. `apps/api/src/db/machine-db.ts` (+ mock): pool, `SELECT 1` ping, parameterized
   `executeQuery` with retry + timeout.
6. `apps/api/src/db/app/schema.ts` (Drizzle): users, sessions?, schedules, themes,
   history (envelope-capable), job_runs + first migration + `seed:user`.
7. `apps/ingest/src/sql/{queries.ts,row-types.ts}`: all 6 queries from `02` §2
   (fixture returns sample rows in mock).
8. `apps/ingest/src/context/{build.ts,shift.ts}`: hourly/shift/daily/event/weekly units,
   metadata enrich, chunking, granularity tags.
- ✅ Fixture rows → correct unit counts per granularity.

## Phase 2 — Extraction + memory
9. `skills/line-oee/SKILL.md` (thresholds, OEE formula, taxonomy) + prepend to prompt.
10. `apps/ingest/src/extract/{prompt.ts,extract.ts,validate.ts}`: LLM 2-attempt + zod +
    heuristic fallback.
11. `apps/api/src/hindsight/*`: port, `bank.ts` (per-line), `retain.ts` (`async:false`),
    `recall.ts`, mock + http implementations.
12. `apps/ingest/src/{pipeline.ts,checkpoint.ts,index.ts}`: write-then-flip orchestration.
- ✅ `pnpm job:ingest`: 3 rows → 9 facts; granularity-filtered recall hits; kill-mid-run
  leaves `pending` retried.

## Phase 3 — Auth + chat backend
13. Auth: argon2 + JWT httpOnly cookie, `/auth/login|logout|me`, ops separate cookie.
14. `apps/api/src/db/schema-summary.ts`: `getTableInfo()` for SQL prompt.
15. `apps/api/src/chat/{sql-prompt.ts,text-to-sql.ts,verify-sql.ts,chart-tool.ts,tools.ts,
    prompt.ts,route.ts}`: 3 tools + envelope + `maxSteps:5` streaming.
16. `apps/api/src/llm/*`: `LlmPort{complete,stream}`, mock (canned + tool echo) + Anthropic
    (`ai` + `@ai-sdk/anthropic`, lazy import).
- ✅ Mock chat: recall question → summary; trend question → summary + LineChart spec;
  `DROP TABLE` rejected; history written.

## Phase 4 — Web user UI
17. Shell + `LoginPage`, auth guard, `ThemeProvider`, `depth.css`.
18. `Chat.tsx` + `ChartBlock.tsx` + `lib/api.ts` (envelope streaming): markdown summary +
    charts + sources tray + chips; 3/4+1/4 split when charts present.
19. `HistoryView` (envelope renderer) + `ScheduleView` (FullCalendar + NL parse box).
- ✅ "OEE last 7 days" renders LineChart + Data + SQL tabs; history re-renders graphs.

## Phase 5 — Scheduler + ops
20. `apps/api/src/report/{due.ts,run.ts,evaluate.ts,deliver.ts}` + `apps/scheduler/src/*`
    (minute tick, overlap guard): recall → pure evaluate → draft → chart attach →
    history + webhook.
21. `apps/api/src/ops/routes.ts` + `apps/web-ops`: 4 panels (job status, retry,
    scheduler status, cron health), separate login.
- ✅ Due schedule fires within a minute; `schedules.lastResult` + `job_runs` updated;
  ops retry re-runs ingest.

## Phase 6 — Live cutover (after mock green)
- `RUNTIME_MODE=live`, real `MACHINE_DATABASE_URL` (read-only role),
  `ANTHROPIC_API_KEY` (+ optional `ai` deps), `docker compose --profile live up -d`,
  `HINDSIGHT_LLM_API_KEY`, verify REST paths in `http-hindsight.ts`.
- Replace fixture rows with real calc queries (Phase-10 real SQL) — downstream unchanged.

## Phase map → plan files
| Phase | Plan file |
|---|---|
| 0 | `00, 08` (contracts, decisions) |
| 1–2 | `02, 03` (Part 1 + granularity) |
| 3–4 | `04, 05` (Part 2 + UI) |
| 5 | `04` §4 + `05` §2.5 |
| 6 | this file + `08` |
