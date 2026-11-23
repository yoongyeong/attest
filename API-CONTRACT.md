# API contract

**Version:** v1 (draft, 2026-10-16)
**Status:** for review. No implementation depends on this yet.
**Shape chosen:** **B — typed resources** (see §2)

---

## 1. Scope and principles

The API serves **one thing**: a profile — everything computable about a person's chart,
and the interpretations attached to it.

Principles, inherited from the project's architecture:

1. **Stateless and pure.** `profile` is a pure function of its inputs. No accounts, no
   storage, no sessions. Everything is computable from `(birth, date, gender, partner)`.
   This also sidesteps personal-data retention entirely — see `BUSINESS.md` §4.
2. **Verified facts are never model-generated.** Anything in a `verified-fact` register
   is computed by code.
3. **Partial availability is explicit.** Missing inputs produce `unavailable` entries
   with reasons — never a silent omission, never an error.
4. **Provenance is always present.** Every interpretation names the fragment set and key
   that produced it. This is the accountability view; it is the product's differentiator
   and is not optional.

---

## 2. Response shape

Every block in a profile is the **same shape**, whether it is a daily fragment or the
compatibility reading:

```json
{
  "surface":    "daily",
  "timescale":  "day",
  "epistemic":  "interpretation",
  "title":      "Today · 2026-10-16",
  "sections":   { "overall": "...", "career": "..." },
  "meta":       { "key": "正官|土", "state": "正官/土" },
  "provenance": [ { "set": "daily", "key": "正官|土" } ]
}
```

A client renders generically: group by `epistemic`, order by `timescale`, print
`sections`. No per-surface special-casing.

**Why not raw blocks (A):** `profile()` currently mixes `lines` (facts) and `sections`
(interpretations), which forces every client to reimplement rendering — and the shape is
an internal detail that should be free to change.

**Why not per-surface endpoints (C):** it would discard the composition layer's value.
One call yields the whole picture, with `synthesis` present precisely *because* the
surfaces compose.

---

## 3. Endpoints

### `POST /v1/profile`

One call, all surfaces.

**Request**

```json
{
  "birth":   { "date": "1980-03-15", "time": "09:20" },
  "date":    "2026-10-16",
  "gender":  "male",
  "partner": { "birth": { "date": "1992-07-22", "time": "14:05" } },
  "surfaces": ["facts", "daily", "annual", "cycles", "synthesis", "compatibility"]
}
```

| Field | Required | Notes |
|---|---|---|
| `birth.date` | **yes** | `YYYY-MM-DD` |
| `birth.time` | no | `HH:MM`. Absent → hour pillar not computed; daily/cycles still work |
| `date` | no | defaults to server's today |
| `gender` | no | `male` \| `female`. Required for `cycles` |
| `partner.birth` | no | required for `compatibility` |
| `surfaces` | no | defaults to all applicable |

**Response**

```json
{
  "version": "v1",
  "subject": {
    "dayMaster": "丁",
    "pillars": "庚申 己卯 丁亥 乙巳",
    "birth": { "date": "1980-03-15", "time": "09:20" },
    "date": "2026-10-16",
    "year": 2026
  },
  "availability": {
    "facts":         { "status": "available" },
    "daily":         { "status": "available" },
    "annual":        { "status": "available" },
    "cycles":        { "status": "available" },
    "synthesis":     { "status": "available" },
    "compatibility": { "status": "available" }
  },
  "blocks": [ /* the shape in §2, in presentation order */ ],
  "counts": { "blocks": 7, "verifiedFact": 2, "interpretation": 5 }
}
```

`availability` replaces the current `warnings` strings. Each surface reports one of:

| status | meaning |
|---|---|
| `available` | computed and present in `blocks` |
| `unavailable` | missing an input; `reason` explains which |
| `skipped` | excluded by the request's `surfaces` filter |

```json
"cycles": { "status": "unavailable", "reason": "gender required for cycle direction" }
```

**Why an explicit map:** a client deciding what to render needs a machine-readable answer
per surface, not a list of prose warnings. Reasons stay human-readable for logging.

### `GET /v1/health`

Liveness only. No chart work.

```json
{ "ok": true, "version": "v1", "fragments": { "daily": 50, "annual": 66, "compatibility": 60, "synthesis": 80 } }
```

Fragment counts confirm the sets loaded — a missing set is a deploy fault, and this makes
it visible without computing a chart.

### Not in v1

- No user accounts, no saved profiles, no history.
- No streaming.
- No per-surface endpoints. If a client wants only the daily, it passes
  `"surfaces": ["daily"]`.

---

## 4. Presentation order

The server returns blocks in the order the product presents them:

1. `verified-fact` blocks first — chart, then cycles
2. interpretation blocks by timescale — `day`, `year`, then `synthesis`, then `pair`

Rationale: the trust anchor (computed facts the user can check) leads; interpretation
follows; synthesis appears once both its constituent timescales are present.

Clients may reorder for layout, but the default order is the product's opinion.

---

## 5. Errors

| Case | HTTP | Body |
|---|---|---|
| Malformed JSON / unparseable date | `400` | `{ "error": "invalid_request", "detail": "..." }` |
| Missing `birth.date` | `400` | `{ "error": "invalid_request", "detail": "birth.date is required" }` |
| Internal fault | `500` | `{ "error": "internal", "detail": "..." }` |

**A partial profile is not an error.** Missing gender, missing partner, or a date whose
surfaces are unavailable all return `200` with `availability` explaining the gaps. Only a
malformed request or a genuine fault is non-200.

This matters: a client should never have to parse an error body to learn that the user
simply didn't supply a gender.

---

## 6. Versioning

- Path-versioned: `/v1/…`
- Additive changes (new surface, new field) do not bump the version
- Removing a field, changing `sections` semantics, or altering `provenance` shape does
- Fragment content changes (regenerating a set) are **not** API changes — same shape,
  different text

---

## 7. Open questions

1. **`birth.time` absent.** Currently the hour pillar is simply not computed. Should the
   response say so in `availability.facts` (a fourth status: `partial`), or is a quieter
   `subject.pillars` with three pillars enough? *Lean: `partial` status — consistent with
   the principle that gaps are explicit.*
2. **Partner as a profile?** If a user profiles two people and then wants compat, they
   must send both. Acceptable at v1; revisit if the UI wants saved pairs.
3. **Caching.** Pure function, deterministic → strongly cacheable by request hash. Not in
   v1, but the shape (no state) makes it trivial later.
4. **Fragment-set versioning.** If a set is regenerated after review, old responses are
   not reproducible. Should `meta` carry the fragment generation timestamp? *Lean: yes —
   it is already tracked in each set's JSON.*
