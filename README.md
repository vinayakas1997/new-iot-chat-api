# Industrial RAG Chatbot (fresh build)

User never touches the data source. Internally: SQL → context → AI extract →
Hindsight (vector + graph + temporal). User asks → summary + calculated graph.

Full system design lives in [`new-plan/`](new-plan/README.md) — read in order
`00-overview → 08-open-decisions`. Previous trail code is frozen in
[`old-version/`](old-version/README.md) for reference only.

## Layout (pnpm monorepo)

| Package | What |
|---|---|
| `packages/shared` | Locked Fact schema v1 + Chart schema (zod) + API contract types |
| `apps/api` | Backend API — auth, chat (summary + charts envelope), schedules, history, settings, ops |
| `apps/ingest` | SQL fetch (hourly/shift/daily) → context build → fact extraction → retain |
| `apps/scheduler` | Per-user report scheduler, ticks every minute |
| `apps/web-user` | User UI — React/Vite/Tailwind, chat + graphs + schedule + history |
| `apps/web-ops` | Ops dashboard — job health, retry, scheduler status (internal auth) |
| `skills/line-oee` | Plant skill (SKILL.md) — OEE formula, thresholds, downtime taxonomy |

## Runtime modes

`RUNTIME_MODE=mock` (default): fixture plant DB + offline LLM + file-backed fake
Hindsight. `RUNTIME_MODE=live`: real Postgres + Claude + Hindsight server over REST.

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
