# Industrial RAG Chatbot — Implementation Plan

Companion to [plan.md](plan.md). This file fixes the **stack**, **packages**, **repo
structure**, and the **ordered build steps**. Terminology (Job 1/2/3, build-now vs
build-later, crash-safety rule) is defined in `plan.md` and not repeated here.

---

## 1. Stack decision

One language end to end — **TypeScript / Node** — because Hindsight's SDK is
TypeScript-first (Vercel AI SDK tools). Same language for API, cron jobs, and both
UIs = shared types, one toolchain, one `pnpm` monorepo.

| Concern | Choice | Notes |
|---|---|---|
| Monorepo | `pnpm` workspaces | `apps/*` + `packages/shared` |
| Backend API | **Fastify** + TypeScript | REST + streaming chat endpoint |
| Chat LLM | **Anthropic Claude** (`claude-sonnet-5`) via `@ai-sdk/anthropic` | tool-calling + streaming |
| LLM orchestration | **Vercel AI SDK** (`ai`) | `streamText`, `tool()`, MCP client |
| Memory store | **Hindsight** (self-hosted, Docker) | called over **REST** from `apps/api/src/hindsight/http-hindsight.ts` (not the SDK — keeps deps small; swap in `@vectorize-io/hindsight-client` behind the same port if wanted). Mock mode uses a file-backed fake. |
| Industrial DB access | **`pg`** (node-postgres) pool | the 5.1 layer; read-only role |
| App store (ours) | **Postgres** + **Drizzle ORM** | users, sessions, schedules, themes, history, job runs |
| Live SQL tool | **Postgres MCP** (`crystaldba/postgres-mcp`, read-only mode) wired via AI SDK MCP client | direct-query fallback if MCP is a hassle early |
| Cron tick | **`node-cron`** in each job process | jobs are separate entrypoints, not routes |
| Config / validation | **`zod`** | one `config.ts` per app, fail fast on boot |
| User UI | **Vite + React + TS**, **Tailwind**, **shadcn/ui**, **Framer Motion**, **Recharts**, **FullCalendar** | elegant, subtle 3D via CSS transforms + soft shadow/depth tokens + motion — no WebGL |
| Ops UI | **Vite + React + TS**, **TanStack Table**, no design system | functional, internal-only, separate auth |
| Auth (user) | **username + password only, no email**; `argon2` hash; JWT in `httpOnly` cookie | see §5 |
| Auth (ops) | separate credential set, internal-only | never shares a session with the user UI |

### Hindsight packages / runtime

- **Server** (Docker, self-hosted): Python 3.11+, its own Postgres, ~4–8 GB RAM,
  listens on **:8888**. Needs its **own LLM API key** (OpenAI / Anthropic / etc.)
  for fact extraction + entity resolution — separate from `ANTHROPIC_API_KEY`.
- **Control Plane UI**: use Hindsight's built-in one (`ui.hindsight.vectorize.io`
  for cloud, or the self-hosted console). **Do not rebuild** — it is the ops-plane
  "what got stored and how it's linked" window.
- **Client** (our API):
  ```bash
  pnpm add @vectorize-io/hindsight-client @vectorize-io/hindsight-ai-sdk ai @ai-sdk/anthropic
  ```
  ```ts
  import { HindsightClient } from '@vectorize-io/hindsight-client';
  import { createHindsightTools } from '@vectorize-io/hindsight-ai-sdk';

  const client = new HindsightClient({ baseUrl: process.env.HINDSIGHT_API_URL }); // http://localhost:8888
  // recreate per request so bankId is per-user
  const tools = createHindsightTools({
    client,
    bankId,                       // = get_bank_id(...) — see §DECISION 2
    recall: { budget: 'high', includeEntities: true, maxTokens: 2048 },
    reflect: { budget: 'mid' },
    retain: { async: false },     // ingestion needs the write to confirm before flipping the flag
  });
  ```
  Tools available: `retain`, `recall`, `reflect`, `getMentalModel`, `getDocument`.
  `bankId` = the per-user / per-line memory partition.

---

## 2. Repo structure

