# Context — 2026-08-06 昼勤 (hourly)

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
- 時間当: min 0 / max 159 / avg 102.3 (n=10, distinct=10).
- 累計: min 36 / max 1023 / avg 592.1 (n=10, distinct=9).
- 目標数: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD03[7]: min 0 / max 80 / avg 41.6 (n=10, distinct=7).
- FD32[8]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD31[9]: min 0 / max 103 / avg 60.7 (n=10, distinct=10).
- FD03(再)[27]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD32(再)[28]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD31(再)[29]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- 正味時間秒: min 0 / max 2862 / avg 1841.4 (n=10, distinct=10).
Constant columns (no chart — table/rationale only): 目標数=0, FD32[8]=0, FD03(再)[27]=0, FD32(再)[28]=0, FD31(再)[29]=0.
time_span: 時間帯 09:20–19:20 (10 distinct).
Gap: 12:xx — no bucket (lunch 12:00-13:10).

SAMPLE ROWS (first 6 of 10):
- {'時間帯': '09:20', '時間当': '36', '累計': '36', 'FD03[7]': '0', 'FD32[8]': '0', 'FD31[9]': '36', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '648'}
- {'時間帯': '10:20', '時間当': '121', '累計': '157', 'FD03[7]': '64', 'FD32[8]': '0', 'FD31[9]': '57', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2178'}
- {'時間帯': '11:20', '時間当': '114', '累計': '271', 'FD03[7]': '48', 'FD32[8]': '0', 'FD31[9]': '66', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2052'}
- {'時間帯': '13:10', '時間当': '130', '累計': '401', 'FD03[7]': '65', 'FD32[8]': '0', 'FD31[9]': '65', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2340'}
- {'時間帯': '14:10', '時間当': '124', '累計': '525', 'FD03[7]': '60', 'FD32[8]': '0', 'FD31[9]': '64', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2232'}
- {'時間帯': '15:20', '時間当': '147', '累計': '672', 'FD03[7]': '51', 'FD32[8]': '0', 'FD31[9]': '96', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2646'}
