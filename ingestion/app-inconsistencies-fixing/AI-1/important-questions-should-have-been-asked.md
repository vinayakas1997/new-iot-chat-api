# Important Questions That Should Have Been Asked

This file documents critical questions that were NOT asked during the daily vs monthly analysis in `data/difference.md`. These questions represent gaps between pattern detection (what) and root cause analysis (why).

## Missing Questions

### 1. Model Mix Shift Driver
**Context**: D4 notes "FD31-led week (08-03–08-07) → FD32-led fortnight (08-17–08-31)"

**Missing Question**: "What drove the FD31→FD32 regime shift starting 08-17?"

**Why it matters**: Was this demand-driven, supply-driven, or a planned production change? Understanding the driver determines if this is a sustainable pattern or a one-time adjustment.

---

### 2. Order Intake Correlation
**Context**: C5 identifies the ramp (711→1581) as the regime shift

**Missing Question**: "Does the 711→1581 ramp correlate with order intake changes from customers?"

**Why it matters**: Without order-intake data, we cannot distinguish between capacity improvements vs. demand changes. This is explicitly flagged as "needs-outside-data" in Section 3.

---

### 3. Rework Root Cause (CRITICAL HOLE)
**Context**: C4 shows 08-19 had 28 pcs rework at 13:10 (3 pcs) + 14:10 (25 pcs), FD31-only

**Missing Question**: "What caused the 28 pcs rework on 08-19?"

**Why it matters**: This is explicitly flagged as a HOLE in `difference.md`. The monthly chart knows HOW MUCH, the daily chart knows WHEN and WHICH MODEL, but nobody asked WHY. This should be the first ticket in AI2's work queue.

---

### 4. Saturday Shutdown Verification
**Context**: C2 identifies 08-22 as "Saturday: scheduled stoppage, not mid-flow failure"

**Missing Question**: "Was 08-22 a planned shutdown or unexpected stoppage?"

**Why it matters**: The analysis assumes it's scheduled but doesn't verify against production schedules or shutdown logs. This affects whether we're detecting anomalies or just documenting planned events.

---

### 5. Post-Lunch Impact Quantification
**Context**: D1 identifies "13:10 softness cluster (9 days)"

**Missing Question**: "What's the average output loss from post-lunch softness across the month?"

**Why it matters**: We know the pattern exists but not its magnitude. Quantifying this would enable ROI calculations for potential interventions (shifted lunch times, staggered breaks, etc.).

---

### 6. Peak Timing Efficiency
**Context**: D2 shows different peak slots: 17:20 = 177 (08-04), 13:10 = 281 (08-31)

**Missing Question**: "Do days peaking earlier (13:10) produce more than days peaking later (17:20)?"

**Why it matters**: If earlier peaks correlate with higher totals, this suggests process optimization opportunities (start stronger, maintain momentum). If not, it may indicate different product mixes or customer priorities.

---

### 7. Multi-Day Stoppage Comparison
**Context**: M1 identifies "Obon trench: 9 straight zero-days 8/8–8/16"

**Missing Question**: "How does Obon's 9-day stoppage compare to other planned shutdowns in Q3?"

**Why it matters**: Without historical context, we cannot determine if 9 days is typical for Obon or an anomaly. This affects capacity planning and customer commitment accuracy.

---

### 8. Sunday Relevance Assessment
**Context**: Methodology notes "13 zero-production days excluded (Sundays are holidays)"

**Missing Question**: "Should Sundays be analyzed separately, or are they truly irrelevant for pattern detection?"

**Why it matters**: Excluding Sundays entirely may miss important patterns (e.g., Monday recovery, weekend preparation effects). A separate Sunday analysis could reveal different dynamics.

---

## Priority Ranking

| Priority | Question ID | Reason |
|----------|-------------|--------|
| **P0** | #3 (Rework Root Cause) | Explicitly flagged as HOLE in difference.md |
| **P1** | #2 (Order Intake) | Needs outside data but critical for business context |
| **P1** | #1 (Model Shift Driver) | Explains the regime shift mechanism |
| **P2** | #4 (Saturday Verification) | Validates assumption about planned shutdowns |
| **P2** | #5 (Post-Lunch Impact) | Quantifies known pattern for ROI analysis |
| **P3** | #6 (Peak Timing) | Optimization opportunity if correlation exists |
| **P3** | #7 (Obon Comparison) | Historical context for capacity planning |
| **P3** | #8 (Sunday Analysis) | Methodological completeness |

## Next Steps for AI2

1. **Immediate**: Create ticket for #3 (rework cause) - this is the confirmed hole
2. **Week 1**: Add #2 (order intake) to the "needs-outside-data" frame in Section 3
3. **Week 2**: Implement #1 and #5 as part of the pattern analyzer L2 layer
4. **Sprint Review**: Evaluate #4, #6, #7, #8 based on data availability

## Connection to difference.md

These questions directly address the gaps identified in `data/difference.md`:
- Section 2 C4 explicitly flags the rework cause as unanswered
- Section 3 mentions "needs-outside-data frames human tickets (FD32 order intake from 8/17)"
- The "Diversity rule pending" in Caveats suggests the question set needs expansion