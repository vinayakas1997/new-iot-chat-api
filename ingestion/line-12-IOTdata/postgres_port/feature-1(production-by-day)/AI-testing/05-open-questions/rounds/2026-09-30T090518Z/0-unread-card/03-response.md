# reply
Aggregated hourly production and target quantities per unit/machine/bucket for the window, casting text columns to int for summation.

# sql
```sql
WITH buckets AS (
  SELECT 
    to_timestamp(hiduke, 'YYYY/MM/DD HH24:MI:SS') AS ts,
    setsubi_unit,
    setsubi_kiban,
    seisan_jikantai,
    jikanbetsu_seisan,
    jikanbetsu_mokuhyo
  FROM line12_august.stg_ryohin
  WHERE to_timestamp(hiduke, 'YYYY/MM/DD HH24:MI:SS') >= '{{from}}'
    AND to_timestamp(hiduke, 'YYYY/MM/DD HH24:MI:SS') < '{{to}}'
    AND insert_timing = '時間チェック'
)
SELECT 
  DATE_TRUNC('hour', ts) AS bucket,
  setsubi_unit,
  setsubi_kiban,
  seisan_jikantai,
  SUM(jikanbetsu_seisan::int) AS total_good_qty,
  SUM(jikanbetsu_mokuhyo::int) AS total_target_qty
FROM buckets
GROUP BY DATE_TRUNC('hour', ts), setsubi_unit, setsubi_kiban, seisan_jikantai
ORDER BY bucket, setsubi_unit, setsubi_kiban
```

# meta
type=round attempts=2 rowCount=22

# steps
- found table stg_ryohin with time column hiduke
- columns: hiduke, setsubi_unit, setsubi_kiban, seisan_jikantai, jikanbetsu_seisan, jikanbetsu_mokuhyo, insert_timing
- key: time bucket for aggregation
- writing query
- running
- failed [unknown]: function sum(text) does not exist
- fixed: retrying (attempt 2/3)
- found table stg_ryohin
- columns: hiduke, setsubi_unit, setsubi_kiban, seisan_jikantai, jikanbetsu_seisan, jikanbetsu_mokuhyo, insert_timing
- key: none shared, single table
- writing query
- running