```
industrial-rag-sql/
  pnpm-workspace.yaml
  docker-compose.yml            # hindsight + hindsight-postgres + app-postgres
  .env.example
  plan.md
  implementation-plan.md
  packages/
    shared/
      src/
        fact-schema.ts          # LOCKED zod schema for "a fact" — DECISION 1
        types.ts                # Schedule, ChatMessage, HistoryEntry, API contracts
  apps/
    api/                        # Backend API — BUILD NOW (5.6)
      src/
        index.ts                # Fastify bootstrap
        config.ts               # zod-validated env
        db/
          machine-db.ts         # 5.1: getPool, checkDbConnection (SELECT 1), executeQuery (timeout + retry)
          app/
            schema.ts           # drizzle: users, sessions, schedules, themes, history, job_runs
            client.ts
            migrations/
        auth/
          password.ts           # argon2 hash/verify
          session.ts            # sign/verify JWT cookie
          routes.ts             # POST /auth/login, POST /auth/logout, GET /auth/me
          middleware.ts
        hindsight/
          client.ts
          bank.ts               # getBankId() — DECISION 2 lives here
          retain.ts             # retainFacts(bankId, facts)          (5.5)
          recall.ts             # recallContext(bankId, query)        (5.6)
        chat/
          tools.ts              # hindsight recall/reflect tools + liveSqlTool (MCP, read-only)
          prompt.ts             # chat system prompt builder
          route.ts              # POST /chat  (streaming) -> also writes history
        schedule/
          parse.ts              # parseScheduleRequest(msg) -> { query, time, recurrence } via LLM + zod
          store.ts              # get/setUserSchedule
          routes.ts             # CRUD for the calendar UI
        history/
          store.ts              # writeAnswer(), queryByDate()
          routes.ts             # GET /history?from=&to=
        settings/
          theme.ts              # get/setUserTheme
        ops/
          routes.ts             # 5.8: getJobStatus, retryFailedBatch, checkCronHealth
    ingest/                     # Job 1+2 combined — BUILD NOW with stubbed input (5.5)
      src/
        index.ts                # run-once entrypoint (invoked by node-cron / external cron)
        pipeline.ts             # fetch -> buildContext -> extract -> retain -> flip flag
        checkpoint.ts           # last_checkpoint + pending/ingested status flags (crash-safety)
        sql/queries.ts          # 5.2 — STUB now (returns sample rows)
        context/build.ts        # 5.3 — STUB now (returns sample context blobs, tagged granularity)
        extract/
          prompt.ts             # 5.4 — STUB now (schema already locked in packages/shared)
          extract.ts
          validate.ts           # zod check + bounded strict re-prompt
    scheduler/                  # Job 3 — report scheduler — BUILD NOW (5.7)
      src/
        index.ts                # node-cron: tick every minute
        due.ts                  # getDueSchedules(now) — reads schedule store
        run-report.ts           # fetchLatestConditions -> evaluate -> draftReport -> deliver -> writeHistory
        evaluate.ts             # pure threshold logic, NO LLM
        deliver.ts              # in-app (history) + optional SMTP / webhook
    web-user/                   # User UI — BUILD NOW
      src/
        main.tsx  app.tsx
        lib/api.ts
        auth/LoginPage.tsx      # username + password, nothing else
        chat/ChatView.tsx       # streaming
        schedule/ScheduleView.tsx   # FullCalendar — create/edit/delete scheduled queries
        history/HistoryView.tsx     # pick a past date -> answers given that day
        settings/ThemeProvider.tsx
        components/ui/*          # shadcn
        styles/depth.css        # 3D/elevation tokens
    web-ops/                    # Ops dashboard — BUILD NOW (minimal) (5.8)
      src/
        main.tsx
        auth/OpsLogin.tsx
        panels/JobStatus.tsx  RetryPanel.tsx  SchedulerStatus.tsx  CronHealth.tsx
```

---

## 3. App-store schema (Drizzle, our Postgres — not the industrial one)

