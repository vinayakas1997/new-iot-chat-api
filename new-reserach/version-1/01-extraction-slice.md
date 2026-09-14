# 01 — Extraction Slice

**Version:** v1 (pre-built)
**Depends on:** nothing (first milestone)
**Enables:** chat memory (workstream 03)

## Problem

The ticker executes each live card every interval and records a run, but the
facts are thrown away — `factsStored` is hard-coded to `0`
(`ingestion/app/backend/src/ticker.ts`). Hindsight therefore has nothing to
recall, and chat can only ever answer from live SQL.

## What to build

For each successful tick row set:

1. **Extract** — send the rows + `card.extractHint` + `card.unit` to the active
   LLM and get back structured facts (short natural-language statements with a
   measure, value, and optional breach flag).
2. **Retain** — write facts to the line's bank:
   - `POST /v1/default/banks/bank:line-<lineId>/memories`
   - body `{ items: [{ content, timestamp, tags, metadata }], async: false }`
   - bank id URL-encodes the colon.
3. **Stamp** each fact with lineage tags (below) and count it into
   `factsStored` on the run row.

The extraction must run **once per card result set**, not once per row, to keep
LLM calls bounded.

## Tag / metadata schema (proposed, needs approval)

Tags (filterable in recall):

```
line            e.g. line-smoke
card            e.g. Smoke hourly temp avg
cardVersion     e.g. 2
connectionId    e.g. conn-xxxx
measure         e.g. avg_temp_c
unit            e.g. °C
granularity     e.g. hourly
breach          true | false   (value crossed card.threshold)
```

Metadata (not used for filtering): window `{from, to}`, `samples`, `sqlHash`.

Rationale: `measure` + `unit` let recall answer "temperature facts" precisely;
`breach` lets chat answer "was it abnormal?" without re-running SQL. Storing
these once at ingest is the "store the tag" decision from the architecture
discussion.

## Prompt shape (sketch)

System: "You extract durable plant facts from one card's hourly result. Emit
one short sentence per bucket. Include measure name, value, unit, and whether it
breached the threshold. JSON only."

User: card name, unit, threshold, `extractHint`, and the rows.

## Verify

- After a tick: `factsStored > 0` on the run row (visible in F4 History).
- Recall is non-empty for a measure the card produces. Note: empty recall right
  after a write may be consolidation lag, not a failed write — re-check after a
  short wait (see the Hindsight contract).
- Re-running the same window is idempotent enough not to duplicate facts
  unboundedly (needs a dedup key proposal).

## Files likely touched

- `ingestion/app/backend/src/ticker.ts` — call extractor after query.
- New `ingestion/app/backend/src/extract.ts` — prompt + parse + retain.
- `ingestion/app/backend/src/routes/hindsight.ts` — reuse retain helper.
- `ingestion/app/backend/src/db/store.ts` — store `factsStored`, dedup keys.

## Open items

- Which model extracts (active LLM, or a fixed extractor model)? Cost per tick
  matters at 100+ lines.
- Dedup strategy: `(bank, cardId, window, measure)` so re-ticks do not pile up.
- Failure policy: if Hindsight is down, do we hold rows and retry, or drop and
  record the failure? (Hindsight crash-loops if the LLM is dead at boot.)
- Does `extractHint` need editing to require `measure` / `breach` tags? This
  changes existing templates.
- Backfill: do we re-extract history once, or only forward from enabling?
