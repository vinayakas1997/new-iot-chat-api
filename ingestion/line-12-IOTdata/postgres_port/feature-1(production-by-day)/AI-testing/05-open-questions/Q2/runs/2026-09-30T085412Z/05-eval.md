# Eval — Q2 round2 2026-09-30T085412Z (ask-v3) — PARTIAL (shape again)

Got: 1 summary row (17:20 / 177 / 1061) + non-empty reply naming day shift 2026/08/04.
Reply improved vs baseline (empty → descriptive); shape unchanged (no hourly rows).

1. filters — PASS 2. numbers — PASS (exact) 3. shape — PARTIAL (summary only)
4. no-hallucination — PASS 5. window-cited — PASS (reply names 2026/08/04 day shift)

Finding: the grain sentence in ask-v3 moved the reply but not the SQL shape.
Solver still minimizes. Next lever (not more prompt text): validator-side shape
check — trend/peak questions should return >1 bucket row, else flag "collapsed".
Human verdict: PARTIAL — numbers trustworthy, shape insufficient (unchanged).
