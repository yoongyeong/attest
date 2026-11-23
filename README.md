# Attest

A consumer reading product built as a two-layer system: **code computes every fact, the model only narrates, and a checker measures whether the narration is true to the chart.**

The domain is BaZi (Four Pillars). The engineering question is general: how do you let a language model write personalised prose without letting it invent or contradict the facts?

## The rule

> Deterministic work goes to code. Ambiguous work goes to the model.
> The model orchestrates and narrates; it never computes what a function can compute.

## Architecture

```
birth (date + time) [+ gender for cycles]
        |
   ENGINE            deterministic, no model
   pillars, Ten Gods, elements, relations, luck cycles
        |
   FRAGMENT SETS     precomputed and reviewed
   daily 50 | annual 66 | compatibility 60 | synthesis 80
        |
   COMPOSER          provenance + epistemic separation
   [VERIFIED] facts | [READING] interpretation | collision log
        |
   GENERATOR         LLM writes from injected facts only
        |
   CHECKER           extracts claims, compares them to the chart in code
   non-blocking, dev-side, logged
```

## Quick start

```bash
npm install

# engine tests (no API key needed)
node bazi.js                    # 15/15 exact
node validate-luck-pillars.js   # 24/24 exact

# full profile for the built-in fixture (no API key needed)
node profile.js male
```

The generator and extractor need an LLM credential. Set `OLLAMA_API_KEY` in your environment or use the key-file path described in `ollama-client.js`. Never commit a key.

```bash
node pipeline.js "1980-03-15 09:20"       # reading + verdict
node pipeline.js "1980-03-15 09:20" off   # reading only, no checking
```

## Evaluation

- 400 charts, 2,023 generated claims: **6.57% wrong overall**
- Identity claims (day master, polarity, dominance): **0 / 1002 wrong**
- Relation claims: **13.2% wrong**; error rises with relation load
- Hand-written corruption suite: **5/6 caught (83.3%), 0 false positives**; the miss is an invented relation claim
- Judge-authored adversarial set: **6/6 flagged**, only **3/6 with the correct claim type**

```bash
node corruption-eval.js
node run-judge-eval.js
```

The method and the five decisions behind it are in `docs/adr/`.

## Design decisions

1. **Judging is dev-side, never in the request path.**
2. **Checking is non-blocking** — it produces evidence for the operator, not a gate for the user.
3. **A detector's own test set overstates its quality** — the checker is measured on charts it did not author.
4. **A composition layer owns provenance** — `[VERIFIED]` and `[READING]` are rendered separately; primary and secondary groups are explicit.
5. **Precomputed fragments make this a fixed-cost product** — no per-request model call, no token bill at serve time.
6. **Catching a lie is easier than naming it** — the adversarial set was flagged 6/6 but typed correctly only 3/6.

## Scope and limits

This is an interpretive product, not a prediction engine: readings are precomputed fragments selected by chart state, not forecasts. It is not medical, legal or financial advice.

## License

TBD.
