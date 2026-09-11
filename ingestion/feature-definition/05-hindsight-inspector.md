# F5 — Hindsight Status Page (read-only)

## Aim
Show whether the Hindsight AI is live or not, and hand off to its own UI for
deep inspection — instead of rebuilding bank browsers and lineage views inside
this app.

## Definition
The Hindsight page is a thin, **strictly read-only** screen with exactly two
jobs:
1. **Status** — is Hindsight live: reachable / unreachable, latency, last
   successful write time, and last error. "Live" means *working*, not just
   pingable.
2. **A button** — opens the Hindsight AI's **own UI page** (deep link), where
   bank contents, sample facts, and lineage are inspected natively.

The Hindsight UI URL is stored as a **setting** (per environment), never
hardcoded.

The lineage stamp on facts (`cardName + cardVersion + lineId + connectionId`,
defined in F3) still stands — Hindsight's own UI reads it there.

## In scope
- Health check (reachability, latency, last write, last error).
- Configurable deep-link button to Hindsight's own UI.

## Out of scope
- Bank overview, sample-fact browser, and lineage trace inside this app
  (retired scope — lives in Hindsight's own UI).
- Editing cards or re-running ingestion (F3 owns changes).
- End-user visibility: setters only.

## Open points
- None.
