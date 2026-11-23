# CONTEXT — Glossary

_This file is a glossary and nothing else. It contains no implementation details, no specs, and no scratch notes._

---

## Product

**BaZi Product** — A tool that takes a birth (date + time) and returns the person's chart: the four pillars and the derived readings (Ten Gods, five-element balance, and later luck cycles and annual pillars). The product is the chart engine. Serving real users is what "production" means here.

**Bench** — The model-evaluation harness built earlier in this project. It used BaZi as a probe task with a verifiable answer key to measure whether models can compute. It is _not_ the product; it is instrumentation that produced one lasting finding. Retained for reference and for validating any future model claims, but not developed further as an end in itself.

**Production** — The state where the BaZi product is live and serving real users. Distinct from the bench, which is a local, temporary evaluation tool.

## Users

**Consumer** — The primary user. Non-technical; enters a birth date and time and expects a reading: prose, meaning, guidance. Does not see raw pillar strings by default and does not need to understand Ten Gods or element cycles to use the product.

**Practitioner** — A user who already knows BaZi and wants fast, correct, complete data. Serves as the accuracy benchmark for the product: if a practitioner cannot verify the output against their own working, the product has failed.

**Accountability view** — The drill-down a consumer can open when they want to see _why_ a reading says what it says: the computed pillars, Ten Gods, and element balance behind the prose. Not shown by default; the consumer-facing reading is the default surface. The distinction between the default reading and the accountability view is a product boundary, not a UI detail.

---

## Surfaces

**Reading** — The default consumer-facing output: prose interpretation of a chart. This is what the product shows first. It presents meaning and guidance, not raw pillar strings.

**Accountability view** — The optional drill-down behind a reading: the computed pillars, Ten Gods, and element balance that the prose was derived from. Available on demand, never shown by default. Its existence is what lets a consumer product still be trustworthy: the interpretation can be checked against the deterministic facts at any time.

---

## Domain

**Chart** — The complete computed output for one birth: pillars plus derived layers (Ten Gods, element balance). The unit the product returns.

**Pillar** — One of the four positions (year, month, day, hour), each expressed as a two-character pair of stem + branch (e.g. 庚申). "Four Pillars" (八字 / BaZi) is the chart as a whole.

**Stem (天干)** — One of ten characters, each carrying an element and a yin/yang polarity. The "top half" of a pillar.

**Branch (地支)** — One of twelve characters, each carrying a primary element plus hidden stems. The "bottom half" of a pillar.

**Day Master (日主)** — The stem of the day pillar. Serves as the reference point for the entire chart; every Ten God is defined relative to it.

**Ten Gods (十神)** — The _relationship_ between the day master and another stem. Ten possible relationships (five element-relations x two polarities). Derived, not intrinsic: the same stem is a different Ten God depending on the day master. A relationship layer drawn over the five-element cycles — not a separate system, and not an alternative "school".

**Five Elements (五行)** — Wood, Fire, Earth, Metal, Water. The substance layer: every stem and branch is one of these. Two directed cycles operate over them — the generating cycle (生) and the controlling cycle (克). The Ten Gods are defined in terms of these cycles.

**Element Balance** — The distribution of the five elements across a chart, as counts or percentages. The weighting convention (whether hidden stems count, and how much) is deliberately configurable, because it is school-dependent and has no single correct answer — unlike pillars, which are deterministic.

**Hidden Stems (藏干)** — The stems carried inside a branch, in addition to its primary element. One to three per branch. They are part of the domain, not an implementation detail.

---

## Interpretation

**Reading** — The consumer-facing prose interpretation of a chart. Generated during development by small, cheap models; not generated live in production. What is generated and proven good is expected to be precomputed and frozen (see Precomputed Reading below).

**Interpretation vs Fact** — A _fact_ is a computed property of the chart (pillar strings, day master, Ten Gods, element balance). A _fact_ is verifiable against the chart by code. An _interpretation_ is a meaning attributed to those facts ("generous but easily drained"). An interpretation has no answer key; it is not verifiable at runtime, and it is not a fact. The two are never conflated in the product.

**Precomputed Reading** — A reading generated once, reviewed once, then served unchanged forever. Preferred over live generation: zero drift, zero latency, zero per-request cost, and no possibility of a model deviating in production. The combinatorial space (distinct charts) is large — see the distinct-chart count — so precomputation is expected to operate on _fragments_ that compose, not on whole readings for every chart.

**Fragment** — A precomputed, vetted piece of interpretation keyed to a domain state (e.g. an element balance shape, or a Ten God in a position). Fragments compose into a full reading. Fragments are the unit of precomputation; whole readings for the full chart space are not feasible.
