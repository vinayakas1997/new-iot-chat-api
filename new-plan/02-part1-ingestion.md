# 02 — Part 1: SQL -> Context -> Extraction -> Hindsight Ingestion

> Scope: everything BEFORE the user asks. Goal: Hindsight contains clean,
> granularity-tagged facts so chat recall is accurate.

## 1. End-to-end flow (how it works)

```
fetchNewRowsSince(checkpoint)          -- SQL, status='new' LIMIT 500
  -> markRowsAsPicked(rowIds)          -- status='new' -> 'pending' (before LLM!)
  -> buildAllUnits(rows)               -- split into per-granularity ContextUnits
  -> for each unit: extractFacts(unit) -- LLM + zod validate + heuristic fallback
  -> getBankId({lineId})               -- "line:<id>"
  -> hindsight.retain(bankId, facts)   -- await confirm (async:false)
  -> markRowsAsIngested(rowIds)        -- status='pending' -> 'ingested' (only after retain)
  -> record job_runs {started, finished, status, pendingAfter}
```

**Crash-safety rule (why this order?):** if the process dies mid-LLM or mid-retain,
rows stay `pending` and are retried next run. Nothing is silently skipped or
double-counted. The reverse order (flip flag then write) would lose data on crash.

Fresh files:

```
apps/ingest/src/
  index.ts          # one-shot entrypoint (called by cron / manual trigger)
  pipeline.ts       # orchestration above
  checkpoint.ts     # last_checkpoint value (ISO timestamp)
  sql/queries.ts    # all SQL (Section 2)
  sql/row-types.ts  # ProductionRow, EventRow, HourlyRow types
  context/build.ts  # unit builders (Section 3)
  extract/prompt.ts # fact-extraction system prompt
  extract/extract.ts# LLM call + retry + heuristic fallback
  extract/validate.ts # zod check via packages/shared Fact schema
```

## 2. SQL query set (what + why each exists + where)

Connection layer first — `apps/api/src/db/machine-db.ts`:

- `getPool()` — `pg.Pool` with pool size, `statement_timeout`, connect timeout.
- `checkDbConnection()` — `SELECT 1` ping at job startup + ops health check.
- `executeQuery(sql, params)` — parameterized only (`$1, $2`), retry 3x on transient
  codes (`57P01/53300/08006`), hard timeout.
- **Concept reference:** DB-GPT `packages/dbgpt-core/src/dbgpt/datasource/rdbms/base.py`
  (`RDBMSConnector`: engine + pool + `MetaData.reflect` + `run/run_to_df`) and
  `packages/dbgpt-ext/src/dbgpt_ext/datasource/rdbms/conn_postgresql.py` (Postgres
  dialect). **Explanation:** DB-GPT abstracts every DB behind `BaseConnector`
  (`run, run_to_df, get_table_info, get_columns`). We port the **abstraction idea**
  (one `MachineDb` port with mock + pg implementations), not SQLAlchemy.
- Datasource registry idea from DB-GPT
  `packages/dbgpt-serve/src/dbgpt_serve/datasource/manages/connector_manager.py`
  (`get_connector(db_name)` with TTL cache) — we keep it simple: single pool singleton.

Queries (`apps/ingest/src/sql/queries.ts`) — one per granularity (full detail in
`03-granularity-matrix.md`):

| Function | SQL shape | Why needed |
|---|---|---|
| `fetchNewRowsSince(checkpoint)` | `SELECT * FROM production_rows WHERE status='new' AND ts > $1 ORDER BY ts LIMIT 500` | incremental pull, never full scan |
| `fetchRawEvents(machineId, window)` | `SELECT * FROM events WHERE machine_id=$1 AND ts BETWEEN $2 AND $3` | alarms/downtimes/quality as instant facts |
| `fetchHourlyBreakdown(lineId, date)` | `SELECT date_trunc('hour',ts) h, SUM(units_produced), AVG(oee), SUM(downtime_min) ... GROUP BY 1` | hourly trend graphs |
| `fetchShiftAggregates(lineId, date, shiftDef)` | same but `GROUP BY shift` (3x8h) | shift meetings talk in shifts, not hours |
| `fetchDailySummary(lineId, date)` | **independently queried** `... WHERE date=$1 GROUP BY line` — NOT summed from hourly | single source of truth for "daily" (open decision locked: independent) |
| `fetchWeeklyRollup(lineId, week)` | `GROUP BY week` | 7-day trend charts (optional v1) |
| `markRowsAsPicked / markRowsAsIngested` | `UPDATE production_rows SET status=$1 WHERE id = ANY($2)` | status-flag mechanics |

