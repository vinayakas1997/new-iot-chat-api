# Dry-run grades (qwen36-35B, temperature 0.2) — context-step-1

## Trial A — hourly breach day (vision) → PASS
- breach true, peak 28.5, peakAt 17:00 (labeled tick; 17:20 actual, stats cited it)
- 02:00 dip cited as recalibration; no invented quirks; crossCheck references warn line
- Minor: dip listed as anomaly without explicit "ignored" word — acceptable.

## Trial B — daily line (vision) → PASS WITH FINDINGS (fixed in B2)
Findings: (1) peakAt "09:16" — date stuffed into a time field (schema had no
date timing); (2) partial-day last bucket (09-20, 8/24 pts) trend-read as decline.
Fixes applied: peakDay/binRange fields + at-between forbidden on histograms +
bucketNote envelope field + never-trend-read-partial-bucket rule.

## Trial B2 — daily re-run after fixes → PASS
- peakDay "2026-09-16", peakAt null; partial 09-20 bucket explicitly flagged;
  ticket 3 keep-open with improved reason; zero filler questions.

## Trial C — histogram (vision) → PASS WITH FINDINGS (fixed in contract)
- Shape right-skewed, peak ~22, hot tail 28.5, no trend language, breach correctly
  refused on counts. Finding: between ["28:00","29:00"] — times used for bins.
  Fixed by binRange rule in system.txt (at/between forbidden on histograms).

## Trial D — step-2 grounding (text) → PASS
- {"peak": 28.5, "peakAt": "17:20", "breach": true, "confirmed": true} + faults-5
  cross-series note, confidence 1.0. Identity echo added to step2 prompt.

## Verdict
Vision loop reads charts genuinely: breach found at 17:00/28.5 unprompted,
daily avg correctly NOT breached, histogram not trend-read, tickets kept open
with reasons, zero invented quirks across 5 calls. Prompt + envelope contract
in this folder is proven — safe to build transport, snapshot service, reading
job, and tickets table against it verbatim.
