# Context — 2026-08-22 昼勤 (hourly)

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
- 時間当: min 0 / max 30 / avg 3 (n=10, distinct=2).
- 累計: min 0 / max 30 / avg 21 (n=10, distinct=2).
- 目標数: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD03[7]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD32[8]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD31[9]: min 0 / max 30 / avg 3 (n=10, distinct=2).
- FD03(再)[27]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD32(再)[28]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD31(再)[29]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- 正味時間秒: min 0 / max 540 / avg 54 (n=10, distinct=2).
Constant columns (no chart — table/rationale only): 目標数=0, FD03[7]=0, FD32[8]=0, FD03(再)[27]=0, FD32(再)[28]=0, FD31(再)[29]=0.
time_span: 時間帯 09:20–19:20 (10 distinct).
Gap: 12:xx — no bucket (lunch 12:00-13:10).

SAMPLE ROWS (first 6 of 10):
- {'時間帯': '09:20', '時間当': '0', '累計': '0', 'FD03[7]': '0', 'FD32[8]': '0', 'FD31[9]': '0', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '0'}
- {'時間帯': '10:20', '時間当': '0', '累計': '0', 'FD03[7]': '0', 'FD32[8]': '0', 'FD31[9]': '0', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '0'}
- {'時間帯': '11:20', '時間当': '0', '累計': '0', 'FD03[7]': '0', 'FD32[8]': '0', 'FD31[9]': '0', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '0'}
- {'時間帯': '13:10', '時間当': '30', '累計': '30', 'FD03[7]': '0', 'FD32[8]': '0', 'FD31[9]': '30', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '540'}
- {'時間帯': '14:10', '時間当': '0', '累計': '30', 'FD03[7]': '0', 'FD32[8]': '0', 'FD31[9]': '0', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '0'}
- {'時間帯': '15:20', '時間当': '0', '累計': '30', 'FD03[7]': '0', 'FD32[8]': '0', 'FD31[9]': '0', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '0'}
