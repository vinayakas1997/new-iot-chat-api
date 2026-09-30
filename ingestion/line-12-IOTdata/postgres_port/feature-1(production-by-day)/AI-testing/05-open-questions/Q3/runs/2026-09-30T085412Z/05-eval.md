# Eval — Q3 round2 2026-09-30T085412Z (ask-v3) — PARTIAL (up from FAIL)

Rule 14 worked: solver chose run_sql (was explain), DISTINCT seisan_jikantai,
22 rows, gate pass. No 12:xx among them — claim now evidence-backed.

BUT new filter slips (honest log):
- SQL uses literal timestamps on TEXT hiduke (no to_timestamp, no {{from}}/{{to}}) — violates Rule 4; string comparison happened to work.
- Missing chuyakin filter — 22 rows mix night buckets (01:20–10:20) with day;
  gold day-shift list is 10 slots. Reply (1 sentence) states no conclusion.

1. filters — PARTIAL (right table/timing; literals + missing shift filter)
2. numbers — N/A 3. shape — PASS (DISTINCT evidence, no 12:xx)
4. no-hallucination — PASS (grounded in output) 5. window-cited — PARTIAL

Finding: static gate checks readonly + member tables only — not placeholder use
or shift-filter presence. Candidate: gate warnings (not blocks) for literals on
time columns / missing chuyakin on ryohin tables.
Human verdict: PARTIAL — evidence now exists; filter discipline regressed.
