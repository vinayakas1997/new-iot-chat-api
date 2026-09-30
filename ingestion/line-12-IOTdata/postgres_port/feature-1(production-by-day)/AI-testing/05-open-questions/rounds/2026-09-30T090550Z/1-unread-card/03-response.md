# reply
Aggregates hourly good quantities from stg_ryohin for the specified window, grouped by time bucket, unit, machine, and shift.

# sql
```sql
WITH buckets AS (
  SELECT
    to_timestamp(hiduke, 'YYYY/MM/DD HH24:MI:SS') AS ts,
    setsubi_unit,
    setsubi_kiban,
    seisan_jikantai,
    jikanbetsu_seisan
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
  SUM(jikanbetsu_seisan::numeric) AS total_good_qty
FROM buckets
GROUP BY DATE_TRUNC('hour', ts), setsubi_unit, setsubi_kiban, seisan_jikantai
ORDER BY bucket, setsubi_unit, setsubi_kiban
```

# meta
type=round attempts=1 rowCount=22

# steps
- found table line12_august.stg_ryohin
- columns: hiduke, setsubi_unit, setsubi_kiban, seisan_jikantai, jikanbetsu_seisan, insert_timing
- key: time bucket for aggregation
- writing query
- running
