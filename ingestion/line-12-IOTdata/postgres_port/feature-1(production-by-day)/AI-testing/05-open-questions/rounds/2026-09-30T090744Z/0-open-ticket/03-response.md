# reply
Casted jikanbetsu_seisan to numeric to allow aggregation and re-ran the hourly summary query.

# sql
```sql
WITH buckets AS (
  SELECT
    to_timestamp(hiduke, 'YYYY/MM/DD HH24:MI:SS') AS ts,
    setsubi_unit,
    setsubi_kiban,
    chuyakin,
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
  chuyakin,
  seisan_jikantai,
  SUM(jikanbetsu_seisan::numeric) AS total_good_qty
FROM buckets
GROUP BY DATE_TRUNC('hour', ts), setsubi_unit, setsubi_kiban, chuyakin, seisan_jikantai
ORDER BY bucket, setsubi_unit, setsubi_kiban
```

# meta
type=round attempts=2 rowCount=22

# steps
- found table stg_ryohin
- columns: hiduke, setsubi_unit, setsubi_kiban, chuyakin, seisan_jikantai, jikanbetsu_seisan, insert_timing
- key: time bucket for aggregation
- writing query
- running
- failed [unknown]: function sum(text) does not exist
- fixed: retrying (attempt 2/3)
- found table stg_ryohin
- columns: jikanbetsu_seisan is text
- fix: cast jikanbetsu_seisan to numeric before SUM
- writing query
- running
