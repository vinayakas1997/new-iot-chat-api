# Aim — prove the worth: daily analysis vs monthly-chart analysis

Two arms, same prompt (Section 4 SYSTEM frozen in `../prompt-variables.md`), same model (`qwen36-35B`), morning shift only:

- Arm 1 (daily): one LLM call per August production date over that day's 昼勤 hourly result set + its base chart images. 18 calls, 18 stored responses (13 zero-production days excluded — see below).
- Arm 2 (monthly): one LLM call over the 31-row daily-grain month aggregate + its base chart images. 1 call, 1 stored response.

- Charts ride along: each call sends base chart images (trend line + split bar, rendered from its own `result.csv`) as image parts of the prompt — AI1 examines the charts, not just numbers.
- Zero-production days excluded from LLM calls: 8/1, 8/2, Obon 8/8–8/16, 8/23, 8/30 (Sundays are holidays; 8/1 Saturday also zero). Their folders stay as empty-result records; the month arm keeps the gaps visible (a month-only finding for the worth comparison).

The worth = the difference: which patterns/questions surface only day-by-day (slot peaks, 08-19 rework, lunch gap) vs only month-wide (Obon gap, month-peak day, trend across weeks).

## Plan

1. `README.md` + `aim.md` (this file) — experiment roof.
2. Runner queries Postgres → `day/<date>/result.csv` (31×) + `month/result.csv` (1×), 昼勤 only.
3. Build `context.md` per folder from its CSV (real recomputed numbers).
4. Assemble `prompt.md` per folder (Section 4 SYSTEM + per-call USER).
5. Call LLM (charts + prompt) → `response.json` + `run.log` per folder (19 calls: 18 daily + 1 monthly).
6. Write `difference.md`: monthly closed/open vs union of daily closed/open, counted.
