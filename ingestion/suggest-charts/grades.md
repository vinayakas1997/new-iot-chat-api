# Grades — threshold injection dry-run (qwen36-35B, temp 0.2)

## Trial A (with THRESHOLDS block) — PASS (6/6)
- valid_json_with_candidates: PASS — 2 candidates (line + histogram).
- verbatim_columns: PASS — ts / avg_temp_c only, character-identical.
- measure_choice: PASS — avg_temp_c is the Y measure (humidity distractor ignored).
- threshold_cited: PASS — line rationale cites "26°C overheat thresholds";
  conditions: "temperature excursions below 18°C or above 26°C".
- below_row_visible: PASS — rationale cites "18°C freeze"; the below-direction
  row-2 signal survived (profile JSON alone only carries 26).
- at_most_4: PASS — 2 candidates.

## Trial B (control, profile-only `threshold: 26`) — observation
- Valid JSON, verbatim columns, avg_temp_c measure — same structural quality.
- B **also** cites 18 and 26 (inferred from the AIM description + min stat),
  but WITHOUT threshold names and with generic conditions
  ("for safety violations" vs A's "excursions below 18°C or above 26°C").

## Verdict
PASS for the block per the pre-declared rule: the marginal value is
row-2 visibility + naming + actionable conditions. The block upgrades
prose from "inferred values" to "cited definitions" — exactly the gap
that server-stamped warn lines cannot fill.
Out of scope for the LLM (verified post-build, locally): warn-line op
correctness (>= vs <=) — server-side sanitizer behavior, unit-test it.