- `users` — `id`, `username` (unique), `password_hash`, `created_at`  *(no email)*
- `sessions` — or stateless JWT only; keep a `sessions` table only if you want server-side revoke
- `schedules` — `id`, `user_id`, `query_text`, `cron_expr`, `next_run_at`, `active`, `last_run_at`, `last_result`
- `themes` — `user_id`, `theme`
- `history` — `id`, `user_id`, `source` (`chat` | `report`), `question`, `answer`, `created_at`, `schedule_id?`
- `job_runs` — `id`, `job_name` (`ingest` | `scheduler`), `started_at`, `finished_at`, `status`, `pending_count`, `error?`  → feeds the ops dashboard

Industrial-data status flags (`pending` / `ingested`) live in **the industrial
Postgres** (a status column or a small `ingestion_state` table there), per
`plan.md` §3 crash-safety.

---

## 4. Environment variables (`.env.example`)

```
# industrial data (read-only role)
MACHINE_DATABASE_URL=postgres://ro_user:...@host:5432/plant

# our app store
APP_DATABASE_URL=postgres://app:...@localhost:5433/app

# hindsight
HINDSIGHT_API_URL=http://localhost:8888
HINDSIGHT_LLM_API_KEY=sk-...          # Hindsight server-side, extraction/entity resolution

# chat LLM
ANTHROPIC_API_KEY=sk-ant-...

# auth
AUTH_JWT_SECRET=...
OPS_USERNAME=builder
OPS_PASSWORD_HASH=...                 # argon2

# report delivery (optional at first — in-app history is the default channel)
SMTP_URL=
REPORT_WEBHOOK_URL=
```

---

## 5. User login (as requested: no email, password only)

- `users` table has **`username` + `password_hash`** only. No email, no reset flow,
  no signup form — accounts are created by a seed/CLI script (`pnpm --filter api seed:user`).
- `POST /auth/login {username, password}` → verify with `argon2` → set a signed
  `httpOnly`, `SameSite=Lax`, `Secure` JWT cookie (7-day expiry).
- `GET /auth/me` returns `{userId, username, theme}`; UI redirects to `LoginPage`
  on 401.
- `POST /auth/logout` clears the cookie.
- `userId` is what drives `bankId`, schedules, history, and theme — so a username
  is required even though the form is just two fields.
- **If you actually want single-user** (one shared password, no username): drop
  `username`, hardcode `userId = 'default'`, keep everything else. Say the word and
  I'll build that variant instead.

Ops UI auth is a **separate** check against `OPS_USERNAME` / `OPS_PASSWORD_HASH`
with its own cookie name — no shared session with the user UI, internal network only.

---

## 6. Ordered build steps

### Phase 0 — Scaffold
1. `pnpm` workspace, root `tsconfig`, eslint/prettier.
2. `docker-compose.yml`: Hindsight + its Postgres + our app Postgres. `.env.example`.
3. `packages/shared`: **lock the fact zod schema (DECISION 1)** + `Schedule` / `HistoryEntry` / API contract types.

### Phase 1 — Postgres connection layer (5.1)
4. `db/machine-db.ts`: `getPool()` (pool size, connect + statement timeout), `checkDbConnection()` (`SELECT 1`), `executeQuery(sql, params)` (parameterized only, retry on transient codes `57P01/53300/08006`, hard query timeout).
5. `db/app/`: Drizzle schema (§3) + first migration + `seed:user` script.

### Phase 2 — Auth (§5)
6. `argon2` hash/verify, JWT cookie sign/verify, `authMiddleware`.
7. `/auth/login`, `/auth/logout`, `/auth/me`.

### Phase 3 — Hindsight wrappers (5.5)
8. `hindsight/client.ts`, `bank.ts` (**settle DECISION 2** — per-line recommended), `retain.ts`, `recall.ts`.
9. Smoke test: retain 3 sample facts → recall → assert hits.

### Phase 4 — Backend chat (5.6)
10. `chat/tools.ts`: Hindsight `recall` + `reflect` as AI SDK tools; `liveSqlTool` via Postgres MCP (read-only) — or direct parameterized read-only query if MCP setup drags.
11. `chat/prompt.ts` + `POST /chat` streaming (`streamText` + Claude). Every completed answer → `history.writeAnswer('chat', ...)`.

