# Context — 2026-08-28 昼勤 (hourly)

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
- 時間当: min 70 / max 277 / avg 158.1 (n=10, distinct=10).
- 累計: min 70 / max 1581 / avg 879.6 (n=10, distinct=10).
- 目標数: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD03[7]: min 0 / max 76 / avg 22.3 (n=10, distinct=5).
- FD32[8]: min 22 / max 137 / avg 76.8 (n=10, distinct=10).
- FD31[9]: min 41 / max 85 / avg 59 (n=10, distinct=9).
- FD03(再)[27]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD32(再)[28]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- FD31(再)[29]: min 0 / max 0 / avg 0 (n=10, distinct=1).
- 正味時間秒: min 1260 / max 4986 / avg 2845.8 (n=10, distinct=10).
Constant columns (no chart — table/rationale only): 目標数=0, FD03(再)[27]=0, FD32(再)[28]=0, FD31(再)[29]=0.
time_span: 時間帯 09:20–19:20 (10 distinct).
Gap: 12:xx — no bucket (lunch 12:00-13:10).

SAMPLE ROWS (first 6 of 10):
- {'時間帯': '09:20', '時間当': '70', '累計': '70', 'FD03[7]': '0', 'FD32[8]': '22', 'FD31[9]': '48', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '1260'}
- {'時間帯': '10:20', '時間当': '155', '累計': '225', 'FD03[7]': '0', 'FD32[8]': '98', 'FD31[9]': '57', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2790'}
- {'時間帯': '11:20', '時間当': '178', '累計': '403', 'FD03[7]': '0', 'FD32[8]': '93', 'FD31[9]': '85', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '3204'}
- {'時間帯': '13:10', '時間当': '277', '累計': '680', 'FD03[7]': '76', 'FD32[8]': '137', 'FD31[9]': '64', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '4986'}
- {'時間帯': '14:10', '時間当': '163', '累計': '843', 'FD03[7]': '19', 'FD32[8]': '90', 'FD31[9]': '54', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2934'}
- {'時間帯': '15:20', '時間当': '160', '累計': '1003', 'FD03[7]': '32', 'FD32[8]': '70', 'FD31[9]': '58', 'FD03(再)[27]': '0', 'FD32(再)[28]': '0', 'FD31(再)[29]': '0', '正味時間秒': '2880'}
