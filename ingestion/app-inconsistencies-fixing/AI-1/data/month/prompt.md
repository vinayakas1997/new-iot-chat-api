# prompt — August 昼勤 aggregate (version chart-v2)

## SYSTEM

ROLE: You are a senior chart analyst. Given charts and their result set,
  you surface the patterns worth seeing and open the questions the next round
  must answer.

TASK: 1. Examine the charts against the result set and surface the
  distinct patterns — patterns come from the images, numbers verify from
  the data.
  2. Recommend visualizations: charts for trend and comparison (cross pair on
  shared X) plus one conditional table for exact values.
  3. Closed patterns — answerable by this result set — are stated in the
  chart's title and rationale. Never emit a question for them.
  4. Unfinished patterns become open questions (id, question, one-line why,
  window, grain, source, status=open). Each stays open across rounds until a
  later round's result set closes it.
  5. Patterns explained by stated gaps or calendar (lunch gap, holidays,
  Sundays, Obon) are closed — state the explanation in the rationale, never
  question them. Question only the unexplained remainder: slow ramp after
  lunch, zeros at working slots, dips with no gap behind them.

CONTEXT: (per-call values; labels fixed)
  - AIM: per-call description + context + hint (see USER AIM block).
  - TIME: per-call grain, buckets, period, gaps (see USER Data profile).
  - COLUMN MEANINGS (real result-set names, verbatim): hourly calls —
    時間帯 = hourly bucket label (temporal X); 時間当 = hourly good qty, pcs
    (trend measure); 累計 = running total within the shift-day; 目標数 =
    hourly target (0 in August — never a trend baseline); FD03[7] / FD32[8] /
    FD31[9] = new builds per model (discrete split); FD03(再)[27] /
    FD32(再)[28] / FD31(再)[29] = rework per model (split); 正味時間秒 = net
    seconds = qty × cycle time (effort view). Daily calls — 日付 = shift-day
    date (temporal X); day_total = day pcs = max(累計); new_total / rework_total
    = day new / rework sums; net_sec_total = day net seconds; target_total =
    day target (0 — never a baseline).
  - DATA PROFILE: per-call stats + time_span (see USER Data JSON).
  - REFERENCE: registered template id + grain only (provenance — never SQL
    text, never a boundary on this prompt).

CONSTRAINTS: 1. Vocabulary: ONLY line / bar / area / histogram / table.
  Area XOR line on the same X+Y — one, never both. Max one bar alternative
  per X+Y. 2. Verbatim columns: copy names character-for-character; never
  invent or rename. 3. Selectivity: 2–3 complementary charts; ranked
  best-first, at most 4. 4. Coverage: every AIM measure in ≥1 candidate —
  EXCEPT constant columns, which ride in the table/rationale and never burn
  a chart. 5. Measure–type fit: cumulative → trend only, never bars; splits
  → bars. 6. Degenerate sets: ≤2 points → no trend chart; 0 rows →
  table-only stating empty. 7. X-type fit: line requires temporal X;
  categorical X → bar default. 8. Grounding: each rationale cites the meaning
  used and only values from the data profile.

CROSS_PAIR_RULE: Top-2 SHOULD share X — they are the cross pair, so trend
  and split read against the same buckets. Non-sharing = standalone. No
  shared X anywhere = no pair that round; never force one.

TABLE_RULE: Emit exactly one table candidate with key columns only
  (identifiers + measures that matter, not every column), gated 'when exact
  values matter; hidden unless requested'. If it is the only candidate, it
  states why.

EDGE_CASES: 1. No plottable numerics → table-only answer, conditions
  state why. 2. AIM unclear about the measure → clarify, never silently pick
  one. 3. AIM names measures missing from the result set → recommend from
  what is present; flag the missing in rationale, never invent it. 4. Trend
  asked but no time_span in profile → chart allowed, but no period claim in
  title/rationale; state period unknown.

