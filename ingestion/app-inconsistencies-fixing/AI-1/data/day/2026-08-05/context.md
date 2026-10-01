# Context — 2026-08-05 昼勤 (hourly)

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
- 時間当: min 0 / max 171 / avg 61.1 (n=10, distinct=8).
- 累計: min 0 / max 611 / avg 267.8 (n=10, distinct=9).
- 目標数: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD03[7]: min 0 / max 48 / avg 7.9 (n=10, distinct=4).
- FD32[8]: min 0 / max 20 / avg 2 (n=10, distinct=2).
- FD31[9]: min 0 / max 171 / avg 51.2 (n=10, distinct=9).
- FD03(再)[27]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD32(再)[28]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD31(再)[29]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- 正味時間秒: min 0 / max 3078 / avg 1099.8 (n=10, distinct=8).
Constant columns (no chart — table/rationale only): 目標数=0, FD03(再)[27]=0, FD32(再)[28]=0, FD31(再)[29]=0.
time_span: 時間帯 09:20–19:20 (10 distinct).
Gap: 12:xx — no bucket (lunch 12:00-13:10).

SAMPLE ROWS (first 6 of 10):
- {'時間帯': '09:20', '時間当': '0', '累計': '0', 'FD03[7]': '0', 'FD32[8]': '0', 'FD31[9]': '0', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '0'}
- {'時間帯': '10:20', '時間当': '15', '累計': '15', 'FD03[7]': '0', 'FD32[8]': '0', 'FD31[9]': '15', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '270'}
- {'時間帯': '11:20', '時間当': '7', '累計': '22', 'FD03[7]': '6', 'FD32[8]': '0', 'FD31[9]': '1', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '126'}
- {'時間帯': '13:10', '時間当': '32', '累計': '54', 'FD03[7]': '25', 'FD32[8]': '0', 'FD31[9]': '7', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '576'}
- {'時間帯': '14:10', '時間当': '47', '累計': '101', 'FD03[7]': '0', 'FD32[8]': '0', 'FD31[9]': '47', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '846'}
- {'時間帯': '15:20', '時間当': '156', '累計': '257', 'FD03[7]': '48', 'FD32[8]': '20', 'FD31[9]': '88', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2808'}
