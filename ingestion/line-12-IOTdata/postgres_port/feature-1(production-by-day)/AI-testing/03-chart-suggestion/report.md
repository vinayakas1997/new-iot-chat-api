# Chart-suggestion test — report

Model: `qwen36-35B` · Sample: 10 real feature-1 rows (2026-08-04 昼勤) · Expected: line(時間当) + area(累計) + table(FD split)

## BARE
Score: **45/100** {'n': 3, 'types': ['line', 'histogram', 'histogram'], 'fd_covered': [], 'invented': []}

- **line** x=`slot_ts` y=`['時間当', '累計']` — Hourly Production Rate and Cumulative Output
  rationale: Uses 'slot_ts' as the temporal X axis to show the trend of '時間当' (hourly production rate) and '累計' (cumulative total) over time, directly addressing the Line-12 hourly production feature.
- **histogram** x=`時間当` y=`['時間当']` — Distribution of Hourly Production Rates
  rationale: Analyzes the spread and outliers of '時間当' (hourly production rate), revealing variability in hourly output performance across the shift.
- **histogram** x=`正味時間秒` y=`['正味時間秒']` — Distribution of Net Time Seconds
  rationale: Analyzes the spread of '正味時間秒' (net time seconds), revealing the distribution of actual working time duration per slot.

## FULL
Score: **53/100** {'n': 3, 'types': ['line', 'line', 'histogram'], 'fd_covered': ['FD03[7]', 'FD31[9]', 'FD32[8]'], 'invented': []}

- **line** x=`slot_ts` y=`['時間当', '累計']` — Hourly Output and Cumulative Total
  rationale: Uses '時間当' (hourly good qty) and '累計' (running cumulative qty) to show the production trend over time and the accumulation of total output.
- **line** x=`slot_ts` y=`['FD03[7]', 'FD32[8]', 'FD31[9]']` — New Build Production by Model
  rationale: Uses 'FD03[7]', 'FD32[8]', and 'FD31[9]' to visualize the separate output of new builds (models 7, 8, 9) over time, adhering to the requirement to split new builds from rework.
- **histogram** x=`時間当` y=`['時間当']` — Distribution of Hourly Output
  rationale: Uses '時間当' to reveal the spread of hourly production rates, identifying modes and outliers in the hourly output performance.

## Verdict
- BARE 45/100: line(時間当+累計 over slot_ts) + 2 histograms. Core trend right, FD split and table missing.
- FULL 53/100: adds line #2 = FD03/FD32/FD31 new-build split over time (semantics worked — it cites the new-vs-rework rule). Still no table, no area.
- Neither run crosses a 50%-with-table bar, for two prompt-vocab reasons, not model failure:
  1. The vocab says table is ONLY for "nothing numeric plots" — with 10 numeric columns the model never picks it, however much the AIM wants exact FD values. Our desired table contradicts the rule.
  2. The vocab says prefer line unless cumulative — the model puts 累計 on the line instead of a separate area, which is compliant behavior.
- Conclusion: chart-AI is GOOD at trends + splits (FULL gains +8 and the FD line), but the table chart must be added by human (one click in the UI) or the AIM must explicitly demand "include a table of the FD split" to override the vocab. Same pattern as columns: agents draft, human completes. No code change needed — record the table as a manual step in the registration checklist.