### Phase 5 — Schedule surface (5.6 cont.)
12. `schedule/parse.ts`: LLM parses "run line-3 OEE at 8:15am on weekdays" → `{query, cron_expr, recurrence}`, zod-validated, echoed back to user for confirm.
13. `schedule/store.ts` + `schedule/routes.ts` (list / create / update / delete) for the calendar UI.

### Phase 6 — Report scheduler (5.7)
14. `scheduler/` separate process: `node-cron` minute tick → `getDueSchedules(now)`.
15. `evaluate.ts` pure threshold logic (no LLM) → `draftReport` (LLM) → `deliver` (in-app history always; SMTP/webhook if configured) → `writeAnswer('report', ...)` → update `schedules.last_run_at/result` + `job_runs`.

### Phase 7 — Ingestion wrapper with stubs (5.5)
16. `ingest/pipeline.ts` wired end-to-end using **stubbed** `sql/queries.ts`, `context/build.ts`, `extract/*` that return sample data shaped to the locked schema.
17. `checkpoint.ts`: mark `pending` before the LLM call, `ingested` only after `retain` resolves (write-then-flip). Record each run in `job_runs`.

### Phase 8 — User UI
18. Vite + React + Tailwind + shadcn + Framer Motion; `LoginPage`; auth-guarded shell.
19. `ChatView` (streaming), `ScheduleView` (FullCalendar CRUD), `HistoryView` (date picker → answers), `ThemeProvider`.
20. Elegance/3D pass: elevation tokens in `depth.css` (layered surfaces, soft multi-stop shadows, slight perspective on cards), Framer Motion page/message transitions, Recharts for any numeric answers rendered as a chart instead of a paragraph.

### Phase 9 — Ops UI (5.8)
21. `api/src/ops/routes.ts`: `getJobStatus`, `retryFailedBatch`, `checkCronHealth` (flag a job whose expected tick was missed) — all reading `job_runs`.
22. `web-ops`: separate login + 4 plain panels (job status, retry button, per-user report status, cron health).

### Phase 10 — Deferred (after the calc layer / team split — `plan.md` §6, §7)
- Replace the Phase 7 stubs with the real 5.2 SQL query set, 5.3 multi-granularity
  context builder, and 5.4 fact-extraction prompt.

---

## 7. Decisions to lock before coding the phase they block

| # | Decision | Status |
|---|---|---|
| 1 | Exact JSON schema for "a fact" | **DONE** — `FACT_SCHEMA_VERSION = 1`, zod in `packages/shared/src/fact-schema.ts` |
| 2 | Hindsight `bankId` scheme | **DONE** — `per-line` (`line:<id>`), via `HINDSIGHT_BANK_SCHEME`; `getBankId()` in `apps/api/src/hindsight/bank.ts` |
| 3 | "Daily" totals queried independently vs summed from hourly | **deferred to Phase 10** — stub in `apps/ingest/src/context/build.ts` currently derives daily from the same rows |
| 4 | History playback scope | **DONE** — every chat + report answer stored in `history`; UI filters by day |
| 5 | Report delivery | **DONE** — in-app history always; `SMTP_URL` / `REPORT_WEBHOOK_URL` opt-in (`apps/api/src/report/deliver.ts`; SMTP left as a documented stub) |

## 8. Status — Phases 0–9 built, verified in mock mode

All six packages typecheck. End-to-end mock run verified: auth, streaming chat with
`recall_memory` + `live_sql` tools, schedule NL-parse → cron → tz-correct next-run,
ingestion (rows → context units → facts → retain, write-then-flip crash-safety),
report run (recall → pure-logic evaluate → draft → history), ops login + job status
+ spawn-ingest, both UIs build. See [README.md](README.md) to run it.

**Phase 10 (deferred, unchanged):** replace the stubs in `apps/ingest/src/{sql,context,extract}`
with the real §5.2 query set, §5.3 multi-granularity context builder, and §5.4
extraction prompt once the calc layer lands.
