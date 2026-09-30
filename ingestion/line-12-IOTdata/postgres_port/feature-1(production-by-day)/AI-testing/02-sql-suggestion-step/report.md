# SQL-suggestion test — report

Model: `qwen36-35B` · Prompt: app exact suggest-sql strings · Window: 2026-08-04 day shift · Gold: 10 rows, total 1061 (gold.sql)
**Curve: L0 0/100 → L1 0/100 → L2 0/100 → L3 0/100 (results) · thinking 0% → 0% → 75% → 75%**

## Verdict
- Result similarity NEVER crosses 50% — but for an instructive reason, not a model failure.
- All 4 drafts obeyed the prompt rules literally (date_trunc(hour, ts), {{from}}/{{to}}) against a schema that has NO ts column and TEXT timestamps: L1/L2/L3 die on `column ts does not exist`; L0 runs but TEXT-vs-timestamp comparison silently returns 0 rows.
- L0/L1 additionally commit the predicted SUM bug: SUM(seisan_su) on the cumulative column.
- L2/L3 thinking hits 3/4 key decisions (filter ✓, split ✓, cumulative ✓; qty-column naming ✗ — L2 even SUMs the wrong column while describing the split correctly).
- Root cause (prompt-vs-plant mismatch): the frozen Rules block assumes conventional ts columns + clock-hour buckets. Our plant has TEXT 日付, plant buckets (09:20…, lunch gap), and Japanese flag columns. No description depth can fix a rule that contradicts the schema — the steer (L3) got the thinking right but could not override the forced date_trunc(ts) shape.
- Fix direction (parked): steer must explicitly override bucketing (GROUP BY seisan_jikantai, not date_trunc) and name the timestamp expression (to_timestamp(hiduke,...)). Re-test L3 with that steer line to confirm the curve crosses 50%.

## L0
Result: **0/100**
Thinking-match: **0%** {'qty_col': False, 'filter': False, 'split': False, 'cumulative': False}

Outcome: ok-but-zero-rows

- Selected stg_ryohin as the sole source since all required measures (production count and cycle time) exist within this single table, eliminating the need for joins.
- Applied SUM to seisan_su (counter) and AVG to ct (gauge) to meet the specific aggregation rules for each metric type.
- Used date_trunc('hour', hiduke::timestamp) to create the hourly time bucket, ensuring the output aligns with the hourly cadence requirement.
- Implemented the strict time filtering using the provided placeholders with an exclusive upper bound on the hiduke column.
- Aliased all output columns explicitly to avoid bare column names in the final result set.
- Potential risk: if hiduke is not a valid timestamp format or if the data grain varies within the hour, the grouping may produce unexpected NULLs or misaligned buckets.

```sql
SELECT date_trunc('hour', stg_ryohin.hiduke::timestamp) AS time_bucket, SUM(CAST(stg_ryohin.seisan_su AS INTEGER)) AS total_production, AVG(CAST(stg_ryohin.ct AS FLOAT)) AS avg_cycle_time FROM line12_august.stg_ryohin WHERE stg_ryohin.hiduke >= '{{from}}' AND stg_ryohin.hiduke < '{{to}}' GROUP BY date_trunc('hour', stg_ryohin.hiduke::timestamp) ORDER BY time_bucket
```

## L1
Result: **0/100**
Thinking-match: **0%** {'qty_col': False, 'filter': False, 'split': False, 'cumulative': False}

Outcome: psql:/tmp/ai_run.sql:1: ERROR:  column "ts" does not exist
LINE 1: SELECT date_trunc('hour', ts) AS time_bucket, SUM(seisan_su)...
                                  ^

- Selected stg_ryohin as the sole source since all required measures (production count, cycle time) and filters (shift, unit) exist within this single table, avoiding unnecessary joins.
- Applied filters for 'Line-12' unit and 'Day-shift' time slot to isolate the specific production context requested.
- Used SUM for seisan_su as it is a counter (total good production) and AVG for ct as it is a gauge (average cycle time).
- Grouped by date_trunc('hour', ts) to align with the hourly cadence requirement and ensure one row per time bucket.
- Ensured the WHERE clause uses the exact '{{from}}' and '{{to}}' placeholders with an exclusive upper bound for the time range.
- Potential risk: If 'Day-shift' or 'Line-12' values are inconsistent in the source data, rows may be silently dropped; also, if ct is NULL, AVG ignores it which might skew results if data is sparse.

```sql
SELECT date_trunc('hour', ts) AS time_bucket, SUM(seisan_su) AS good_production_count, AVG(ct) AS avg_cycle_time FROM line12_august.stg_ryohin WHERE ts >= '{{from}}' AND ts < '{{to}}' AND setsubi_unit = 'Line-12' AND seisan_jikantai = 'Day-shift' GROUP BY date_trunc('hour', ts) ORDER BY time_bucket
```

