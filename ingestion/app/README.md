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

## Run

```sh
cd backend && pnpm install && pnpm dev    # :3100
cd frontend && pnpm install && pnpm dev   # :3101
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
