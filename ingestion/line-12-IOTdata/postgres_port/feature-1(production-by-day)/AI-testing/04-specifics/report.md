# Specifics (hints) test — report

Model: `qwen36-35B` · Detection: 312 rows / 31 August days · Expected points: new/rework split + lunch gap + cumulative + measure/unit

## BARE
Score: **20/100** {'points': 3, 'hint_chars': 222, 'ctx_chars': 24}
extractHint: No columns recorded in stg_ryohin so no measure/unit/threshold rules can be derived | Sample covers only 31 production days so no recurring quirks are invented | No setter-note rules apply due to missing column definitions
context: `hourly production rollup`

## FULL
Score: **100/100** {'points': 6, 'hint_chars': 477, 'ctx_chars': 29}
extractHint: Aggregate jikanbetsu_seisan as hourly good quantity in pcs with no threshold | Ignore 12:xx time buckets due to scheduled lunch gaps observed in 31 days | Ignore 19:20 zero buckets as recurring short close gaps from 31 days | Report cumulative counter deltas rather than raw levels based on non-decreasing shift-day evidence | Separate new builds (7/8/9) and rework (27/28/29) without summing per setter notes | Exclude rows where insert_timing is not '時間チェック' per ground truth
context: `hourly good production rollup`

## Verdict
- BARE 20/100: with no meanings the model honestly refuses to invent ("no measure rules can be derived"). Correct behavior, useless output — proves meanings are the fuel.
- FULL 100/100: all 6 points, each citing its evidence ("observed in 31 days", "per setter notes", "per ground truth"): hourly pcs measure, lunch gap, short-close gap, cumulative-delta rule, new/rework split, 時間チェック filter. Context "hourly good production rollup" (29 chars, in style).
- This is the payoff of the whole chain: description + fixed meanings + steer + measured quirks compose into a perfect hint draft with zero hand-writing. The "one prompt" idea from the plan discussion is validated — Suggest both + steer does the job.
- All 4 AI steps now tested: columns 69% (human fix-up on 4 rules), SQL thinking 75% / results blocked by bucket rule, charts 53% + manual table, hints 100% FULL. Feature-1 registration path is proven end to end.
