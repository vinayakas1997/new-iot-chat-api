# Context — 2026-08-29 昼勤 (hourly)

AIM: Line-12 day-shift (昼勤) good production. Per time-slot (hourly grain): hourly output, running total, target, new builds FD03/FD32/FD31 + rework FD(再), net seconds.
Context: hourly good production rollup.
Hint: hourly pcs per slot | new vs rework split | omit 12:xx | full hourly rows, never collapse to best/total only.

TIME: grain hourly; 12 buckets; period 07:20–19:20; gap 12:xx (lunch).

COLUMN MEANINGS (only columns the result set uses):
- 時間帯 = plant hourly bucket label, e.g. 09:20 (temporal X).
- 時間当 = hourly good qty in pcs — SUM this per bucket (trend measure).
- 累計 = running total within the shift-day (cumulative emphasis).
- 目標数 = hourly target (0 in August — never a trend baseline).
- FD03[7] / FD32[8] / FD31[9] = new builds per model (discrete split).
- FD03(再)[27] / FD32(再)[28] / FD31(再)[29] = rework per model (split).
- 正味時間秒 = net seconds = qty x cycle time (effort view).

DATA PROFILE (recomputed from result.csv):
- 時間当: min 0 / max 184 / avg 75.9 (n=12, distinct=7).
- 累計: min 0 / max 911 / avg 595.9 (n=12, distinct=8).
- 目標数: min 0 / max 0 / avg 0 (n=12, distinct=1).
- FD03[7]: min 0 / max 160 / avg 13.3 (n=12, distinct=2).
- FD32[8]: min 0 / max 80 / avg 6.7 (n=12, distinct=2).
- FD31[9]: min 0 / max 171 / avg 55.9 (n=12, distinct=7).
- FD03(再)[27]: min 0 / max 0 / avg 0 (n=12, distinct=1).
- FD32(再)[28]: min 0 / max 0 / avg 0 (n=12, distinct=1).
- FD31(再)[29]: min 0 / max 0 / avg 0 (n=12, distinct=1).
- 正味時間秒: min 0 / max 3312 / avg 1366.5 (n=12, distinct=7).
Constant columns (no chart — table/rationale only): 目標数=0, FD03(再)[27]=0, FD32(再)[28]=0, FD31(再)[29]=0.
time_span: 時間帯 07:20–19:20 (12 distinct).
Gap: 12:xx — no bucket (lunch 12:00-13:10).

SAMPLE ROWS (first 6 of 12):
- {'時間帯': '07:20', '時間当': '0', '累計': '0', 'FD03[7]': '0', 'FD32[8]': '0', 'FD31[9]': '0', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '0'}
- {'時間帯': '08:20', '時間当': '146', '累計': '146', 'FD03[7]': '0', 'FD32[8]': '0', 'FD31[9]': '146', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2628'}
- {'時間帯': '09:20', '時間当': '152', '累計': '298', 'FD03[7]': '0', 'FD32[8]': '0', 'FD31[9]': '152', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2736'}
- {'時間帯': '10:20', '時間当': '171', '累計': '469', 'FD03[7]': '0', 'FD32[8]': '0', 'FD31[9]': '171', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '3078'}
- {'時間帯': '11:20', '時間当': '146', '累計': '615', 'FD03[7]': '0', 'FD32[8]': '0', 'FD31[9]': '146', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2628'}
- {'時間帯': '13:10', '時間当': '11', '累計': '626', 'FD03[7]': '0', 'FD32[8]': '0', 'FD31[9]': '11', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '198'}
