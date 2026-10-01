# Context — 2026-08-19 昼勤 (hourly)

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
- 時間当: min 46 / max 172 / avg 134.7 (n=10, distinct=8).
- 累計: min 46 / max 1347 / avg 694.9 (n=10, distinct=10).
- 目標数: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD03[7]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD32[8]: min 31 / max 138 / avg 87.7 (n=10, distinct=10).
- FD31[9]: min 0 / max 64 / avg 44.2 (n=10, distinct=9).
- FD03(再)[27]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD32(再)[28]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD31(再)[29]: min 0 / max 25 / avg 2.8 (n=10, distinct=3).
- 正味時間秒: min 828 / max 3096 / avg 2424.6 (n=10, distinct=8).
Constant columns (no chart — table/rationale only): 目標数=0, FD03[7]=0, FD03(再)[27]=0, FD32(再)[28]=0.
time_span: 時間帯 09:20–19:20 (10 distinct).
Gap: 12:xx — no bucket (lunch 12:00-13:10).

SAMPLE ROWS (first 6 of 10):
- {'時間帯': '09:20', '時間当': '46', '累計': '46', 'FD03[7]': '0', 'FD32[8]': '31', 'FD31[9]': '15', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '828'}
- {'時間帯': '10:20', '時間当': '137', '累計': '183', 'FD03[7]': '0', 'FD32[8]': '89', 'FD31[9]': '48', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2466'}
- {'時間帯': '11:20', '時間当': '122', '累計': '305', 'FD03[7]': '0', 'FD32[8]': '59', 'FD31[9]': '63', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2196'}
- {'時間帯': '13:10', '時間当': '115', '累計': '420', 'FD03[7]': '0', 'FD32[8]': '76', 'FD31[9]': '36', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '3', '正味時間秒': '2070'}
- {'時間帯': '14:10', '時間当': '170', '累計': '590', 'FD03[7]': '0', 'FD32[8]': '86', 'FD31[9]': '59', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '25', '正味時間秒': '3060'}
- {'時間帯': '15:20', '時間当': '168', '累計': '758', 'FD03[7]': '0', 'FD32[8]': '105', 'FD31[9]': '63', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '3024'}
