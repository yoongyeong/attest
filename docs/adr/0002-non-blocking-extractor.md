# ADR 0002 — Runtime fact-checking: non-blocking, logged, toggleable extractor

- **Status:** Accepted
- **Date:** 2026-10-14
- **Deciders:** Kevin Pratama
- **Amends:** ADR 0001 (which placed the big-LLM judge in production; the judge is dev-side)

## Context

The product pipeline is:

```
chart (CODE, deterministic, 15/15 verified)
   → GENERATOR writes the consumer reading
   → EXTRACTOR pulls structured claims from that prose
   → CODE compares each claim against the chart  → verdict
   → reading served to the consumer
```

The judge (ADR 0001) lives **outside** this loop, on the developer side. Its job is evaluating the generator, the extractor, and the verdicts — it never touches a user request.

Question raised: why have the extractor in the production path at all, rather than generator + dev-side evals only?

The distinction that decided it: **check timing**, not traceability. Without the extractor there is no request-time check; a false reading reaches the consumer and is only caught later, on a sample.

## Decision

**Keep the extractor in the production path, with three properties:**

1. **Non-blocking.** The reading is served regardless of the verdict. The check never withholds output.
2. **Logged.** Every verdict is recorded: the claim, the chart value, and the comparison result. The log is the evidence base for deciding whether the extractor earns its place.
3. **Toggleable.** A single switch disables extraction and verification entirely, so the pipeline can run without it at any time — and can be re-enabled without code changes.

The check exists to produce **evidence**, not to gate. Whether it becomes blocking is a later decision, to be made from the logged flag rate.

## Rationale

- **Non-blocking** because the stakes are low (an interpretation product, not a medical or financial one) and because an unproven check should not be allowed to degrade the consumer experience before it has earned trust.
- **Logged** because "does this catch anything?" is answerable from data, and the alternative — arguing about it — is not. If the flag rate is ~zero, the extractor is dead weight and the toggle turns it off. If it catches lies at a meaningful rate, it has demonstrated its value.
- **Toggleable** because the cheapest way to resolve the question is to run with it and without it, and compare. A feature that cannot be turned off is a feature that cannot be evaluated.

## Consequences

- The extractor's output feeds CODE; CODE produces the verdict. CODE only compares — it extracts nothing and generates nothing. **CODE's reach is bounded by the extractor's recall:** a claim the extractor misses is a claim CODE never sees. This coupling is the extractor's real risk and the thing the dev-side judge exists to measure.
- A verdict of `pass` therefore means "no problem found in the claims extracted", not "the reading is true". The log must not be read as a clean bill of health.
- Logging needs a schema stable enough to analyse later (claim type, claimed value, expected value, result, extractor version, toggle state).
- Toggle state should be recorded with each verdict, so logs from enabled and disabled periods are never conflated.

## Not decided here

- The threshold at which the extractor becomes blocking, if ever.
- Whether the toggle is per-deployment, per-user, or per-request.
- Retention policy for the verdict log.