## L2
Result: **0/100**
Thinking-match: **75%** {'qty_col': False, 'filter': True, 'split': True, 'cumulative': True}

Outcome: psql:/tmp/ai_run.sql:1: ERROR:  column "ts" does not exist
LINE 1: SELECT date_trunc('hour', ts) AS time_bucket, SUM(seisan_su)...
                                  ^

- Selected stg_ryohin as the sole source since all required measures (production, target, kishu_no) reside there, avoiding unnecessary cross-table JOINs.
- Applied date_trunc('hour', ts) for grouping to ensure hourly cadence and used it as the join key if multi-table logic were needed.
- Filtered out the 12:00-13:10 lunch window by excluding hours where EXTRACT(HOUR) = 12, adhering to the no-12xx bucket rule.
- Used SUM for counters (seisan_su) and AVG for the target gauge, with CASE statements to split new builds and rework based on kishu_no patterns.
- Ensured the WHERE clause strictly uses the {{from}} and {{to}} placeholders with an exclusive upper bound for live recomputation.
- Potential fan-out risk if kishu_no contains duplicate entries per time slot, though the grain appears to be per-record; grain doubts exist if 'Good' status is not explicitly filtered on setsubi_unit.

```sql
SELECT date_trunc('hour', ts) AS time_bucket, SUM(seisan_su) AS hourly_output, SUM(seisan_su) OVER (ORDER BY date_trunc('hour', ts)) AS running_total, AVG(jikanbetsu_mokuhyo) AS target, SUM(CASE WHEN kishu_no IN ('FD03', 'FD32', 'FD31') THEN seisan_su ELSE 0 END) AS new_builds, SUM(CASE WHEN kishu_no LIKE '%再%' THEN seisan_su ELSE 0 END) AS rework, SUM(seisan_su) AS net_seconds FROM line12_august.stg_ryohin WHERE ts >= '{{from}}' AND ts < '{{to}}' AND setsubi_unit = 'Line-12' AND chuyakin = 'Day-Shift' AND se_no = 'Good' AND jikanbetsu_seisan IS NOT NULL AND NOT (EXTRACT(HOUR FROM ts) = 12) GROUP BY date_trunc('hour', ts) ORDER BY time_bucket
```

## L3
Result: **0/100**
Thinking-match: **75%** {'qty_col': False, 'filter': True, 'split': True, 'cumulative': True}

Outcome: psql:/tmp/ai_run.sql:1: ERROR:  column "ts" does not exist
LINE 1: SELECT date_trunc('hour', ts) AS time_bucket, SUM(CASE WHEN ...
                                  ^

- Filtered strictly on '昼勤' and '時間チェック' to isolate day-shift hourly checkpoints, excluding lunch and reset rows.
- Split new builds (7/8/9) and rework (27/28/29) into separate SUM columns to enforce the rule against summing them together.
- Used date_trunc('hour', ts) for grouping to align with hourly cadence, naturally excluding the 12:xx lunch bucket if data is missing.
- Calculated net_seconds by multiplying hourly good quantity with average cycle time (AVG) per bucket to handle the net seconds requirement.
- Applied running total via window function ordered by truncated hour to track cumulative production per day.
- Potential risk: If 'ct' varies significantly within a bucket, AVG(ct)*SUM(qty) approximates net seconds rather than exact sum of individual row products.

```sql
SELECT date_trunc('hour', ts) AS time_bucket, SUM(CASE WHEN kishu_no IN ('7','8','9') THEN jikanbetsu_seisan ELSE 0 END) AS new_builds_fd03_fd32_fd31, SUM(CASE WHEN kishu_no IN ('27','28','29') THEN jikanbetsu_seisan ELSE 0 END) AS rework_fd_re, SUM(CASE WHEN kishu_no IN ('7','8','9') THEN jikanbetsu_seisan ELSE 0 END) * AVG(ct) AS net_seconds, SUM(jikanbetsu_seisan) AS hourly_output, SUM(jikanbetsu_seisan) OVER (ORDER BY date_trunc('hour', ts)) AS running_total, jikanbetsu_mokuhyo AS target FROM line12_august.stg_ryohin WHERE chuyakin = '昼勤' AND insert_timing = '時間チェック' AND ts >= '{{from}}' AND ts < '{{to}}' AND jikanbetsu_seisan IS NOT NULL GROUP BY date_trunc('hour', ts), jikanbetsu_mokuhyo ORDER BY time_bucket
```
