# reply
Query checks for 12:xx buckets and confirms the shift-day mapping for night shifts.

# sql
```sql
SELECT DISTINCT seisan_jikantai FROM line12_august.stg_ryohin WHERE hiduke >= '2026/08/04 00:00:00' AND hiduke < '2026/08/05 00:00:00' AND insert_timing = '時間チェック' ORDER BY seisan_jikantai
```

# meta
type=round attempts=1 rowCount=22 tables=['line12_august.stg_ryohin']

# steps
- found table stg_ryohin
- columns: hiduke, seisan_jikantai, insert_timing
- writing query
- running
