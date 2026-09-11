# F1 — Database Connections

## Aim
Let the setter (builder) connect the ingestion platform to any plant database,
verify the connection works, keep watch on its health, and browse its tables
and columns — all from a dedicated UI, without touching code or the running
pipeline.

## Definition
A **database connection** is a named, stored record describing how to reach one
source database: label, type (`postgres` | `mysql`), host, port, database
name, username, password, plus optional schema filter and timeout. Connections
are **data, not code**: the pipeline reads them at each tick, so adding or
switching a database never requires a redeploy. Multiple connections coexist
(more sources can arrive at any time); each registered line (F2) binds to
exactly one of them.

**Driver interface.** All features work against one `db-driver` port with two
implementations (`postgres`, `mysql`). Nothing above this layer knows which
database type it talks to.

**Storage.** Connection records (including passwords) live in the app's own
small **SQLite DB** — serverless, zero infra, fits the sole-user setup. SQLite
is the store for the whole setter plane (F1 connections, F2 registry, F3 card
definitions).

The connections UI supports:
- **Add / edit / disable** a connection (Postgres and MySQL from day one).
- **Test** a connection: one click → read-only probe (connect + list tables)
  → success with table count, or the exact error message. Test never saves;
  saving is a separate explicit action. Nothing is ever written to the source.
- **Browse** the connection: table list, columns per table with types and
  nullability, row counts, primary keys, and a few sample rows. This is the
  palette the context-component cards (F3) pick their source table and columns
  from.
- **Poller**: a lightweight background checker continuously verifies each
  stored connection and writes to the logs the moment one fails (which
  connection, when, what error). Silent when healthy, loud in the logs when
  not. Interval tunable.

## Lifecycle rules (locked)
- Deleting a connection is **blocked** while any registered line is bound to
  it (rebind or deregister the lines first).
- Editing a connection shows a **warning** that bound lines are affected.
- Deregistering a line never deletes the connection; disabling a connection
  stops ingestion for its lines at the next tick (fail loudly in logs, don't
  silently skip).

## Read-only discipline (locked)
Trust + document: setters connect with a read-only DB user as a documented
practice. No privilege enforcement at Test time (option (b) remains available
if plant IT ever audits).

## In scope
- Postgres + MySQL connection CRUD, test, browser, and health poller.
- SQLite setter-plane store (shared with F2, F3).
- Exactly one connection binding per registered line (F2 owns the binding).

## Out of scope
- Writing anything to the source database (ingestion only ever reads).
- Query editing (that belongs to F3 component cards).
- Authentication on the UI (sole-user setup; no login gates).

## Open points
- Poll interval default (proposal: every 5 minutes) — locked at build time.
- Sample-row cap (proposal: 20 rows) — locked at build time.
