# Architecture Note: Deterministic Compute + LLM Narration

**Date:** 2026-10-13
**Origin:** BaZi model benchmark (15 hand-verified cases, 3 small models)
**Status:** Architecture validated by measurement; engine implemented at 15/15 exact

---

## 1. The finding

Small, cheap models asked to perform a calculation produce output that is **fluent, well-formatted, and wrong** — with no signal that anything failed.

Measured on the same 15 cases, same prompt, same session:

| Model | Answered | Exact four-pillar match | Day pillar (arithmetic) | Year/Month (lookup) |
|---|---|---|---|---|
| `glm-5.3-flash:cloud` | 7/15 | 6 | 6/7 | 7/7, 7/7 |
| `gemma4:31b` | 15/15 | 1 | **1/15** | 12/15, 13/15 |
| `gpt-oss:20b` | 11/15 | 0 | **0/11** | 6/15, 1/15 |

The split is not diffuse. It is clean and repeatable:

- **Lookup/recal** (year and month pillars, derived from solar-term boundaries) — models handle this well.
- **Multi-step arithmetic** (the day pillar: count days in a 60-day cycle from an anchor, mod 60, then derive the hour pillar) — models fail, and fail *silently*.

`gemma4:31b` is the sharpest illustration: 15/15 answered, 1.5s each, zero errors, and a day pillar wrong 14 times out of 15. It did not miscalculate — it emitted a plausible-looking constant across different inputs. That is pattern-matching, not computation.

**Prompt engineering does not fix this.** Three rewrite variants (original, day-pillar-first with explicit method, step-by-step "work it out") produced three *different* failure modes and zero improvement on the day pillar. The model has no day-pillar procedure to surface; better instructions only destabilize the output format. This is a capability ceiling, not a communication gap.

---

## 2. The rule

> **Deterministic work goes to code. Ambiguous work goes to the model.**
> The model orchestrates and narrates. It never computes what a function can compute.

Corollary: **a model that fails loudly is safer than one that succeeds silently.**

---

## 3. The layered design

```
User input (messy, conversational)
        │
        ▼
┌───────────────────────────────┐
│ Layer 1 — Deterministic core  │   lookup tables + exact arithmetic
│  • solar-term instants        │   code, not model
│  • cycle/modulo arithmetic    │   microseconds, 0% error
│  • rule application           │   auditable, testable
└───────────────────────────────┘
        │  structured, verified facts
        ▼
┌───────────────────────────────┐
│ Layer 2 — LLM narration       │   language, ambiguity, dialogue
│  • interpret structured facts │   small/cheap models are FINE here
│  • handle messy input         │   no single correct string to fake
│  • explain, answer, converse  │
└───────────────────────────────┘
        │
        ▼
   User-facing output
```

### What goes where

| Concern | Layer | Why |
|---|---|---|
| Date/time arithmetic | **1 — code** | Deterministic; models fail silently |
| Lookup tables, reference data | **1 — code** | Deterministic; cheaper and exact |
| Rule application, validation | **1 — code** | Deterministic; must be testable |
| Boundary/precision handling | **1 — code** | Requires exact data, not approximation |
| Parsing messy user input | **2 — model** | Genuinely ambiguous |
| Ambiguity resolution in dialogue | **2 — model** | Conversational |
| Explanation, interpretation | **2 — model** | Language-shaped; no single right answer |
| Multi-turn context | **2 — model** | Dialogue |

---

## 4. Evidence: the engine that replaced the models

A ~150-line deterministic implementation (`bazi.js`) was built and validated against the same 15 ground-truth cases the models were scored on.

**Result: 15/15 exact.** Microseconds, zero tokens, zero API calls.

For comparison, the best model scored 6/7 (when it answered at all), at ~31 seconds and ~10k tokens per call.

Four defects were found and fixed during development — every one caught by the ground truth, none by inspection:

| Defect | Blast radius | Resolution |
|---|---|---|
| Wrong day-cycle constant | **all 15** day + hour pillars | Derived `(julianDay + 49) mod 60` empirically from six samples; identical across 44 years |
| Month-branch mapping off by one | **all 15** month pillars | Corrected solar-month → branch table |
| 子-hour boundary asymmetry | 3 late-night cases | Day pillar keeps the birth date; the **hour stem** uses the *next* day's stem |
| Li Chun approximated by day-of-month | 3 births on the boundary | Minute-precision solar-term instants |

The last one is the cleanest argument for the whole architecture: **two births two minutes apart (20:39 and 20:41) fall in different years.** The function resolves it because it holds the true timestamp. No model got it right.

---

## 5. Why this matters beyond this task

This was not a BaZi problem. BaZi was a *probe* — a task with a verifiable answer key that cleanly separates computation from pattern-matching. The same failure mode is present anywhere a model is asked to produce a number, a date, a total, a query, or any chained deterministic derivation:

- financial totals and unit conversions
- date/time and calendar logic
- SQL and query construction
- inventory, pricing, eligibility rules
- any multi-step derivation where the intermediate values matter

In each case the model will return something well-formed and plausible. The failure is invisible in the output and invisible in the prose quality. It is only visible against ground truth — which is precisely why the deterministic parts must not be in the model's hands.

---

## 6. Practical consequences

**Do not select a model for arithmetic capability. Remove the arithmetic.**

Once the deterministic layer is offloaded:

- model choice becomes far less critical — the hard part is no longer in the model's hands
- the cheapest/fastest model is often adequate for the narration layer
- `gemma4:31b` (fast, fluent, structurally unable to compute) becomes a *perfectly good narrator*, because it is no longer asked to be anything else

**Evaluation implication:** when comparing models, benchmark them on **the work they will actually do**. These models were not bad — they were tested on work that should never have been delegated to them. A benchmark that measures a model's arithmetic is mostly measuring whether you should have written a function.

**Ground truth is mandatory.** Without an answer key, every one of these failures would have read as a confident success. The value of the 15 verified cases was not the scores — it was that they made the silent failures visible, and then made the fix verifiable.
