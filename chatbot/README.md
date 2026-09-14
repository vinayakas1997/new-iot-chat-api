# RAG Console (chatbot plane)

Chat + scheduled briefings for your IoT ingestion pipeline.
Runs standalone next to `ingestion/app/` — merges later.

## Layout

- `backend/` — Fastify API (:3200): own SQLite (`rag.db`), RAG core
  (Hindsight recall + live SQL via ingestion + stored graph specs),
  session CRUD, schedule CRUD, report store, cron scheduler.
- `frontend/` — React console (:3201): F6 Chat, F7 Schedules, F8 Briefings.
  Proxies `/api` → backend.

## Services

| Service | URL | What |
|---|---|---|
| Console (frontend) | http://localhost:3201 | RAG UI |
| API (backend) | http://localhost:3200 | `/api/rag/*` |
| Ingestion setter | http://localhost:3101 | F1–F5 (unchanged) |
| Ingestion API | http://localhost:3100 | lines, cards, graphs, LLM, playground |

## Run (local dev, no docker)

```sh
# Terminal 1: backend
cd backend && pnpm install && pnpm dev    # :3200

# Terminal 2: frontend
cd frontend && pnpm install && pnpm dev   # :3201
```

## Run (docker)

```sh
docker compose up -d --build
```

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `RAG_STORE_PATH` | `./data/rag.db` | SQLite file for sessions/schedules/reports |
| `INGEST_BASE_URL` | `http://localhost:3100` | Where ingestion API lives |
| `HINDSIGHT_BASE_URL` | *(auto from ingestion)* | Override Hindsight URL |
| `LLM_BASE_URL` | *(auto from ingestion F6)* | Override LLM endpoint |
| `LLM_MODEL` | *(auto)* | Override active model |
| `LLM_API_KEY` | *(auto)* | Override LLM key |
| `SCHEDULER_ENABLED` | `true` | Set `false` to disable cron |
| `PORT` | `3200` | Backend port |
| `LOG_LEVEL` | `info` | Logging verbosity |

## How it works

**Chat (F6):** pick line(s) → ask → backend runs: Hindsight recall → optional
live SQL via ingestion playground → chart from stored spec (or heuristic) →
LLM synthesis → NDJSON stream to frontend. Inspector panel shows chart +
sources beside the conversation.

**Schedules (F7):** create a job: name + line + questions (one per line) +
format + time (e.g. 08:30 IST). Cron runs every minute, matches HH:MM, runs
same RAG pipeline unattended, stores report.

**Briefings (F8):** pick job + date → see that day's report with headline,
KPI cards, charts, per-question breakdown. Yesterday = one click.
