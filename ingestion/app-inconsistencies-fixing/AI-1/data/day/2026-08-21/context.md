# Context — 2026-08-21 昼勤 (hourly)

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
- 時間当: min 60 / max 186 / avg 150.2 (n=10, distinct=10).
- 累計: min 116 / max 1502 / avg 834.7 (n=10, distinct=10).
- 目標数: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD03[7]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD32[8]: min 52 / max 135 / avg 95.9 (n=10, distinct=9).
- FD31[9]: min 0 / max 81 / avg 54.3 (n=10, distinct=7).
- FD03(再)[27]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD32(再)[28]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD31(再)[29]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- 正味時間秒: min 1080 / max 3348 / avg 2703.6 (n=10, distinct=10).
Constant columns (no chart — table/rationale only): 目標数=0, FD03[7]=0, FD03(再)[27]=0, FD32(再)[28]=0, FD31(再)[29]=0.
time_span: 時間帯 09:20–19:20 (10 distinct).
Gap: 12:xx — no bucket (lunch 12:00-13:10).

SAMPLE ROWS (first 6 of 10):
- {'時間帯': '09:20', '時間当': '116', '累計': '116', 'FD03[7]': '0', 'FD32[8]': '52', 'FD31[9]': '64', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2088'}
- {'時間帯': '10:20', '時間当': '167', '累計': '283', 'FD03[7]': '0', 'FD32[8]': '135', 'FD31[9]': '32', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '3006'}
- {'時間帯': '11:20', '時間当': '161', '累計': '444', 'FD03[7]': '0', 'FD32[8]': '97', 'FD31[9]': '64', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2898'}
- {'時間帯': '13:10', '時間当': '135', '累計': '579', 'FD03[7]': '0', 'FD32[8]': '71', 'FD31[9]': '64', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2430'}
- {'時間帯': '14:10', '時間当': '166', '累計': '745', 'FD03[7]': '0', 'FD32[8]': '102', 'FD31[9]': '64', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2988'}
- {'時間帯': '15:20', '時間当': '149', '累計': '894', 'FD03[7]': '0', 'FD32[8]': '102', 'FD31[9]': '47', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2682'}
