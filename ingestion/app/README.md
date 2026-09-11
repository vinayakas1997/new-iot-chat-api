# Ingestion app (isolated)

Setter-plane console + API for the ingestion platform (F1–F5).
Runs standalone now; merges into the bigger app later (routes are namespaced
`/api/ingest/*`, frontend mounts as `/setter/*`).

## Layout

- `backend/` — Fastify API (port `3100`): SQLite setter store, postgres+mysql
  drivers, connection poller. `STORE_PATH` env selects the SQLite file
  (default `./data/setter.db`).
- `frontend/` — React console (port `3101`, proxies `/api` → backend):
  dark-first shell per `../feature-definition/00-design-rules.md`.

## Services (`docker-compose.yml`)

| Service | URL | What |
|---|---|---|
| Console (frontend) | http://localhost:3101 | setter UI |
| API (backend) | http://localhost:3100 | `/api/ingest/*` |
| test-postgres | localhost:5432 | plant `plant` / user `plant` / pw `plant`; seeded `readings_temp`, `prod_count`, `downtime_events`. From F1 use host `test-postgres` in-compose. |
| hindsight API | http://localhost:8888 | memory service (`/health` live) |
| hindsight UI | http://localhost:9999 | Control Plane (F5 deep link) |

Hindsight memory ops need an LLM: copy `.env.example` to `.env` and set
`HINDSIGHT_API_LLM_API_KEY` (or point `HINDSIGHT_API_LLM_BASE_URL` at your
local LLM). Without it, health + UI work, retain/recall fail. Contract:
`../feature-definition/07-hindsight-contract.md`.

## Run (local dev, no docker)

```sh
cd backend && pnpm install && pnpm dev    # :3100
cd frontend && pnpm install && pnpm dev   # :3101
```

## Run (docker)

```sh
docker compose up -d --build
```

Env knobs: `STORE_PATH` (SQLite file), `POLLER_INTERVAL_MS` (connection
checks), `TICK_INTERVAL_MS` (default 5 min), `TICK_ENABLED=false` (disable
the tick engine), `PORT`, `LOG_LEVEL`. `POST /api/ingest/tick` triggers a
tick on demand.

## Environment quirk (do not "fix" by upgrading blindly)

This box runs a custom Node 18 (ABI **109**, not stock 108), so
`better-sqlite3`'s prebuilt binary never loads. `backend/scripts/rebuild-sqlite.sh`
rebuilds it against `/usr/include/node` headers; it runs automatically as
`postinstall` and via `pnpm run build:sqlite`.
