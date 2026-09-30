# Eval — Q3 baseline 2026-09-30T083243Z — FAIL grounding (2/5)

Question: why no 12:xx bucket + which day do night 00–11h rows belong to.
Got: type=explain, NO SQL executed. Answer text structurally correct (lunch gap,
kinmu_hidukejiku prior-day rule) but cited from column meanings only — the claim
"no 12:xx rows exist in the data" was never verified by a query.

1. filters — N/A (no query; PASS-by-vacuity not awarded)
2. numbers — N/A (none claimed)
3. shape — FAIL (no DISTINCT-slot evidence; gold slot list unproduced)
4. no-hallucination — FAIL (true-but-unverified data claim)
5. window-cited — PARTIAL (rules stated, window unnamed)

Finding (real gap): solver chose `explain` for a checkable question. Close-rule
questions must prefer `run_sql` (DISTINCT seisan_jikantai) before explaining.
Candidate: strengthen ASK_SYSTEM — "verifiable claims require run_sql first;
explain is for meaning, not for data assertions."
Human verdict: FAIL grounding — correct text, zero evidence.
