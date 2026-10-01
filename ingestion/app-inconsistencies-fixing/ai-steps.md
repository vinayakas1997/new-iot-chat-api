# AI steps — roles (AI1 / AI2 / AI3)

## AI1 — Feature surface
Owns the chart, the table, and the question lifecycle: creates opening
questions (generator: open tickets, breach readings, unread cards) and ends
them (force-close at shift/day/month end with reason + worth).

## AI2 — Support for AI1, resolves time
Owns time resolution: windows (`{{from}}`/`{{to}}`), hourly buckets,
shift-day attribution (night 00–11h → prior day), grain. Writes and repairs
the SQL that answers AI1's questions (ask loop, max 3 attempts).

## AI3 — Analyzes the open-ended answers
Owns analysis + verdict: reads results (chart/table readings), checks
grounding, and files each answer via Gate-2 — file / merge / drop / close —
always with a reason. Only grounded, worth-it facts reach Hindsight.
