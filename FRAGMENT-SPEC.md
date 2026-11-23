# Fragment-generation spec (daily fortune)

**Status:** agreed 2026-10-15. Governs generation of the daily-fortune fragment library.

---

## 1. The fragment key

A daily fortune is keyed to an **interpretive state**, not to a chart:

```
state = ( Ten God of today's stem vs the user's day master , element of today's branch )
       = 10 x 5 = 50 states
```

Measured in `daily-fragments.js`: all 50 states are reachable, and all 600 raw
(day pillar × day master) pairs collapse onto them 12:1. Fragments are the unit of
precomputation; 50 fragments cover the whole day-pillar space.

**Why the collapse is legitimate, not a shortcut:** the interpretation of a day
depends on what relation it forms to *you* (the Ten God) and its elemental flavour
(the branch element). The bare pillar string carries no additional meaning.

---

## 2. Register: COMBINATION style, ASPIRATIONAL voice

One register only. Mixing registers produces an inconsistent voice and, somewhere
in the mix, a verifiable claim. Decision: **combination style, aspirational voice.**

Combination means:

- **Named domains** — the reading keeps the familiar five sections, so it reads
  like a fortune rather than an essay.
- **Modal / tendency language** — this is the mechanism that makes it
  unfalsifiable. Two families are permitted:

  *Tendency verbs:* `favours`, `leans toward`, `may find`, `best used for`,
  `watch for`, `suggests`, `tends to`, `is well suited to`

  *Permission constructions (the aspirational layer):* `you have the room to`,
  `you are invited to`, `this is a day that rewards`, `this is a day that suits`,
  `you have the space to`, `you are free to`, `this energy supports`

- **Texture + advice** — describe the day's character *and* say what to do with it.
- **No checkable outcomes.** Never `you will`, never a dated event, never a
  guarantee. Nothing provable false tomorrow.

The goal: the user experiences fortune-telling; the product retains nothing that
can be held against it.

### Aspiration without prediction

The aspirational register gives **permission and possibility**, never promise:

| ✅ Aspirational | ❌ Hype (the failure mode) |
|---|---|
| "You have the room to ground your vision" | "Life-changing breakthroughs are GUARANTEED" |
| "This is a day that rewards precision" | "You will be promoted today" |
| "You are invited to move into action" | "Money is about to pour in" |

Aspiration comes from what the day **supports**, never from what will **happen**.
A reference sample of the forbidden register is kept in `aspirational-compare.json`
(the `hype` field) — read it before writing fragments; "don't promise" is abstract,
but that sample makes the line unmissable.

**Guard against corporate-speak.** The aspirational register runs long and can drift
into abstraction ("align your personal intentions with a higher sense of purpose").
Concrete beats abstract: "best used for auditing details" over "align with purpose".

---

## 3. Section structure

Five sections, matching market convention (career 事业 / wealth 财运 / love 感情 /
health, plus an overall). Every state fills all five.

| Section | Purpose |
|---|---|
| `overall` | the day's headline character, naming the state's influence |
| `career` | work, projects, professional posture |
| `money` | earning, spending, financial posture |
| `love` | relationships, connection, interaction style |
| `health` | energy, pacing, equilibrium |

**Thin days.** Some states genuinely do not speak to some domains. Do not invent an
event to fill the gap. Write the *texture* the state lends to that area, or say the
day's energy sits elsewhere. Filler written as event is the failure mode.

---

## 4. Health guardrails

**Permitted** — system-level and energy-level language:

- energy, fatigue, stamina, pacing, recovery
- circulation, digestion, respiratory system as *systems*
- tension, restlessness, calm, grounding
- activity advice: stretching, breathing, rest, hydration

**Forbidden** — anything falsifiable or clinical:

- named conditions or diagnoses (reflux, asthma, migraine, infection)
- specific organs
- symptoms stated as predictions ("you will get a runny nose")
- medical advice or treatment

Rationale: "respiratory system" is legitimately vague — it spans nose, throat,
lungs. A named condition is not, and is the category where the sources warn
hardest.

---

## 5. Voice

- Warm, energising advisor — a coach who believes in the reader.
- **Aspirational, permission-based** (see §2). The reader should close it feeling
there is room to act, not merely informed about the weather.
- Second person, present-tense tendency.
- Name the state's influence in `overall` (e.g. "With the energy of Direct Wealth
  flowing today"), then speak plainly in the rest.
- Concrete over abstract: "best used for auditing details" beats "a precise day".
- No promises, no flattery, no absolutism.

---

## 6. Generation rules

1. **One fragment per state** (50 total). Written once, reviewed once, frozen.
2. **Prompt shape:** state inputs (day master, day pillar, Ten God, branch element)
   + the register rules above. The generator never computes the state; the state is
   supplied from `bazi-tables.js`.
3. **Facts supplied, never derived.** Consistent with ARCHITECTURE.md: the model
   narrates only what it is given.
4. **Model:** `gemma4:31b` (consistent with Phase 2). Swappable via
   `ollama-client.MODELS`.
5. **Checks per fragment:** the automated checker (relation/identity claims) plus a
   manual pass against sections 2–4 of this spec.
6. **Rotation:** if user-visible repetition becomes an issue, add phrasings per
   state (3–5), not new states. 150–250 strings remains fully reviewable.

---

## 7. Verification before shipping

- All 50 fragments generated and stored.
- No fragment contains a forbidden construction (automated scan for `you will`,
  `will happen`, `guaranteed`, `is coming`, named conditions).
- At least one permitted construction present per section (tendency verb or
  permission phrase), confirming the register held rather than drifting neutral.
- Health sections pass the system-level check.
- A sample checked against the adversarial eval approach (ADR 0003): corrupt a
  fragment, confirm the checker catches it.
- Manual read-through for corporate-speak (§2).

---

## 8. Open items

- Whether `overall` should also reference the current decade (大运) context. The
  decade is a separate fragment set, composed rather than multiplied, so this is a
  composition decision — not part of the 50.
- Whether to surface only the 2–3 domains a state genuinely touches, rather than
  all five. Current decision: all five (market convention).
- Repetition tolerance: unknown until measured with real users.
