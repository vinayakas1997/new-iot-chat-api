# Vision dry-run — runbook (context-step-1)

Blind protocol: `truth.json` / `expected.json` are NEVER sent. Grade after.

## 1. Trial A — hourly breach day (vision)
- image: `charts/hourly_breachday.png`, envelope: `meta_hourly.json`
- user text: `user_template.txt` filled from the envelope
- Expect: breach true, peak 28.5, peakAt 17:00 (≈17:20 ok), 02:00 dip dismissed with citation, faults-5 cross catch (bonus).

## 2. Trial B — daily line (vision)
- image: `charts/daily_temp.png`, envelope: `meta_daily.json`
- Expect: breach FALSE (daily avg hides it — model must NOT hallucinate a breach),
  trend flat, crossCheck states averaging-away, ticket 3 keep-open.

## 3. Trial C — histogram (vision)
- image: `charts/hist_temp.png`, envelope: `meta_hist.json`
- Expect: distribution shape + peak ~22 + hot tail; NO trend language; no breach verdict on counts.

## 4. Trial D — step-2 grounding (text only)
- prompt: `step2_prompt.txt` (+ `step2_slice.csv` pasted as the rows).
- Expect: `{"peak": 28.5, "peakAt": "17:20", "breach": true, "confirmed": true}` + faults note.

## Send (direct :8009, bypasses audit — fixtures only)
POST http://localhost:8009/v1/chat/completions
{"model": "qwen36-35B", "temperature": 0.2,
 "messages": [{"role": "system", "content": "<system.txt>"},
              {"role": "user", "content": [{"type": "text", "text": "<filled user block>"},
                                           {"type": "image_url", "image_url": {"url": "data:image/png;base64,<png>"}}]}]}

## Grade per trial (expected.json)
- evidence cited? verdict == truth? timing labeled-or-honestly-ranged?
- no invented quirks? ticket verdict sane? confidence sane?
- Record pass/fail per check; fix prompt wording on any fail, re-run.
