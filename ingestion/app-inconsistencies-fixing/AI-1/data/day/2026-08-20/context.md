# Context — 2026-08-20 昼勤 (hourly)

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
- 時間当: min 88 / max 185 / avg 142.1 (n=10, distinct=9).
- 累計: min 99 / max 1421 / avg 777.3 (n=10, distinct=10).
- 目標数: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD03[7]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD32[8]: min 40 / max 124 / avg 87.7 (n=10, distinct=10).
- FD31[9]: min 37 / max 64 / avg 54.4 (n=10, distinct=8).
- FD03(再)[27]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD32(再)[28]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD31(再)[29]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- 正味時間秒: min 1584 / max 3330 / avg 2557.8 (n=10, distinct=9).
Constant columns (no chart — table/rationale only): 目標数=0, FD03[7]=0, FD03(再)[27]=0, FD32(再)[28]=0, FD31(再)[29]=0.
time_span: 時間帯 09:20–19:20 (10 distinct).
Gap: 12:xx — no bucket (lunch 12:00-13:10).

SAMPLE ROWS (first 6 of 10):
- {'時間帯': '09:20', '時間当': '99', '累計': '99', 'FD03[7]': '0', 'FD32[8]': '40', 'FD31[9]': '59', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '1782'}
- {'時間帯': '10:20', '時間当': '147', '累計': '246', 'FD03[7]': '0', 'FD32[8]': '110', 'FD31[9]': '37', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2646'}
- {'時間帯': '11:20', '時間当': '140', '累計': '386', 'FD03[7]': '0', 'FD32[8]': '79', 'FD31[9]': '61', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2520'}
- {'時間帯': '13:10', '時間当': '135', '累計': '521', 'FD03[7]': '0', 'FD32[8]': '71', 'FD31[9]': '64', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2430'}
- {'時間帯': '14:10', '時間当': '175', '累計': '696', 'FD03[7]': '0', 'FD32[8]': '124', 'FD31[9]': '51', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '3150'}
- {'時間帯': '15:20', '時間当': '161', '累計': '857', 'FD03[7]': '0', 'FD32[8]': '113', 'FD31[9]': '48', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2898'}
