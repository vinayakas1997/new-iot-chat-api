# Autonomous loop v1 — rounds log (line-12)

Generator: rules-v1 (`POST /api/ingest/loop/propose`). Solver: ask (debugTrace).
Filing: tickets API. Runner: `rounds/run-round.py`.

## Round 2026-09-30T090518Z — 1 proposal
- unread-card (card-munsleft, no readings) → round, 22 rows → FILED ticket #1.

## Round 2026-09-30T090550Z — 2 proposals
- open-ticket #1 → handoff (ok=false, rows null) → **BUG: closed as resolved**.
  Runner v1 treated any type=round as success. Fixed in runner v2
  (handoff → HANDOFF verdict, ticket stays open).
- unread-card → round, 22 rows → FILED ticket #2 (duplicate of #1's topic —
  generator had no dedupe. Fixed: claimed-sourceRef set vs open tickets).

## Round 2026-09-30T090744Z — 1 proposal (fixes live)
- open-ticket #2 → round, 22 rows, coherent reply → CLOSED #2 as resolved. Clean.

## Termination fix
Coverage re-proposed the same card every round (ask rounds don't create
readings). Fixed: closed `[loop]` tickets also claim their sourceRef.
Verified: propose → 0 proposals, 0 open tickets. Loop terminates.

## Correction
Ticket #1's note ("LOOP-RESOLVED ... 3 tries used") is wrong — it was a
handoff, recorded here. No reopen API exists; the correct record is this file
+ rounds.jsonl. If a reopen route is wanted, that's a separate small change.

## State
open: 0, total: 2. Next round triggers only on: new open ticket (manual or
breach reading), new card, or new breach reading.