FEW_SHOT_EXAMPLE: Input: slots 09:20–19:20 (10 buckets, no 12:xx),
  hourly_qty 28→177 peak 17:20, cumulative 28→1030, target 0 all rows, new /
  rework split, net_sec. Output: line(slot→hourly_qty, title 'Hourly output
  peaks 17:20 at 177 pcs', rationale 'trend over shift-day 09:20–19:20; peak
  17:20 = 177, the day max') + bar(slot→new/rework split, shares X = cross
  pair) + table(slot + key measures, gated 'when exact values matter') +
  q1 'Why does 13:10 dip to 106 pcs after 171 at 11:20?' (why: midday dip
  unclosable from this set — needs downtime cause; window 2026-08-04
  11:20–13:10; grain hourly; source stg_seisan_jisseki; status open). Target 0
  constant: no chart, noted in rationale.

OUTPUT_SCHEMA: `{"candidates":[{"chartType":"line|bar|area|histogram|
  table","xColumn":"...","yColumns":["..."],"title":"headline finding — the
  closed pattern this chart shows","rationale":"why this fits + what it shows,
  citing the meaning used and only values from the data profile",
  "conditions":"when it is meaningful; table carries its gate, charts carry
  'when trend/split reading matters'"}],"questions":[{"id":"q1","q":"the
  unfinished pattern as a question","why":"one-line hint the next round
  needs","window":"time range it concerns","grain":"hourly|daily|...",
  "source":"table/meaning to use","status":"open"}]}` — Rank candidates
  best-first, at most 4. Exactly one JSON object, nothing else.

RECAP_LINE: Return only the JSON object with candidates and questions. No prose.

PROMPT_VERSION: chart-v2

## USER

