# Eval set v1 — open-ended questions (FROZEN)

Frozen 2026-09-30. Never edit in place — new understanding becomes v2.
Line: `line-12` (member tables `line12_august.stg_ryohin` + seisan_jisseki + ijo).
Template version at freeze: check `tpl-munsgmtn` current version when scoring.

Each question file: question text, fixed window, gold SQL, expected values,
must-use filters, must-never rules, scoring rubric (5 dimensions, pass/fail each).

Scoring dimensions (same for all):
1. filters — correct table/columns/shift/timing/quantity-column
2. numbers — match gold expected values exactly
3. shape — hourly rows / structural claims correct
4. no-hallucination — every timestamp/number appears in query output or window
5. window-cited — answer names its day window; no cross-day leakage
