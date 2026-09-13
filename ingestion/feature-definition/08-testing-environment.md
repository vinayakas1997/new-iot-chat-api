# 08 — Testing Environment (SQL Playground)

Status: **built** (2026-09-13)

## What it is

A SQL workbench embedded in the Cards screen (third tab) where the setter can
freely write and execute read-only queries against any line's connection —
before or after creating cards. Think of it as the "lab" around the card
lifecycle.

## Design decisions (sensible defaults, override later)

- **Member-table boundary**: queries are scoped to the line's member tables.
  A heuristic FROM/JOIN table-reference check catches the common case without
  a full SQL parser. Unrecognized references are rejected with a clear error.
- **Row cap**: 100 rows max per result (preview mode). Full resultsets go to
  the extraction engine, not the UI.
- **Timeout**: 30s default (matches card-test behavior).
- **History**: every executed query (success or failure) is recorded per line
  (most recent first, 20 entries). Click any history entry to reload its SQL
  into the editor.
- **Save-as-card**: one-click promote from playground result to a dormant card
  (name, tables, granularity, unit, extraction hint). The card starts dormant —
  test + activate per existing lifecycle.

## API surface

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/ingest/playground/run` | Execute SQL `{lineId, sql, from?, to?}` → `{columns, rows, rowCount, capped, durationMs, sql}` |
| GET | `/api/ingest/playground/history/:lineId` | Recent queries for a line |
| GET | `/api/ingest/playground/columns/:lineId` | All columns across member tables (for axis pickers) |

## UI location

Cards screen → third tab "Playground" (co-located with card testing so the
setter can iterate between free-form queries and card promotion).

## Open items

- The column-reference check is a heuristic — complex CTEs or subqueries may
  reference tables outside the member set. A full SQL parser would close this
  gap but is overkill for v1.
- Row cap is hard-coded at 100. Could be configurable per-line later.
