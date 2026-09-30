# Column-suggestion AI test — report

Model: `qwen36-35B` · Prompt: app exact llm-fill strings · **Score: 47/68 = 69% (PASS ≥50%)**

## Verdict (manual review of the 10 key columns)
- ✅ Got right: hourly qty (K1), shift flag (K8), time bucket (K9), cycle time (K6), event code (K10).
- ⚠️ Lenient pass, actually wrong: `se_no` → "Employee or operator number" (it is 背番号 product name, not a person). Keyword scoring passed it on the word "number" — human review catches this.
- ❌ Missed (the 4 plant-specific rules): cumulative-don't-sum (K2 → "Total production count" invites the SUM bug), 時間チェック filter (K3 → "timing of data insertion", useless), model/rework split (K4 → "sequence number", no FD/(再) split), shift-day rollover (K7, generic).
- Conclusion: auto-fill is GOOD for generic columns (69%) but MISSES exactly the 4 non-obvious rules that make or break our SQL. Those 4 must be hand-written into `line_column_meta` (or the steer). Step-1 bar passes, with human fix-up on key columns mandatory.

## stg_ryohin (15/24)

| column | w | pass | AI meaning |
|---|---|---|---|
| jikanbetsu_seisan | 2 | ✅ | Actual production quantity for the time slot. |
| seisan_su | 2 | ❌ | Total production count. |
| insert_timing | 2 | ❌ | Timing of data insertion, such as at the start of the shift. |
| kishu_no | 2 | ❌ | Sequence number within the shift. |
| se_no | 2 | ✅ | Employee or operator number. |
| ct | 2 | ✅ | Cycle time or counter value. |
| kinmu_hidukejiku | 2 | ❌ | Work schedule date range. |
| chuyakin | 2 | ✅ | Shift type, such as day shift. |
| seisan_jikantai | 2 | ✅ | Production time slot. |
| setsubi_unit | 1 | ✅ | Equipment unit identifier. |
| setsubi_kiban | 1 | ✅ | Equipment base or model code. |
| hiduke | 1 | ✅ | Timestamp of the record. |
| jikan_taisei | 1 | ❌ | Time adjustment status, such as normal time. |
| jikanbetsu_mokuhyo | 1 | ✅ | Target quantity for the specific time slot. |
| mokuhyo | 1 | ✅ | Overall production target. |

## stg_seisan_jisseki (13/13)

| column | w | pass | AI meaning |
|---|---|---|---|
| jisseki_code | 2 | ✅ | A unique code identifying the specific type of production result or activity. |
| hiduke | 1 | ✅ | The precise timestamp when the record was created or updated. |
| setsubi_unit | 1 | ✅ | The specific equipment or machine unit identifier. |
| setsubi_kiban | 1 | ✅ | The operational status or base condition of the equipment, such as 'Hirukin' (Hollow/Empty). |
| kinmu_hidukejiku | 1 | ✅ | The date associated with the work shift or activity period. |
| chuyakin | 1 | ✅ | The type of work shift, specifically 'Day Shift' (昼勤). |
| seisan_jikantai | 1 | ✅ | The actual start time of the production activity. |
| jikan_taisei | 1 | ✅ | The time classification or adjustment status, such as 'Normal Time' (通常時間). |
| sagyosha | 1 | ✅ | The operator or worker identifier assigned to the task. |
| jisseki_naiyo | 1 | ✅ | The detailed content or description of the production result, such as 'Work-in-Progress with Kanban' or 'Equipment Start |
| on_off | 1 | ✅ | The operational state of the equipment or activity, indicating 'On' or 'Off'. |
| jisseki_jikan | 1 | ✅ | The duration of the production activity in minutes. |

## stg_ijo (19/31)

| column | w | pass | AI meaning |
|---|---|---|---|
| hiduke | 1 | ✅ | Timestamp of the event occurrence. |
| kinmu_hidukejiku | 1 | ✅ | Date of the work shift. |
| chuyakin | 1 | ✅ | Shift type designation. |
| unit_code | 1 | ✅ | Unique identifier for the production unit. |
| kotei_junban | 1 | ✅ | Fixed sequence number for the record. |
| kiban | 1 | ✅ | Base machine or equipment model code. |
| jikantai | 1 | ✅ | Start time of the operation. |
| sagyosha | 1 | ✅ | Operator identification code. |
| unten_mode | 1 | ✅ | Current driving mode of the equipment. |
| ijo_shurui | 1 | ✅ | Category of the abnormality detected. |
| ijo_no | 1 | ✅ | Unique identifier for the specific abnormality instance. |
| ijo_naiyo | 1 | ✅ | Detailed description of the abnormality content. |
| on_off | 1 | ✅ | Status of the abnormality handling process. |
| kidouji_teishi_s | 1 | ✅ | Duration of the emergency stop in seconds. |
| untenchu_teishi_s | 1 | ✅ | Duration of the operation stop in seconds. |
| work_no_st1 | 1 | ✅ | Work order number for station 1. |
| serial_st1 | 1 | ❌ |  |
| work_no_st2 | 1 | ✅ | Work order number for station 2. |
| serial_st2 | 1 | ❌ |  |
| work_no_st3 | 1 | ✅ | Work order number for station 3. |
| serial_st3 | 1 | ❌ |  |
| work_no_st4 | 1 | ✅ | Work order number for station 4. |
| serial_st4 | 1 | ❌ |  |
| work_no_st5 | 1 | ❌ |  |
| serial_st5 | 1 | ❌ |  |
| work_no_st6 | 1 | ❌ |  |
| serial_st6 | 1 | ❌ |  |
| work_no_st7 | 1 | ❌ |  |
| serial_st7 | 1 | ❌ |  |
| work_no_st8 | 1 | ❌ |  |
| serial_st8 | 1 | ❌ |  |
