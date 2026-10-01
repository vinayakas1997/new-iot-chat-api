# Context — August 昼勤 month aggregate (daily)

AIM: Line-12 day-shift (昼勤) good production. Per shift-day (daily grain): day total, new-build sum, rework sum, net seconds, target.
Context: daily good production rollup.
Hint: daily pcs per shift-day | new vs rework split | keep zero-days visible | full daily rows, never collapse to best/total only.

TIME: grain daily; 31 buckets; period 2026-08-01–2026-08-31; Obon + weekend zeros inside.

COLUMN MEANINGS (only columns the result set uses):
- 日付 = shift-day date, e.g. 2026-08-04 (temporal X).
- day_total = day 昼勤 total pcs = max(累計) (trend measure).
- new_total = day new-build pcs summed over models (discrete split).
- rework_total = day rework pcs summed over models (split).
- net_sec_total = day net seconds summed (effort view).
- target_total = day target (0 in August — never a trend baseline).

DATA PROFILE (recomputed from result.csv):
- day_total: min 0 / max 1581 / avg 646.1 (n=31, distinct=19).
- new_total: min 0 / max 1581 / avg 645.2 (n=31, distinct=19).
- rework_total: min 0 / max 28 / avg 0.9 (n=31, distinct=2).
- net_sec_total: min 0 / max 28458 / avg 11630.3 (n=31, distinct=19).
- target_total: min 0 / max 0 / avg 0 (n=31, distinct=1).
Constant columns (no chart — table/rationale only): target_total=0.
time_span: 日付 2026-08-01–2026-08-31 (31 distinct).
Gap: zero-production days: 2026-08-01,2026-08-02,2026-08-08,2026-08-09,2026-08-10,2026-08-11,2026-08-12,2026-08-13,2026-08-14,2026-08-15,2026-08-16,2026-08-23,2026-08-30.

SAMPLE ROWS (first 6 of 31):
- {'日付': '2026-08-01', 'slot_rows': '10', 'day_total': '0', 'new_total': '0', 'rework_total': '0', 'net_sec_total': '0', 'target_total': '0'}
- {'日付': '2026-08-02', 'slot_rows': '10', 'day_total': '0', 'new_total': '0', 'rework_total': '0', 'net_sec_total': '0', 'target_total': '0'}
- {'日付': '2026-08-03', 'slot_rows': '10', 'day_total': '711', 'new_total': '711', 'rework_total': '0', 'net_sec_total': '12798', 'target_total': '0'}
- {'日付': '2026-08-04', 'slot_rows': '10', 'day_total': '1083', 'new_total': '1083', 'rework_total': '0', 'net_sec_total': '19494', 'target_total': '0'}
- {'日付': '2026-08-05', 'slot_rows': '10', 'day_total': '611', 'new_total': '611', 'rework_total': '0', 'net_sec_total': '10998', 'target_total': '0'}
- {'日付': '2026-08-06', 'slot_rows': '10', 'day_total': '1023', 'new_total': '1023', 'rework_total': '0', 'net_sec_total': '18414', 'target_total': '0'}
