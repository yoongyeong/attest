# ADR 0003 — Adversarial test authorship; claim schema v2

- **Status:** Accepted
- **Date:** 2026-10-14
- **Deciders:** Kevin Pratama
- **Relates to:** ADR 0001 (dev-side judge), ADR 0002 (non-blocking extractor)

## Context

The extractor + CODE verdict pipeline had a hand-written corruption set (negative
cases with known defects). It scored **6/6 (100%)** recall with **0/1** false
positives.

Because the same party wrote both the checker and the test set, the result could
not be trusted: the corruptions used the vocabulary the checker's normalizers
were built to match.

The dev-side judge (ADR 0001) was therefore asked to author a *second*,
independent corruption set — adversarial, paraphrase-based, using phrasing a
hand-written matcher would not anticipate.

**Result on the judge-authored set: 2/6 (33%).** The judge found four blind spots:

| Blind spot | Example (judge-authored) |
|---|---|
| Relation **misclassification** | 亥巳 (a clash) described as a "six-harmony blend" |
| **Indirect negation** | "nothing here takes a punitive form" — no literal "no/none" keyword |
| **Indirect position reference** | "the Si beneath your day stem" — no pillar string present |
| **Polarity without a stem** | "the fire at your core is yang" — no stem named at all |

## Decision

**1. Adversarial test authorship is required, and the author must not be the
detector's author.** A detector's own test set systematically overstates its
quality. Every detector in this project is evaluated against a set written by a
different party, and the judge is that party.

**2. Claim schema v2 — richer structured claims, not richer regex.** The
extractor is asked for semantically precise claims, and CODE compares richer
structures:

| Claim type | Purpose |
|---|---|
| `pillars` | four pillar pairs, if stated |
| `dayMaster` | stem or elemental form as stated |
| `dayMasterPolarity` | yin/yang when the reading asserts fire "at the core" without a stem |
| `dominance` | element named as dominant/strongest/most-carried |
| `relationKind` | `{branches, kind, polarity}` — a relation kind asserted or denied **for a specific pair** |
| `branchesAtPosition` | a branch asserted at year/month/day/hour without a pillar string |
| `relationsAbsence` | the reading denies relations exist |
| `tenGod` | a Ten God named |

**3. CODE must validate the pair before judging the kind.** For `relationKind`:
first ask *are both branches present in this chart?* A relation that does not
exist cannot be described, correctly or otherwise. Only then ask whether the
asserted kind matches the actual relation for that pair.

**4. Regression testing against the original set is mandatory after any schema
change.** Schema v2 fixed four judge cases — and simultaneously broke one of the
original cases (M03, an invented relation for a pair absent from the chart),
because the schema prompt had made the branch pair optional. Fixed sets can
silently regress; only re-running the whole suite catches it.

## Result

| Set | v1 extractor | v2 extractor |
|---|---|---|
| Hand-written (author = detector's author) | 6/6 | 6/6 |
| Judge-authored (adversarial) | **2/6 (33%)** | **6/6 (100%)** |

False positives: 0/1 on the honest control.

## Rationale

- A passing self-authored suite proves the wiring is connected. It does not
  measure recall against real adversarial input. Treating 6/6 as a quality
  measure would have been a category error.
- The four blind spots were all *semantic*, not lexical. This is why the fix is
  a richer claim schema rather than more regex: the losing game is chasing
  paraphrase with pattern matching.
- Recording the pair for a relation claim is not a detail. Without it, a claim
  about a pair absent from the chart passes, because the same relation kind
  exists elsewhere in the chart.

## Consequences

- The judge's standing role includes **authoring adversarial cases**, not only
  grading output. This is its highest-value dev-side function so far.
- `brokenClaimType` from the judge is a *label*, not ground truth. Verdicts are
  reconciled against the chart before being trusted; a mismatch between the
  judge's label and the detector's finding is recorded as a finding, not
  smoothed over. (Observed: J06 was labelled a day-master error but caught as a
  *polarity* error — the detector's diagnosis was more precise than the judge's
  label.)
- The taxonomy differs between judge and detector (`relations` vs
  `relationKind`/`relationsAbsence`). Broad-label mismatches are not detection
  failures; they are reported separately.
- Extending either set is now cheap and expected. Both are files in the repo and
  re-runnable.

## Not decided here

- How many adversarial cases constitute adequate coverage.
- Whether a third, independent author should be introduced (a different model
  family) when recall on the judge's set saturates.
- Whether naturally-generated (non-corrupted) readings should be sampled for
  real-world defect discovery, as opposed to injected ones.
