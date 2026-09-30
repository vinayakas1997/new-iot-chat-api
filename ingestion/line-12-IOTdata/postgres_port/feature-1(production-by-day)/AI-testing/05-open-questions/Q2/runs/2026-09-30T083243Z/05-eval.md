# Eval — Q2 baseline 2026-09-30T083243Z — PARTIAL (4/5)

Question: peak hour 2026-08-04 day shift + day total.
Gold: peak 17:20 (177), total 1061, 10 hourly slots.
Got: best_hour=17:20, hourly_qty=177, daily_total=1061 — numbers exact, but as
ONE summary row, not the 10-row hourly shape. Reply text empty (numbers live
in the sample/table only).

1. filters — PASS (right table/shift/timing/cast)
2. numbers — PASS (17:20 / 177 / 1061 exact)
3. shape — PARTIAL (summary row; hourly breakdown missing, shape unverifiable)
4. no-hallucination — PASS
5. window-cited — PARTIAL (window in prompt; empty reply names nothing)

Finding: solver minimized to best+total. For trend/shape questions the prompt
should demand full-grain rows, not aggregates. Candidate steer for template
extractHint: "return full hourly rows; never collapse to best/total only."
Human verdict: PARTIAL — numbers trustworthy, shape insufficient.
