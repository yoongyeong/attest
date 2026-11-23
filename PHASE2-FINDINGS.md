# Phase 2 findings — generator fidelity at scale

**Date:** 2026-10-14
**Model under test:** `gemma4:31b` (generator), `gemma4:31b` (extractor), judge = dev-side
**Sample:** 400 charts, stratified by relation load, drawn from the **chart space** (not from dates)
**Claims checked:** 2,023 checkable factual claims, all compared against the deterministic engine

---

## Headline

| Metric | Value |
|---|---|
| Charts run | 400 / 400 (0 errors) |
| Charts with ≥1 false claim | 86 (**21.5%**) |
| Checkable claims | 2,023 |
| Claims wrong | 133 (**6.57%**) |

---

## The dissociation: identity is clean, relations are not

| Claim type | Wrong | Rate |
|---|---|---|
| `dayMaster` | 0 / 399 | **0%** |
| `dayMasterPolarity` | 0 / 204 | **0%** |
| `dominance` | 0 / 399 | **0%** |
| `relationsAbsence` | 10 / 89 | **11.2%** |
| `relationKind` | 123 / 932 | **13.2%** |

**1,002 identity and dominance claims, zero errors.** Everything that goes wrong is
in the branch-relation layer. The generator reliably reports *who* the person is
(day master, polarity, dominant element) and unreliably reports *how the branches
interact*.

## Error rate rises with relation load

The stratification hypothesis, confirmed:

| Stratum | Charts | Claims | Wrong | Rate | Charts with ≥1 lie |
|---|---|---|---|---|---|
| rel = 0 | 80 | 279 | 0 | **0%** | 0 |
| rel = 1 | 60 | 210 | 4 | 1.9% | 4 |
| rel = 2 | 60 | 272 | 17 | 6.25% | 16 |
| rel = 3 | 60 | 327 | 12 | 3.67% | 12 |
| rel = 4 | 60 | 394 | 32 | 8.12% | 16 |
| rel = 5 | 40 | 266 | 25 | 9.4% | 16 |
| rel = 6 | 40 | 275 | 43 | **15.64%** | 22 |

Zero-relation charts are **perfect** (0/279). Heavy charts (6 relations) run at
**15.6%** — roughly **8×** the lightest non-zero stratum.

This is the argument for stratification. In the population, `rel=6` charts are only
**1.7%** of the chart space; a proportional sample would have tested almost none of
them, and would have reported a rate dominated by the easy strata.

## Coverage

All coordinates exercised: day stems **10/10**, hour branches **12/12**, year stems
**10/10**, month branches **12/12**. No untested region of the sample space.

---

## Corrections to earlier claims

**1. The earlier "1.9%" figure was wrong.** Phase 2's first pass used 12 charts sampled
by *date*. It reported 1.9% per claim. The stratified chart-space sample reports
**6.57%** — more than 3× higher. The cause is exactly the sampling problem: birth dates
correlate with chart features, and that date sample happened to land on light-relation
charts. **Date sampling underestimates the error rate.** That result is superseded.

**2. `relationsAbsence` is not safe.** An earlier 3-claim sample showed 0 errors and
was read as "the absence path is fine". At 89 claims it is **11.2% wrong**. A false
absence claim is not cosmetic: it changes the entire tone of a reading.

**3. The day-master reliability claim is now well-founded.** 399 day-master claims,
204 polarity claims, 399 dominance claims, zero errors. This is the strongest positive
result in the project: a model that **cannot compute** the day pillar (1/15 when asked)
**never misreports it** when handed the computed value.

---

## What this means for the product

- **The architecture holds.** Compute in code, narrate in the model: the narrator is
  trustworthy for the facts it is given, so long as those facts are given.
- **The reading can ship.** Gemma is viable: ~2s per reading, and identity facts are
  flawless.
- **The relation sentences are where the accountability view earns its keep.** 13.2%
  of relation-kind claims carry the wrong kind. The checker catches these deterministically.
- **Non-blocking is the right call (ADR 0002).** With a 21.5% per-chart flag rate, a
  blocking check would reject a fifth of all readings. Serving them and logging the
  verdicts is what makes the data visible without harming the product.

---

## Caveats

- One model (gemma4:31b), one generator prompt. A better prompt might reduce the
  relation error rate; that is untested.
- Charts come from the chart space, so they need not correspond to a real birth within
  the calendar range. This is intentional — we measure narration fidelity, not
  birth-date validity.
- The extractor is the same model family as the generator, which risks shared blind
  spots. ADR 0003's adversarial set is the mitigation; the extractor's recall is
  measured on that set at 6/6.
- Confidence intervals are not reported. Strata counts are large enough to be
  informative but the generator's errors may be correlated within a stratum.

---

## Reproduction

```bash
node chart-space.js index          # enumerate the space, show the relation distribution
node phase2-bigrun.js              # run/resume the 400-chart stratified sample
node phase2-bigrun.js --aggregate  # re-aggregate from the partial file
```

- Seed 42, deterministic sample. Strata in `phase2-bigrun.js → STRATA`.
- Per-chart records (reading + claims + verdict) in `phase2-big-partial.jsonl`.
- Summary in `phase2-big-results.json`.
