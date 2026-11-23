# ADR 0005 — The checker is a component and must be measured too

- **Status:** Accepted
- **Date:** 2026-10-16
- **Deciders:** Kevin Pratama
- **Relates to:** ADR 0002 (non-blocking extractor), ADR 0003 (adversarial authorship), ARCHITECTURE.md

## Context

The project's founding rule is **"code decides truth."** The deterministic verdict
engine (`extractor.js` → `verdictForClaim`) is the only component that cannot
hallucinate, and everything downstream trusts it: the accountability view, the served
verdicts, the "PASS/FAIL" a user sees.

Until 2026-10-16 the checker had **never been measured.** The extractor had been
measured (ADR 0003, adversarial sets). The generator had been measured (Phase 2, 400
charts). The checker — the component the whole architecture rests on — had not.

A user-reported screenshot started this. A reading claimed a `亥卯未` three-harmony;
the checker flagged it `FAIL`, expected `"none"`. **The checker was wrong.** The chart
(辛未 辛卯 己亥 己巳) contains 未, so the trine is complete and the claim was true:
`verdictForClaim` only handled *pairwise* relations and had no path for `threeHarmony`.

Building an eval for the checker then found a **far larger** defect, 310 verdicts wide.

## Decision

**The checker is a component like any other and gets its own eval, measuring both
error directions separately.**

1. **`checker-eval.js`** constructs claims whose truth is determined **by construction**
   from the engine's own chart output — every branch pair × every relation kind ×
   assert/deny, plus identity and dominance checks. It does not ask the checker what
   the answer is.

2. **Two rates are measured, always.**
   - **False positive** — a TRUE claim marked false
   - **False negative** — a FALSE claim marked true

   A fix for one direction can open a hole in the other. This happened.

3. **Unjudgeable claims are `unjudged`, not failures.** A claim whose truth value is
   undefined by construction ("未丑 is a clash" where 丑 is simply absent from the
   chart) must not be scored as a hit or a miss. Scoring them created 6 phantom
   false negatives and would have sent us chasing a non-existent bug.

## What was found

| Run | Agreement | False positives | False negatives |
|---|---|---|---|
| First measurement | 61.54% | **310 (38.46%)** | 0 |
| After presence/relation fix | 99.3% | 0 | 6 *(eval bug)* |
| After eval fix | **100%** (742 judged) | 0 | 0 |

**Two distinct defects:**

**a) Three-way relations unhandled.** `relationKind` checked only pairwise tables
(冲/合/害/刑). A `threeHarmony` / `threeMeeting` claim fell through to the pairwise
path, found no pairwise relation, and returned "expected: none" — a **false verdict on
a true claim.** Fixed by handling three-way claims first and checking whether the
*whole set* is present, distinguishing "part of an incomplete set" from "not in any
set".

**b) Presence conflated with relation — 310 verdicts.** An earlier fix (closing a hole
where a claim about an *absent* pair passed) was implemented as:

> *if both branches are present → checkable; if either is absent → fail.*

That is wrong. **Two branches can both be present and have no relation at all.** So
denying a relation between two present-but-unrelated branches — the most common
*correct* claim — was flagged false. Fixed by separating the two questions: presence is
a precondition for an assertion, not a verdict. Denial is true iff the relation does
not hold, regardless of presence.

**The lesson in (b):** it was a *fix* that introduced the defect. Closing a
false-negative hole opened a false-positive hole 310 verdicts wide. Only measuring
**both** rates catches this class.

## Rationale

- The checker is load-bearing. A checker that cries wolf is **worse than no checker**:
  it manufactures false certainty, which is the exact failure the architecture exists
  to prevent. Code cannot hallucinate, but code **can be incomplete — and therefore
  confidently wrong.**
- The defects were invisible because the eval did not exist. The `_meta` leak and the
  three-harmony bug were both *visible* on inspection; the 310-verdict defect was only
  reachable by asking "how often is the checker wrong?"
- Had this shipped, the accountability view — the product's stated trust
  differentiator — would have flagged correct readings as broken, with confident
  explanations.

## Consequence for process

**A verdict is not evidence about the model until the ground truth has been checked
independently.** On this date the checker's output was read as proof that the model had
fabricated a relation, and reported as such. The claim was true; the checker was wrong.
This is the same class of error as the five earlier plumbing-vs-behaviour incidents, and
it occurred in a **conclusion**, not a passing remark.

Rule: before concluding anything about model behaviour from a verdict, compute the
chart and confirm the verdict against it.

## Consequences

- `checker-eval.js` and `checker-eval-results.json` are part of the suite; re-run after
  **any** change to `verdictForClaim`.
- Any future fix to one error direction must be measured against both.
- The eval's coverage is bounded by its construction: it is thorough on relations, light
  on identity, and **self-authored** — the ADR 0003 caveat applies. It validates
  consistency with the chart, not the checker's completeness in the world.
- `deploy/` is unaffected: the extractor is dev-side; the deployed server serves
  precomputed fragments only.

## Not decided here

- A third-party/adversarial author for checker cases (the ADR 0003 pattern, applied to
  the checker rather than the extractor).
- Coverage of claim types beyond relations and identity: Ten Gods, element balance,
  and any future surface.
- Whether the checker's `unjudged` rate (64/806 here) is acceptable or should be driven
  down.
