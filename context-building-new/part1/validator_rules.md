# Part-1 Validator Rules (R2 — mechanical enforcement, pipeline-side)

Prose rules persuade; these rules REJECT. Applied to every Step-1 reply
after JSON parse (fences stripped first), before storage. Any violation →
schema-reject → the existing corrective re-prompt fires once (same machinery
as `llmChatJson`); double failure → error row, never a stored guess.

## V1 — quote-substring check (the confabulation killer)
- Every `birthCheck[]` entry with `birth: false` MUST carry a `why`
  containing a verbatim quote of the covering envelope line.
- The quoted span MUST be a substring of the sent envelope text, AND must
  come from a MEMORY field (quirk verdicts, specifics, extract hint, prior
  digests, history pack) — never from stats labels. A stats parenthetical
  ("recalibration dip" in minAt) is a label, not a verdict: it says what,
  never what-to-do. Labels don't cover; only memory covers.
- No quotable covering memory exists → `birth: false` is unwriteable → the
  anomaly MUST birth (or the reply is rejected).
- Catches: V3-nodip-memory ("explicitly identifies…" — no memory basis).

## V2 — boolean type lock
- `birthCheck[].birth` MUST be JSON boolean (`true`/`false`).
- Strings (`"yes"`/`"no"`), numbers, nulls → reject. (Seen 3× in trials.)

## V3 — fence tolerance
- Leading/trailing ```json fences are stripped before parse (seen 1×).
- Prose outside fences → reject, not salvage.

## V4 — null discipline
- `breach`/`level` null IFF `thresholdMode: "describe-only"`.
- `breach: false` with zero threshold rows → reject (the hole: verdict
  grounded in nothing).

## V5 — cadence echo
- `cadence` MUST equal the envelope's cadence word verbatim
  (`hourly`/`daily`/…). Window text, point counts, image dimensions
  (`"1920x1080"`, `"24 points (hourly)"`) → reject. (Seen 3× — the field
  name `resolution` caused it; renamed to `cadence`.)

## V6 — histogram field laws
- `peak` null, `peakDay` null on `chartType: "histogram"`.
- Every `binRange` MUST be a verbatim envelope-listed edge (no
  extrapolated edges like `28.50–29.25`).

## V7 — question shape + caps
- `newQuestions` ≤ 3 items; each needs non-empty `question` + `evidence`,
  `patternClass` in P1..P6, `confidence` 0–1.
- `birthCheck` length MUST equal `anomalies` length (one decision each).

## V8 — timing vocabulary
- Intraday: `peakAt` HH:MM or null; daily+: `peakDay` date, `peakAt` null;
  histogram: `binRange` only (`at`/`between` forbidden).

## V9 — birth/question cross-consistency
- `birth: true` count MUST equal `newQuestions` count. A yes without its
  question is a dropped birth; a question without its yes is an orphan —
  both reject. (Seen 1×: V3-nodip-memory-R.)
