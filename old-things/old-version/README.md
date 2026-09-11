# Industrial RAG Chatbot

RAG chatbot for a manufacturing line. Plant data in Postgres → ingestion pipeline
extracts facts into **Hindsight** (vector + graph + temporal memory) → backend API
serves a chat UI that recalls those facts and falls back to live SQL → a per-user
report scheduler runs daily condition checks. See [plan.md](plan.md) and
[implementation-plan.md](implementation-plan.md) for the full design.

## Layout (pnpm monorepo)

| Package | What |
|---|---|
| `packages/shared` | Locked Fact schema (zod) + API contract types |
| `apps/api` | Backend API — auth, chat (streaming + tools), schedules, history, settings, ops |
| `apps/ingest` | Job 1+2 combined — SQL fetch → context build → fact extraction → retain (stubbed input) |
| `apps/scheduler` | Job 3 — per-user report scheduler, ticks every minute |
| `apps/web-user` | User UI — React/Vite/Tailwind, chat + schedule + history, elegant depth theme |
| `apps/web-ops` | Ops dashboard — job health, retry, scheduler status (internal auth) |

## Runtime modes

`RUNTIME_MODE=mock` (default) runs with **zero external services**: a fixture plant
DB, a deterministic offline LLM, and a file-backed fake Hindsight
(`.mock-hindsight.json`). `RUNTIME_MODE=live` wires the real Postgres, Claude
(`ai` + `@ai-sdk/anthropic`, optional deps), and a Hindsight server over REST.

Only the **app store** (our Postgres: users, schedules, history, job runs) is always
real — point `APP_DATABASE_URL` at the local docker Postgres.

## Quick start (mock mode)

```bash
corepack enable pnpm            # or: npm i -g pnpm
pnpm install
cp .env.example .env            # defaults are fine for mock mode

docker compose up -d app-postgres
pnpm db:migrate
pnpm db:seed-user -- --username demo --password demo12345

pnpm dev:api                    # :3001
pnpm dev:web-user               # :5173  (proxies /api -> :3001)
pnpm job:ingest                 # one-shot: populates the mock memory store
pnpm dev:scheduler              # optional: fires due reports every minute
```

Ops UI: set `OPS_PASSWORD_HASH` in `.env` to an argon2 hash, then `pnpm dev:web-ops`
(:5174). Generate a hash:

```bash
pnpm --filter @app/api exec tsx -e "import('argon2').then(a=>a.default.hash('yourpw',{type:a.default.argon2id}).then(console.log))"
```

## Going live

1. `RUNTIME_MODE=live` in `.env`.
2. `MACHINE_DATABASE_URL` → your plant Postgres (read-only role).
3. `ANTHROPIC_API_KEY` (+ `pnpm --filter @app/api add ai @ai-sdk/anthropic` if the
   optional deps weren't installed).
4. `docker compose --profile live up -d` to bring up Hindsight + its Postgres;
   set `HINDSIGHT_LLM_API_KEY`. Verify the REST paths in
   `apps/api/src/hindsight/http-hindsight.ts` match your Hindsight version.
5. Replace the Phase-10 stubs (`apps/ingest/src/sql`, `context`, `extract`) with the
   real query set once the calc layer lands.

## Verified in mock mode

`pnpm -r typecheck` clean · login/session · schedule NL-parse + cron + nextRunAt
(tz-correct) · streaming chat with `recall_memory` + `live_sql` tools · ingestion
(3 rows → 9 facts retained) · report run (recall → pure-logic evaluate → draft →
history) · ops login + job status + spawn-ingest · both UIs build.
