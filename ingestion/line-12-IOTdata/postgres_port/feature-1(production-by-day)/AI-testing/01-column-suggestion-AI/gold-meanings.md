# Gold meanings — answer key for the column-suggestion AI test

Target: `line12_august` staging tables in test-postgres (plant DB).
The app's `llm-fill` sees ONLY: table name + `column (type): sample, values`.
It does NOT see this file. We score its drafts against the rules below.

Pass bar: **≥50% overall** (key columns count double).

## KEY columns (double weight — the 5 rules the AI cannot guess)

| # | table.column | gold meaning | must-mention (EN or JA) |
|---|---|---|---|
| K1 | stg_ryohin.jikanbetsu_seisan | Hourly good qty for this slot (Work_QTY_H). **SUM this per 時間帯.** | hourly / per-hour / 時間別 / that hour |
| K2 | stg_ryohin.seisan_su | Running cumulative qty per 機種 per day. Display only — **never SUM.** | cumulative / running total / 累計 / 累積 |
| K3 | stg_ryohin.insert_timing | Row kind: `時間チェック`=hourly checkpoint (Hour_Check 1/2/3, USE these); `直始め`/`生産数リセット`=exclude. | checkpoint / 時間チェック / Hour_Check / exclude / 除外 |
| K4 | stg_ryohin.kishu_no | Machine model no (Work_No). 7/8/9 = FD03/FD32/FD31 new builds; 27/28/29 = rework (再). | model / 機種 / rework / (再) / new |
| K5 | stg_ryohin.se_no | Back number / product name (work_name). `***`=dummy, FD*=real. | product / back / 背番号 / name |
| K6 | stg_ryohin.ct | Cycle time in seconds. 正味時間 = qty × CT (18 for FD, 0 for ***). | cycle / CT / second / 秒 |
| K7 | stg_ryohin.kinmu_hidukejiku | Shift-day date (AB_SECTION_DAY). Night shift 00–11h belongs to prior shift-day. | shift day / 勤務 / shift-date |
| K8 | stg_ryohin.chuyakin | Day/night shift flag (昼勤/夜勤). | shift / 昼勤 / 夜勤 / day-night / day/night |
| K9 | stg_ryohin.seisan_jikantai | Hourly time bucket (時間帯, e.g. 09:20). No 12:xx = lunch. | bucket / slot / 時間帯 / hour |
| K10 | stg_seisan_jisseki.jisseki_code | Event code (ActualCode): 129=start, 130=end, 121=planned stop, etc. Joined to m_actual_codes. | code / 実績コード / event / ActualCode |

## Other columns (single weight — plausible domain meaning is enough)

**stg_ryohin:** setsubi_unit (equipment unit 10-1629), setsubi_kiban (machine AM-307A),
hiduke (event timestamp INSERT_DATE), jikan_taisei (time system e.g. 通常時間),
jikanbetsu_mokuhyo (hourly target qty), mokuhyo (target qty, 0 in August),
insert_timing covered above (K3).

**stg_seisan_jisseki (12):** hiduke (event timestamp), setsubi_unit, setsubi_kiban,
kinmu_hidukejiku (shift-day), chuyakin (shift), seisan_jikantai (time bucket),
jikan_taisei, sagyosha (operator), jisseki_naiyo (event description text),
on_off (ON/OFF flag), jisseki_jikan (duration in seconds).

**stg_ijo (31):** hiduke, kinmu_hidukejiku, chuyakin, unit_code (10-1629),
kotei_junban (process order no), kiban (machine e.g. AM-307B/ZF-228),
jikantai (time bucket), sagyosha, unten_mode (auto/manual),
ijo_shurui (alarm vs warning), ijo_no (error code), ijo_naiyo (error text),
on_off, kidouji_teishi_s (startup stop sec), untenchu_teishi_s (running stop sec),
work_no_st1-8 (workpiece nos per station), serial_st1-8 (serial nos per station).
