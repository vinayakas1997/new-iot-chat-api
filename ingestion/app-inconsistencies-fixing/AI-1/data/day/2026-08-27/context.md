# Context — 2026-08-27 昼勤 (hourly)

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
- 時間当: min 46 / max 222 / avg 117.5 (n=10, distinct=10).
- 累計: min 54 / max 1175 / avg 611.9 (n=10, distinct=10).
- 目標数: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD03[7]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD32[8]: min 22 / max 112 / avg 69.7 (n=10, distinct=7).
- FD31[9]: min 0 / max 110 / avg 47.8 (n=10, distinct=9).
- FD03(再)[27]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD32(再)[28]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD31(再)[29]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- 正味時間秒: min 828 / max 3996 / avg 2115 (n=10, distinct=10).
Constant columns (no chart — table/rationale only): 目標数=0, FD03[7]=0, FD03(再)[27]=0, FD32(再)[28]=0, FD31(再)[29]=0.
time_span: 時間帯 09:20–19:20 (10 distinct).
Gap: 12:xx — no bucket (lunch 12:00-13:10).

SAMPLE ROWS (first 6 of 10):
- {'時間帯': '09:20', '時間当': '54', '累計': '54', 'FD03[7]': '0', 'FD32[8]': '22', 'FD31[9]': '32', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '972'}
- {'時間帯': '10:20', '時間当': '87', '累計': '141', 'FD03[7]': '0', 'FD32[8]': '55', 'FD31[9]': '32', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '1566'}
- {'時間帯': '11:20', '時間当': '129', '累計': '270', 'FD03[7]': '0', 'FD32[8]': '65', 'FD31[9]': '64', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2322'}
- {'時間帯': '13:10', '時間当': '222', '累計': '492', 'FD03[7]': '0', 'FD32[8]': '112', 'FD31[9]': '110', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '3996'}
- {'時間帯': '14:10', '時間当': '46', '累計': '538', 'FD03[7]': '0', 'FD32[8]': '46', 'FD31[9]': '0', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '828'}
- {'時間帯': '15:20', '時間当': '157', '累計': '695', 'FD03[7]': '0', 'FD32[8]': '97', 'FD31[9]': '60', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2826'}
