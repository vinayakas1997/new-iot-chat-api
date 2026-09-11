# F2 — Production Line Registration

## Aim
Decide explicitly which production lines belong to the ingestion pipeline, and
bind each one to a database connection (F1) plus its member tables — so the
pipeline always knows *what to ingest for whom*, and unregistered lines receive
nothing.

## Definition
A **registered line** is a setter-defined grouping (the plant DB carries no
line keys — it just has tables). The record holds: a stable identifier given
by the setter (e.g. `line-1`), a display name, a binding to exactly one F1
database connection, and its **member table list** (1 table, or 4–5 tables
grouped — whatever reality is). The same source table may belong to more than
one line with no conflict. All of a line's tables come from its single bound
connection.

Registration is the gate: only registered lines are picked up by the cron
tick, get context cards assigned (F3), accumulate history (F4), and own a
Hindsight bank (F5).

The registry UI supports:
- **Register** a line (identifier, name, connection binding, member tables
  picked from the F1 table browser).
- **Edit** a line (rename, rebind connection with warning, add/remove tables).
- **Deregister** a line: stops future ticks (visibility of past data deferred
  to post-v1 — see Open points).
- **Search + filter**: by DB connection and by table name (e.g. "which line
  owns `readings_temp`?").

## Lineage stamp (locked)
Every stored fact carries `connectionId` in addition to `cardName +
cardVersion + lineId`, so moving a line to another connection never silently
changes the meaning of old facts (the switch stays visible via fact lineage
in Hindsight's own UI, reached through F5's link).

## Line health (locked)
Each registry record keeps a **last-successful-tick** timestamp. Lines quiet
longer than N hours surface as warnings in F4 (a dead sensor must not look
like a healthy idle line).

## Unassigned-table nudge (locked)
Each tick logs source tables that belong to no registered line
("`vibration_raw` exists but is unassigned — register?"). Heads-up only, never
auto-registration.

## In scope
- Line CRUD plus connection binding plus member-table grouping.
- Search/filter by connection and table name.
- Stable line identifiers used across F3 cards, F4 history, and F5 banks
  (`bank:line-<id>` convention).
- Storage in the shared SQLite setter-plane store (with F1, F3).

## Out of scope
- Defining *what* gets ingested per line (that belongs to F3 cards).
- End-user visibility: setters only; plant users never see this registry.
- Bulk/CSV registration (one-by-one in the UI for v1).

## Open points
- Deregister visibility: whether a deregistered line stays visible (badged)
  in F4/F5 with past data intact — decided post-v1, after v1 works.
