# Context — 2026-08-24 昼勤 (hourly)

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
- 時間当: min 16 / max 184 / avg 118.5 (n=10, distinct=10).
- 累計: min 16 / max 1185 / avg 652.3 (n=10, distinct=10).
- 目標数: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD03[7]: min 0 / max 32 / avg 3.2 (n=10, distinct=2).
- FD32[8]: min 16 / max 112 / avg 67.4 (n=10, distinct=10).
- FD31[9]: min 0 / max 80 / avg 47.9 (n=10, distinct=9).
- FD03(再)[27]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD32(再)[28]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD31(再)[29]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- 正味時間秒: min 288 / max 3312 / avg 2133 (n=10, distinct=10).
Constant columns (no chart — table/rationale only): 目標数=0, FD03(再)[27]=0, FD32(再)[28]=0, FD31(再)[29]=0.
time_span: 時間帯 09:20–19:20 (10 distinct).
Gap: 12:xx — no bucket (lunch 12:00-13:10).

SAMPLE ROWS (first 6 of 10):
- {'時間帯': '09:20', '時間当': '16', '累計': '16', 'FD03[7]': '0', 'FD32[8]': '16', 'FD31[9]': '0', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '288'}
- {'時間帯': '10:20', '時間当': '125', '累計': '141', 'FD03[7]': '0', 'FD32[8]': '61', 'FD31[9]': '64', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2250'}
- {'時間帯': '11:20', '時間当': '184', '累計': '325', 'FD03[7]': '32', 'FD32[8]': '104', 'FD31[9]': '48', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '3312'}
- {'時間帯': '13:10', '時間当': '126', '累計': '451', 'FD03[7]': '0', 'FD32[8]': '46', 'FD31[9]': '80', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2268'}
- {'時間帯': '14:10', '時間当': '175', '累計': '626', 'FD03[7]': '0', 'FD32[8]': '112', 'FD31[9]': '63', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '3150'}
- {'時間帯': '15:20', '時間当': '169', '累計': '795', 'FD03[7]': '0', 'FD32[8]': '107', 'FD31[9]': '62', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '3042'}