Fixture (trail v1): `mock-machine-db.ts` returns 3 sample rows shaped like `ProductionRow`
so the whole pipeline runs with zero external Postgres.

## 3. Context builder (why separate units per granularity?)

If hourly and daily numbers are blended into one blob, the LLM writes facts with the
wrong time-scope ("OEE was 72%" — over what period?). So each granularity becomes its
own `ContextUnit`:

```ts
ContextUnit = { lineId, machineId?, granularity, windowStart, windowEnd, rowIds[], text }
```

- `buildHourlyUnits(rows)` — group by line+hour, render text block with sums/avgs.
- `buildShiftUnits(rows, shiftDef)` — group by shift.
- `buildDailyUnits(rows)` — from daily query (independent).
- `buildEventUnits(rows)` — one unit per alarm/downtime with severity + duration.
- `enrich_with_metadata(unit)` — attach machine name, unit (°C, %, min), threshold,
  line hierarchy (plant > line > machine).
- `chunk_if_oversized(unit)` — split before LLM context limit.

Fresh file: `apps/ingest/src/context/build.ts` (+ `shift.ts` for shift definitions).

## 4. Fact extraction (LLM turns prose into locked facts)

Locked contract — `packages/shared/src/fact-schema.ts` (`FACT_SCHEMA_VERSION = 1`, zod):

```ts
Fact = { schemaVersion: 1, statement, entities[1..], timeScope{granularity,start,end?},
  metric?{name,value,unit?,aggregation}, event?{kind,severity,durationMin?},
  source{queryName,rowIds[],checkpoint?}, confidence=0.8, tags[] }
```

- `factExtractionSystemPrompt()` (`extract/prompt.ts`) — defines what counts as a fact,
  entity types (machine/line/metric/threshold/event), exact JSON output `{facts[]}`.
  **Lock early — everything downstream (retain/recall/evaluate/charts) depends on it.**
- `extractFacts(unit)` (`extract/extract.ts`) — LLM `complete()` with that prompt,
  2 attempts (second = stricter re-prompt), `FactExtractionOutput.parse()` via
  `extract/validate.ts`. On total failure → deterministic `heuristicFacts()` fallback
  (regex OEE/downtime/scrap from `unit.text`, `confidence:0.9`) so pipeline never stalls.
- **Concept reference:** DB-GPT skills-as-prompts (`skills.py` progressive disclosure +
  `skills/csv-data-analysis/SKILL.md`). **Explanation:** DB-GPT injects skill metadata
  into the prompt and loads full `SKILL.md` on demand. We port the **pattern** for plant
  procedures: fresh `skills/line-oee/SKILL.md` (thresholds, OEE formula, downtime taxonomy)
  is prepended to the extraction prompt. See `06-dbgpt-reference.md` §7.

## 5. Hindsight retain (why bank per line?)

- `getBankId({lineId})` (`apps/api/src/hindsight/bank.ts`) — `per-line` scheme
  (`line:<id>`), overridable via `HINDSIGHT_BANK_SCHEME` env. **Decide once.**
- `retainFacts(bankId, facts)` (`retain.ts`) — REST `POST /v1/banks/{bank}/retain`,
  per-fact `{content: statement, timestamp, tags: [granularity, schema:1, ...], metadata}`.
  `async:false` so ingestion waits for confirm.
- Mock: `mock-hindsight.ts` (in-memory + shared `.mock-hindsight.json` file, keyword-overlap
  recall). Live: `http-hindsight.ts` (`GET /health`, `POST .../retain|recall|reflect`).
  **Verify REST paths against your Hindsight version before going live.**

## 6. Verify Part 1 (done = ?)

1. `pnpm job:ingest` with fixture: 3 rows → units (hourly+daily+events) → 9 facts retained.
2. `recall("OEE line-3", granularity:"daily")` returns the daily fact, not hourly.
3. Kill process mid-retain → rows stay `pending` → next run retries, no duplicates.
4. `job_runs` row: `{job:'ingest', status:'ok', pendingAfter:0}` visible in ops.
