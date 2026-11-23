# ADR 0001 — Judging generated readings: dev-side judge, with self-testing before release

- **Status:** Accepted (amended in part by ADR 0002 — see "Amendment")
- **Date:** 2026-10-13
- **Deciders:** Kevin Pratama

> **Amendment (2026-10-14, by ADR 0002).** The judge is **developer-side**, not a
> production component. It never sits in the request path. Original wording below
> placed the big-LLM judge in production on a periodic cadence; that placement is
> superseded. See "Judge placement" for the corrected boundary.

## Context

The product serves consumer readings generated from a deterministic chart engine. Facts are computed by code and are verifiable. Interpretation is prose and has no answer key.

We need quality control on generated readings that scales, without relocating the trust problem from the generator to the judge. The project's founding finding is that models produce fluent, well-formatted, confidently wrong output — so any judge is itself suspect until measured.

Options considered:

- **Human review only** — highest quality, does not scale past a few hundred pieces.
- **Structural checks + human spot-review** — code enforces checkable facts; humans sample. Scales, but spends scarce review on every frozen piece.
- **Model-as-judge with a rubric** — initially rejected on the grounds that a judge rating fluency would reward invented readings. This rejection was wrong: it assumed the judge only assesses style. A judge equipped with the engine as a *tool* can re-derive facts rather than trust them.
- **Multi-judge with disagreement as routing signal** — reserved, not adopted now.

## Decision

**Model-as-judge, in two layers — both developer-side.**

1. **Development judge: a big LLM, run on demand and periodically for evals.** It
   has the engine exposed as a tool, so factual claims are checked by
   re-computation, not by opinion. It audits the generator, the extractor, and the
   verdicts. It does not serve user requests.

2. **Pre-release judge: ourselves, first.** Nothing reaches production without
   being tested by us beforehand. A second, independently prompted model acts as the second judge in the
   development loop — independent of the generating model, and independently
   checkable, since his verdicts can be validated against the engine.

## Judge placement

The judge sits **outside** the production pipeline. The production path is:

```
chart (CODE) -> GENERATOR writes reading -> EXTRACTOR pulls claims
             -> CODE compares -> reading served
```

The judge looks down at that loop:

```
JUDGE (dev-side) -> evals the generator, the extractor, and the verdicts
```

Rationale for dev-side: the judge is expensive and slow, and there is no reason
for a user request to wait on it. Production truth-checking is handled by the
deterministic verdict engine (ADR 0002), which is cheap enough to run per
request. Using a model as a *runtime* judge would invert the project's founding
rule (code decides truth) for no benefit.

## Rationale

- A judge with engine tools converts factual claims from opinion into pass/fail. "Your day master is 丁" is settled by calling the engine.
- **Dev-side placement** removes an expensive, slow model from the request path while keeping it available for the evals that matter. It also keeps the judge free to be as thorough and as slow as it needs to be.
- Self-testing before release is what makes the judge trustworthy rather than merely assumed. It also gives the judge its own eval: corrupted readings with known defects measure judge recall.
- Two judges in development (the independent judge plus the generating model's own output under review) provide bias independence at near-zero cost.
- The judge's first high-value task is **authoring corruptions the extractor's author would not think of**, so the eval set stops being a rigged exam written by the same party who wrote the checker.

## Consequences

- The judge must have a **tool interface to the engine**. This is a prerequisite, not a nicety — without it the judge degrades to style assessment.
- A **corrupted-reading eval set** is required to measure judge recall. Known-defect samples (swapped pillar, wrong day master, invented Ten God, contradicted element balance) with known-correct verdicts.
- Judge verdicts are themselves auditable: a verdict that contradicts the engine is a measurable judge error.
- Interpretive claims remain graded, not pass/fail. Only factual claims are binary. The distinction is preserved in the verdict schema.
- Because the judge is not in the request path, **readings are not required to be frozen** for this decision to hold. Freezing remains a product choice (drift, latency, cost), tracked separately.

## Not decided here

- The specific big-LLM judge model.
- Judge cadence, and what triggers escalation.
- Whether to add a third judge when disagreements cluster.
- Retention policy for judge verdicts.
