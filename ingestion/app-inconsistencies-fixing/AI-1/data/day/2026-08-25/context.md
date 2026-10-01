# Context — 2026-08-25 昼勤 (hourly)

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
- 時間当: min 34 / max 266 / avg 144.3 (n=10, distinct=10).
- 累計: min 34 / max 1443 / avg 805.4 (n=10, distinct=10).
- 目標数: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD03[7]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD32[8]: min 10 / max 171 / avg 85.7 (n=10, distinct=10).
- FD31[9]: min 0 / max 95 / avg 58.6 (n=10, distinct=9).
- FD03(再)[27]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD32(再)[28]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD31(再)[29]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- 正味時間秒: min 612 / max 4788 / avg 2597.4 (n=10, distinct=10).
Constant columns (no chart — table/rationale only): 目標数=0, FD03[7]=0, FD03(再)[27]=0, FD32(再)[28]=0, FD31(再)[29]=0.
time_span: 時間帯 09:20–19:20 (10 distinct).
Gap: 12:xx — no bucket (lunch 12:00-13:10).

SAMPLE ROWS (first 6 of 10):
- {'時間帯': '09:20', '時間当': '34', '累計': '34', 'FD03[7]': '0', 'FD32[8]': '10', 'FD31[9]': '24', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '612'}
- {'時間帯': '10:20', '時間当': '149', '累計': '183', 'FD03[7]': '0', 'FD32[8]': '95', 'FD31[9]': '54', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2682'}
- {'時間帯': '11:20', '時間当': '170', '累計': '353', 'FD03[7]': '0', 'FD32[8]': '91', 'FD31[9]': '79', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '3060'}
- {'時間帯': '13:10', '時間当': '266', '累計': '619', 'FD03[7]': '0', 'FD32[8]': '171', 'FD31[9]': '95', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '4788'}
- {'時間帯': '14:10', '時間当': '160', '累計': '779', 'FD03[7]': '0', 'FD32[8]': '71', 'FD31[9]': '89', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2880'}
- {'時間帯': '15:20', '時間当': '168', '累計': '947', 'FD03[7]': '0', 'FD32[8]': '113', 'FD31[9]': '55', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '3024'}
