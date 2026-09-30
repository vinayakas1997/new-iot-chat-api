Line `line-12`, window 2026-08-04T00:00:00+09:00 → 2026-08-05T00:00:00+09:00 (preset: full).

TABLES (exhaustive — query only these):
- line12_august.stg_ryohin — no recorded time bounds
    kinmu_hidukejiku (text) — shift-day date, night 00-11h belongs to prior shift-day
    setsubi_unit (text) — equipment unit code 10-1629
    setsubi_kiban (text) — machine code AM-307A
    hiduke (text) — event timestamp TEXT YYYY/MM/DD HH24:MI:SS, cast with to_timestamp(hiduke, format)
    chuyakin (text) — day/night shift flag 昼勤/夜勤
    seisan_jikantai (text) — plant hourly bucket e.g. 09:20, no 12:xx lunch gap
    jikan_taisei (text) — time system, usually 通常時間
    jikanbetsu_mokuhyo (text) — hourly target qty
    mokuhyo (text) — target qty, 0 in August
    kishu_no (text) — model no: 7/8/9 FD03/FD32/FD31 new builds, 27/28/29 rework
    se_no (text) — back/product name, *** dummy
    jikanbetsu_seisan (text) — hourly good qty, SUM this per bucket
    seisan_su (text) — running cumulative qty per model per day, never SUM
    ct (text) — cycle time seconds, net = qty x CT
    insert_timing (text) — row kind: 時間チェック hourly checkpoints USE, exclude 直始め/生産数リセット
- line12_august.stg_seisan_jisseki — no recorded time bounds
    hiduke (text) — (no explanation stored)
    setsubi_unit (text) — (no explanation stored)
    setsubi_kiban (text) — (no explanation stored)
    kinmu_hidukejiku (text) — (no explanation stored)
    chuyakin (text) — (no explanation stored)
    seisan_jikantai (text) — (no explanation stored)
    jikan_taisei (text) — (no explanation stored)
    sagyosha (text) — (no explanation stored)
    jisseki_code (text) — (no explanation stored)
    jisseki_naiyo (text) — (no explanation stored)
    on_off (text) — (no explanation stored)
    jisseki_jikan (text) — (no explanation stored)
- line12_august.stg_ijo — no recorded time bounds
    hiduke (text) — (no explanation stored)
    kinmu_hidukejiku (text) — (no explanation stored)
    chuyakin (text) — (no explanation stored)
    unit_code (text) — (no explanation stored)
    kotei_junban (text) — (no explanation stored)
    kiban (text) — (no explanation stored)
    jikantai (text) — (no explanation stored)
    sagyosha (text) — (no explanation stored)
    unten_mode (text) — (no explanation stored)
    ijo_shurui (text) — (no explanation stored)
    ijo_no (text) — (no explanation stored)
    ijo_naiyo (text) — (no explanation stored)
    on_off (text) — (no explanation stored)
    kidouji_teishi_s (text) — (no explanation stored)
    untenchu_teishi_s (text) — (no explanation stored)
    work_no_st1 (text) — (no explanation stored)
    work_no_st2 (text) — (no explanation stored)
    work_no_st3 (text) — (no explanation stored)
    work_no_st4 (text) — (no explanation stored)
    work_no_st5 (text) — (no explanation stored)
    work_no_st6 (text) — (no explanation stored)
    work_no_st7 (text) — (no explanation stored)
    work_no_st8 (text) — (no explanation stored)
    serial_st1 (text) — (no explanation stored)
    serial_st2 (text) — (no explanation stored)
    serial_st3 (text) — (no explanation stored)
    serial_st4 (text) — (no explanation stored)
    serial_st5 (text) — (no explanation stored)
    serial_st6 (text) — (no explanation stored)
    serial_st7 (text) — (no explanation stored)
    serial_st8 (text) — (no explanation stored)

CONVERSATION SO FAR (round summaries):
  (none — first question)

THIS TURN:
  Editor SQL now: (empty)
  User asks: "Resolve ticket #2 \"[loop] card:card-munsleft: What does card \"Line-12 hourly production\" show for the window? Summarize per bucket at the card's hourly grain with gro\": query the underlying rows for the ticket window and report grounded numbers at the natural grain. Context: Q: What does card \"Line-12 hourly production\" show for the window? Summarize per bucket at the card's hourly grain with grounded numbers.\nA: Aggregates hourly good quantities from stg_ryohin for the specified window, grouped by time bucket, unit, machine, and shift.\nSQL: WITH buckets AS (\n  SELECT\n    to_timestamp(hiduke, 'YYYY/MM/DD HH24:MI:SS') AS ts,\n    setsubi_unit,\n    setsubi_kiban,\n    sei"