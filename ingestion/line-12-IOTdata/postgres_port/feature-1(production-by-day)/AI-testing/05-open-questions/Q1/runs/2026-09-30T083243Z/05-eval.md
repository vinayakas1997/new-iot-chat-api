# Eval — Q1 baseline 2026-09-30T083243Z — PASS (5/5)

Question: rework 2026-08-19 day shift, split by model.
Gold: 27→0, 28→0, 29→28, total 28. Got: identical (sample rows 27/0, 28/0, 29/28).

1. filters — PASS (stg_ryohin, 昼勤, 時間チェック, 27/28/29, cast SUM)
2. numbers — PASS (0/0/28 exact)
3. shape — PASS (per-model rows)
4. no-hallucination — PASS (all values from query output)
5. window-cited — PASS (08-19 window, no 08-04 leakage)

Validator trace (02b): attempt1 failed-retry [execute/unknown = SUM(text)] →
attempt2 rows-ok, gate pass. Solver + validator both visible — the gap fix works.
Human verdict: PASS, no action.
