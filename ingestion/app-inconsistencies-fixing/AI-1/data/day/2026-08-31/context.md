# Context — 2026-08-31 昼勤 (hourly)

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
- 時間当: min 0 / max 281 / avg 144.1 (n=10, distinct=9).
- 累計: min 98 / max 1441 / avg 892.5 (n=10, distinct=9).
- 目標数: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD03[7]: min 0 / max 47 / avg 22.3 (n=10, distinct=4).
- FD32[8]: min 0 / max 139 / avg 74 (n=10, distinct=9).
- FD31[9]: min 0 / max 110 / avg 47.8 (n=10, distinct=10).
- FD03(再)[27]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD32(再)[28]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD31(再)[29]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- 正味時間秒: min 0 / max 5058 / avg 2593.8 (n=10, distinct=9).
Constant columns (no chart — table/rationale only): 目標数=0, FD03(再)[27]=0, FD32(再)[28]=0, FD31(再)[29]=0.
time_span: 時間帯 09:20–19:20 (10 distinct).
Gap: 12:xx — no bucket (lunch 12:00-13:10).

SAMPLE ROWS (first 6 of 10):
- {'時間帯': '09:20', '時間当': '98', '累計': '98', 'FD03[7]': '0', 'FD32[8]': '70', 'FD31[9]': '28', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '1764'}
- {'時間帯': '10:20', '時間当': '182', '累計': '280', 'FD03[7]': '32', 'FD32[8]': '82', 'FD31[9]': '68', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '3276'}
- {'時間帯': '11:20', '時間当': '143', '累計': '423', 'FD03[7]': '32', 'FD32[8]': '79', 'FD31[9]': '32', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2574'}
- {'時間帯': '13:10', '時間当': '281', '累計': '704', 'FD03[7]': '32', 'FD32[8]': '139', 'FD31[9]': '110', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '5058'}
- {'時間帯': '14:10', '時間当': '177', '累計': '881', 'FD03[7]': '32', 'FD32[8]': '129', 'FD31[9]': '16', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '3186'}
- {'時間帯': '15:20', '時間当': '170', '累計': '1051', 'FD03[7]': '32', 'FD32[8]': '74', 'FD31[9]': '64', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '3060'}
