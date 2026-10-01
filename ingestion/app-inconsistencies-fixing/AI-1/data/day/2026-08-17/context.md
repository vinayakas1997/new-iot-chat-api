# Context — 2026-08-17 昼勤 (hourly)

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
- 時間当: min 19 / max 169 / avg 113.8 (n=10, distinct=9).
- 累計: min 82 / max 1138 / avg 581.8 (n=10, distinct=10).
- 目標数: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD03[7]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD32[8]: min 19 / max 169 / avg 94.9 (n=10, distinct=9).
- FD31[9]: min 0 / max 64 / avg 18.9 (n=10, distinct=5).
- FD03(再)[27]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD32(再)[28]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD31(再)[29]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- 正味時間秒: min 342 / max 3042 / avg 2048.4 (n=10, distinct=9).
Constant columns (no chart — table/rationale only): 目標数=0, FD03[7]=0, FD03(再)[27]=0, FD32(再)[28]=0, FD31(再)[29]=0.
time_span: 時間帯 09:20–19:20 (10 distinct).
Gap: 12:xx — no bucket (lunch 12:00-13:10).

SAMPLE ROWS (first 6 of 10):
- {'時間帯': '09:20', '時間当': '82', '累計': '82', 'FD03[7]': '0', 'FD32[8]': '48', 'FD31[9]': '34', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '1476'}
- {'時間帯': '10:20', '時間当': '107', '累計': '189', 'FD03[7]': '0', 'FD32[8]': '63', 'FD31[9]': '44', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '1926'}
- {'時間帯': '11:20', '時間当': '157', '累計': '346', 'FD03[7]': '0', 'FD32[8]': '93', 'FD31[9]': '64', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2826'}
- {'時間帯': '13:10', '時間当': '19', '累計': '365', 'FD03[7]': '0', 'FD32[8]': '19', 'FD31[9]': '0', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '342'}
- {'時間帯': '14:10', '時間当': '82', '累計': '447', 'FD03[7]': '0', 'FD32[8]': '35', 'FD31[9]': '47', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '1476'}
- {'時間帯': '15:20', '時間当': '148', '累計': '595', 'FD03[7]': '0', 'FD32[8]': '148', 'FD31[9]': '0', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2664'}
