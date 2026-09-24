# SQL-assistant working folder (research-only)

Runnable demo of how the playground AI chat will work: how the prompt is
built, what the model sees, what it returns. Zero app changes — this harness
only **GETs** the backend (`columnMeta`, `ranges` — read-only) and **POSTs**
the LLM (`:8009`). The only SQL execution is whatever you paste into the
playground yourself.

## Files

- `ask_system_v1.txt` — frozen system prompt (role + hard rules + JSON contract).
- `build_ask.py` — envelope builder. Live context from `:3100`, assembled in
  the confirmed order: **A** tables/explanations/window → **B** round
  summaries → **C** question (+ editor SQL) → **D** retry block (attempts 2–3).
- `send_ask.py` — sends `{system, envelope}` to `qwen36-35B`, saves the pair.
- `responses/` — per trial: `<name>.prompt.md` (complete prompt as sent:
  system inlined + hash + full envelope) + `<name>.json` (raw reply).

## Demo trials (defaults, line-smoke)

```bash
# T1 — first attempt (sections A+B+C)
python3 send_ask.py T1 --line line-smoke \
  --question "hourly average of temp, last 7 days"

# T2 — repair (adds section D: real failed SQL + live classified error)
python3 send_ask.py T2 --line line-smoke \
  --question "hourly average of temp, last 7 days" \
  --failed-sql "SELECT date_trunc('hour', ts) AS hour, AVG(tmp_c) FROM public.readings_temp WHERE ts >= '{{from}}' AND ts < '{{to}}' GROUP BY 1 ORDER BY 1" \
  --error-kind unknown_column \
  --error-message 'column "tmp_c" does not exist' \
  --error-hint 'Did you mean "temp_c"? Check exact column names in the Tables row / table Details panel.' \
  --attempt 2

# T3 — clarify (ambiguous ask: "unique items" fits no numeric column cleanly)
python3 send_ask.py T3 --line line-smoke \
  --question "what are the unique items in the temp column"
```

## Rule trials (v2 — multi-table + planning rules)

`ask_system_v2.txt` = v1 + Rule 9 (bucket-join pattern, multi only) + Rule 10
(join-key reasoning) + Rule 11 (`need_more`/`done`) + Rule 12 (single-table
plainness) + Rule 5 amended (cover-all-beats-asking) + Rule 13 (latest-per-entity).
`--scenario` swaps live metadata for a fixture (rule isolation, zero system writes).

```bash
# S1 — single-table regression gate (must stay PASS on every version)
python3 send_ask.py S1c --system ask_system_v2.txt --line line-smoke \
  --scenario scenarios/S1_baseline.json --question "hourly average of temp, last 7 days"
# J1 — shared time key only → bucket-join expected
python3 send_ask.py J1 --system ask_system_v2.txt --line line-12 \
  --scenario scenarios/J1_timekey.json --question "hourly temperature alongside hourly production counts"
# J2 — entity key in both → entity join expected
python3 send_ask.py J2 --system ask_system_v2.txt --line line-machines \
  --scenario scenarios/J2_entitykey.json --question "for machine MX-01 show its temperature readings alongside its running state"
# J3 — no shared key → must refuse the join, offer options
python3 send_ask.py J3 --system ask_system_v2.txt --line line-mixed \
  --scenario scenarios/J3_nokey.json --question "show each batch result with the temperature at that time"
# C1 — two temperature columns → cover both (amended Rule 5)
python3 send_ask.py C1 --system ask_system_v2.txt --line line-oven \
  --scenario scenarios/C1_threshold.json --question "average temperature, last 7 days"
# M1 — two-turn chain: distinct (M1a) → latest-per-entity (M1c)
python3 send_ask.py M1a --system ask_system_v2.txt --line line-machines \
  --scenario scenarios/M1_steps.json --question "what machines exist?"
python3 send_ask.py M1c --system ask_system_v2.txt --line line-machines \
  --scenario scenarios/M1_steps.json --rounds /tmp/m1_rounds.json \
  --question "what is the latest temperature of each of those machines?"
```

Scorecard: S1c ✅ 115 rows · J1 ✅ bucket-join · J2 ✅ entity-key join ·
J3 ✅ refused + offered lateral vs narrow · C1 ✅ covered both · M1a+M1c ✅
chained (`DISTINCT ON`, after Rule 13 fixed a bare-`LIMIT 1` fail).
Each version bump re-runs S1 first — single-table must never regress.

## How to read a trial

1. Open `responses/<name>.prompt.md` — the complete prompt exactly as sent.
2. Open `responses/<name>.json` → `reply` — the raw model output.
3. Verdict: paste the reply's `sql` into the playground and Run it.
   Runnable + correct = PASS. Anything else = note what broke.
