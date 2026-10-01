# Context — 2026-08-26 昼勤 (hourly)

AIM: Line-12 day-shift (昼勤) good production. Per time-slot (hourly grain): hourly output, running total, target, new builds FD03/FD32/FD31 + rework FD(再), net seconds.
Context: hourly good production rollup.
Hint: hourly pcs per slot | new vs rework split | omit 12:xx | full hourly rows, never collapse to best/total only.

TIME: grain hourly; 10 buckets; period 09:20–19:20; gap 12:xx (lunch).

COLUMN MEANINGS (only columns the result set uses):
- 時間帯 = plant hourly bucket label, e.g. 09:20 (temporal X).
- 時間当 = hourly good qty in pcs — SUM this per bucket (trend measure).
- 累計 = running total within the shift-day (cumulative emphasis).
- 目標数 = hourly target (0 in August — never a trend baseline).
- FD03[7] / FD32[8] / FD31[9] = new builds per model (discrete split).
- FD03(再)[27] / FD32(再)[28] / FD31(再)[29] = rework per model (split).
- 正味時間秒 = net seconds = qty x cycle time (effort view).

DATA PROFILE (recomputed from result.csv):
- 時間当: min 69 / max 205 / avg 139.2 (n=10, distinct=10).
- 累計: min 97 / max 1392 / avg 806.4 (n=10, distinct=10).
- 目標数: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD03[7]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD32[8]: min 50 / max 135 / avg 83.4 (n=10, distinct=9).
- FD31[9]: min 19 / max 81 / avg 55.8 (n=10, distinct=10).
- FD03(再)[27]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD32(再)[28]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD31(再)[29]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- 正味時間秒: min 1242 / max 3690 / avg 2505.6 (n=10, distinct=10).
Constant columns (no chart — table/rationale only): 目標数=0, FD03[7]=0, FD03(再)[27]=0, FD32(再)[28]=0, FD31(再)[29]=0.
time_span: 時間帯 09:20–19:20 (10 distinct).
Gap: 12:xx — no bucket (lunch 12:00-13:10).

SAMPLE ROWS (first 6 of 10):
- {'時間帯': '09:20', '時間当': '97', '累計': '97', 'FD03[7]': '0', 'FD32[8]': '50', 'FD31[9]': '47', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '1746'}
- {'時間帯': '10:20', '時間当': '166', '累計': '263', 'FD03[7]': '0', 'FD32[8]': '110', 'FD31[9]': '56', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2988'}
- {'時間帯': '11:20', '時間当': '150', '累計': '413', 'FD03[7]': '0', 'FD32[8]': '69', 'FD31[9]': '81', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2700'}
- {'時間帯': '13:10', '時間当': '205', '累計': '618', 'FD03[7]': '0', 'FD32[8]': '135', 'FD31[9]': '70', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '3690'}
- {'時間帯': '14:10', '時間当': '169', '累計': '787', 'FD03[7]': '0', 'FD32[8]': '105', 'FD31[9]': '64', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '3042'}
- {'時間帯': '15:20', '時間当': '115', '累計': '902', 'FD03[7]': '0', 'FD32[8]': '83', 'FD31[9]': '32', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2070'}