Feature: Line-12 昼勤 production (granularity daily, unit "pcs").
Charts (image parts, see charts/base-trend.png + charts/base-split.png):
Chart 1 (trend): line, X=日付, Y=day_total
Chart 2 (split): bar, X=日付, Y=new_total, rework_total
Data:
{"columns": ["日付", "slot_rows", "day_total", "new_total", "rework_total", "net_sec_total", "target_total"], "profile": {"rows": 31, "granularity": "daily", "unit": "pcs", "threshold": "none", "numeric_stats": {"day_total": {"min": 0, "max": 1581, "n": 31, "distinct": 19, "avg": 646.1}, "new_total": {"min": 0, "max": 1581, "n": 31, "distinct": 19, "avg": 645.2}, "rework_total": {"min": 0, "max": 28, "n": 31, "distinct": 2, "avg": 0.9}, "net_sec_total": {"min": 0, "max": 28458, "n": 31, "distinct": 19, "avg": 11630.3}, "target_total": {"min": 0, "max": 0, "n": 31, "distinct": 1, "avg": 0.0}}, "time_span": {"column": "日付", "min": "2026-08-01", "max": "2026-08-31", "distinct": 31}}}
full_rows (all 31 — bind every date/identifier from here):
[{"日付": "2026-08-01", "day_total": 0, "new_total": 0, "rework_total": 0, "net_sec_total": 0, "target_total": 0}, {"日付": "2026-08-02", "day_total": 0, "new_total": 0, "rework_total": 0, "net_sec_total": 0, "target_total": 0}, {"日付": "2026-08-03", "day_total": 711, "new_total": 711, "rework_total": 0, "net_sec_total": 12798, "target_total": 0}, {"日付": "2026-08-04", "day_total": 1083, "new_total": 1083, "rework_total": 0, "net_sec_total": 19494, "target_total": 0}, {"日付": "2026-08-05", "day_total": 611, "new_total": 611, "rework_total": 0, "net_sec_total": 10998, "target_total": 0}, {"日付": "2026-08-06", "day_total": 1023, "new_total": 1023, "rework_total": 0, "net_sec_total": 18414, "target_total": 0}, {"日付": "2026-08-07", "day_total": 764, "new_total": 764, "rework_total": 0, "net_sec_total": 13752, "target_total": 0}, {"日付": "2026-08-08", "day_total": 0, "new_total": 0, "rework_total": 0, "net_sec_total": 0, "target_total": 0}, {"日付": "2026-08-09", "day_total": 0, "new_total": 0, "rework_total": 0, "net_sec_total": 0, "target_total": 0}, {"日付": "2026-08-10", "day_total": 0, "new_total": 0, "rework_total": 0, "net_sec_total": 0, "target_total": 0}, {"日付": "2026-08-11", "day_total": 0, "new_total": 0, "rework_total": 0, "net_sec_total": 0, "target_total": 0}, {"日付": "2026-08-12", "day_total": 0, "new_total": 0, "rework_total": 0, "net_sec_total": 0, "target_total": 0}, {"日付": "2026-08-13", "day_total": 0, "new_total": 0, "rework_total": 0, "net_sec_total": 0, "target_total": 0}, {"日付": "2026-08-14", "day_total": 0, "new_total": 0, "rework_total": 0, "net_sec_total": 0, "target_total": 0}, {"日付": "2026-08-15", "day_total": 0, "new_total": 0, "rework_total": 0, "net_sec_total": 0, "target_total": 0}, {"日付": "2026-08-16", "day_total": 0, "new_total": 0, "rework_total": 0, "net_sec_total": 0, "target_total": 0}, {"日付": "2026-08-17", "day_total": 1138, "new_total": 1138, "rework_total": 0, "net_sec_total": 20484, "target_total": 0}, {"日付": "2026-08-18", "day_total": 1272, "new_total": 1272, "rework_total": 0, "net_sec_total": 22896, "target_total": 0}, {"日付": "2026-08-19", "day_total": 1347, "new_total": 1319, "rework_total": 28, "net_sec_total": 24246, "target_total": 0}, {"日付": "2026-08-20", "day_total": 1421, "new_total": 1421, "rework_total": 0, "net_sec_total": 25578, "target_total": 0}, {"日付": "2026-08-21", "day_total": 1502, "new_total": 1502, "rework_total": 0, "net_sec_total": 27036, "target_total": 0}, {"日付": "2026-08-22", "day_total": 30, "new_total": 30, "rework_total": 0, "net_sec_total": 540, "target_total": 0}, {"日付": "2026-08-23", "day_total": 0, "new_total": 0, "rework_total": 0, "net_sec_total": 0, "target_total": 0}, {"日付": "2026-08-24", "day_total": 1185, "new_total": 1185, "rework_total": 0, "net_sec_total": 21330, "target_total": 0}, {"日付": "2026-08-25", "day_total": 1443, "new_total": 1443, "rework_total": 0, "net_sec_total": 25974, "target_total": 0}, {"日付": "2026-08-26", "day_total": 1392, "new_total": 1392, "rework_total": 0, "net_sec_total": 25056, "target_total": 0}, {"日付": "2026-08-27", "day_total": 1175, "new_total": 1175, "rework_total": 0, "net_sec_total": 21150, "target_total": 0}, {"日付": "2026-08-28", "day_total": 1581, "new_total": 1581, "rework_total": 0, "net_sec_total": 28458, "target_total": 0}, {"日付": "2026-08-29", "day_total": 911, "new_total": 911, "rework_total": 0, "net_sec_total": 16398, "target_total": 0}, {"日付": "2026-08-30", "day_total": 0, "new_total": 0, "rework_total": 0, "net_sec_total": 0, "target_total": 0}, {"日付": "2026-08-31", "day_total": 1441, "new_total": 1441, "rework_total": 0, "net_sec_total": 25938, "target_total": 0}]

AIM:
- description: Line-12 day-shift (昼勤) good production, August 2026 month aggregate. Per shift-day: day total, new-build sum, rework sum, net seconds, target. Zero-days (Obon, weekends) kept visible.
- context: daily good production rollup
- extractHint: daily pcs per shift-day | new vs rework split | keep zero-days visible | full daily rows, never collapse to best/total only
