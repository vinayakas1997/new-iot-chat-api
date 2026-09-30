# reply
3 tries used — over to you; the last query is in the editor with the error below. Aggregates hourly good and target quantities per unit/machine/bucket for the window, casting text to int.

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
  setsubi_unit,
  setsubi_kiban,
  seisan_jikantai,
  SUM(jikanbetsu_seisan)::int AS total_good_qty,
  SUM(jikanbetsu_mokuhyo)::int AS total_target_qty
FROM buckets
GROUP BY setsubi_unit, setsubi_kiban, seisan_jikantai
ORDER BY setsubi_unit, setsubi_kiban, seisan_jikantai
```

# meta
type=round attempts=3 rowCount=None

# steps
- found table stg_ryohin
- columns: hiduke, setsubi_unit, setsubi_kiban, seisan_jikantai, jikanbetsu_seisan, jikanbetsu_mokuhyo, insert_timing
- key: time bucket via hiduke cast
- writing query
- running
- failed [unknown]: function sum(text) does not exist
- fixed: retrying (attempt 2/3)
- found table stg_ryohin
- columns: jikanbetsu_seisan, jikanbetsu_mokuhyo are text
- fixing cast to int before sum
- writing query
- running
- failed [unknown]: function sum(text) does not exist
- fixed: retrying (attempt 3/3)
- found table line12_august.stg_ryohin
- columns: hiduke, setsubi_unit, setsubi_kiban, seisan_jikantai, jikanbetsu_seisan, jikanbetsu_mokuhyo, insert_timing
- failed [unknown]: function sum(text) does not exist
