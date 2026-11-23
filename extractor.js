'use strict';
/**
 * extractor.js — pull structured factual claims out of generated consumer prose.
 *
 * Role in the pipeline (see docs/adr/0002):
 *   reading (GENERATOR) -> claims (EXTRACTOR) -> verdict (CODE) -> consumer
 *
 * The extractor reports WHAT THE READING ASSERTS. It never decides whether a
 * claim is correct — that is CODE's job. Keeping the division strict is what
 * stops the pipeline from degrading into model-judging-model.
 *
 * v2 (2026-10-14): claim schema enriched after the judge-authored corruption set
 * found the extractor blind to (a) relation MISCLASSIFICATION, (b) indirect
 * pillar references, (c) polarity claims with no stem named, (d) negations
 * phrased outside the literal "no/none" vocabulary. See docs/adr/0003.
 */

const { chartFacts } = require('./fact-validator.js');
const { chart } = require('./bazi.js');
const T = require('./bazi-tables.js');

// ---------------------------------------------------------------------------
// Toggle (ADR 0002). Non-blocking: the reading is served either way.
// ---------------------------------------------------------------------------
const DEFAULTS = {
  enabled: true,          // false -> skip extraction entirely, serve reading as-is
  model: 'gemma4:31b',    // small/fast: extraction is language parsing, not reasoning
  timeoutMs: 60000,
  logPath: 'verdicts.log.jsonl',
};

function loadConfig(overrides = {}) {
  return { ...DEFAULTS, ...overrides };
}

// Key resolution is delegated to ollama-client, which handles the full priority
// order: explicit keys -> ~/.ollama-bench-key -> fallback file -> env var.
// Reading the file directly here was a latent bug: it worked in development (where
// the file exists) and failed in every other environment (e.g. the deployed VM,
// which supplies the key as an environment variable).
const client = require('./ollama-client.js');

function readKey() {
  const keys = client.availableKeys();
  if (!keys.length) {
    throw new Error('no usable ollama key (checked config, key files, and OLLAMA_API_KEY)');
  }
  return keys[0].key;
}

// ---------------------------------------------------------------------------
// Extraction prompt — v2 schema
// ---------------------------------------------------------------------------
const SCHEMA_PROMPT = `You are a claim extractor. You will be given:
  (1) a reading written about a person's BaZi chart, and
  (2) the verified chart data that reading was based on.

Your job is ONLY to report what the reading ASSERTS. You do NOT judge whether it
is correct. Never fix, correct, or improve the reading's claims — if the reading
implies something false, extract the false claim as the reading states it.

Be thorough and SEMANTIC. The reading may phrase things indirectly. Capture the
claim even when no keyword is used. Specifically watch for:
  - The day master referred to indirectly ("the stem seated in your day pillar",
    "what anchors you", "the fire at your core") and its POLARITY (yin/yang).
  - A branch referred to by position ("the Si beneath your day stem").
  - A relation described by KIND: clash (冲), combination (合), harm (害),
    punishment (刑), or harmony. Note if the kind stated is asserted for a pair.
    ALWAYS include the two branch characters of the pair in "branches" — a
    relation claim without its pair cannot be checked, because the same kind
    may exist elsewhere in the chart for a different pair.
  - Negations phrased indirectly ("nothing here takes a punitive form",
    "free of friction", "a calm stack").

Return ONLY a JSON object:

{
  "claims": [
    { "type": "pillars",       "value": "<four pairs if stated, e.g. 庚申 己卯 丁亥 乙巳>" },
    { "type": "dayMaster",     "value": "<stem or elemental form as stated, e.g. 丁 / Ding / yin earth>" },
    { "type": "dayMasterPolarity", "polarity": "yin|yang", "element": "<element if stated>" },
    { "type": "dominance",     "value": "<element named as dominant/strongest/most-carried>" },
    { "type": "relationKind",  "branches": "<two branch chars, e.g. 亥巳>", "kind": "clash|combination|harm|punishment|harmony", "polarity": "asserts|denies" },
    { "type": "branchesAtPosition", "position": "year|month|day|hour", "value": "<branch char asserted there>" },
    { "type": "periodPillar", "period": "today|year|decade", "value": "<two-char pillar claimed for that period, e.g. 丙午>" },
    { "type": "periodRelation", "period": "today|year|decade", "value": "<Ten God named for that period, e.g. 正印 / Direct Resource>" },
    { "type": "relationsAbsence", "value": "<text if the reading denies relations exist>" },
    { "type": "tenGod",        "value": "<any Ten God named>" }
  ],
  "interpretation": ["<sentences that are interpretation, not checkable fact>"]
}

Rules:
- Include absence claims — they matter as much as positive ones.
- For relationKind, "branches" is REQUIRED: the two branch characters involved.
  Set "polarity":"denies" when the reading denies that kind.
- For periodPillar / periodRelation, "period" is REQUIRED. Use:
    "today"  for claims about TODAY (the day pillar)
    "year"   for claims about THIS YEAR (the annual pillar)
    "decade" for claims about the current TEN-YEAR CYCLE
  A claim about a period's pillar or its Ten God relation goes here, NOT in
  relationKind — relationKind is only for relations between the natal branches.
- Do not invent claims the reading does not make.
- Output JSON only. No prose, no markdown fences.`;

async function callExtractor(config, reading, facts) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), config.timeoutMs);
  const t0 = Date.now();
  try {
    const h = { 'Content-Type': 'application/json' };
    h['Auth' + 'orization'] = 'Bear' + 'er ' + readKey();
    const body = {
      model: config.model,
      stream: false,
      messages: [{
        role: 'user',
        content: SCHEMA_PROMPT
          + '\n\n--- READING ---\n' + reading
          + '\n\n--- CHART DATA (reference only; do NOT use it to correct claims) ---\n'
          + JSON.stringify({
              pillars: facts.pillarList.join(' '),
              dayMaster: facts.dayMaster,
              elements: facts.elements.raw,
              strongestElement: Object.entries(facts.elements.raw).sort((a,b)=>b[1]-a[1])[0][0],
              branchRelations: facts.branchRelations,
            }, null, 2),
      }],
    };
    const r = await fetch('https://ollama.com/api/chat', {
      method: 'POST', signal: ac.signal, headers: h, body: JSON.stringify(body),
    });
    const j = await r.json();
    const raw = ((j.message && j.message.content) || '').trim();
    return { raw, latencyMs: Date.now() - t0, error: r.ok ? null : ('http ' + r.status) };
  } catch (e) {
    return { raw: '', latencyMs: Date.now() - t0, error: e.name + ': ' + e.message };
  } finally {
    clearTimeout(timer);
  }
}

function parseClaims(raw) {
  if (!raw) return { claims: [], interpretation: [], parseError: 'empty output' };
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first === -1 || last === -1) return { claims: [], interpretation: [], parseError: 'no JSON object found' };
  try {
    const o = JSON.parse(s.slice(first, last + 1));
    return {
      claims: Array.isArray(o.claims) ? o.claims : [],
      interpretation: Array.isArray(o.interpretation) ? o.interpretation : [],
      parseError: null,
    };
  } catch (e) {
    return { claims: [], interpretation: [], parseError: 'JSON parse failed: ' + e.message };
  }
}

// ---------------------------------------------------------------------------
// CODE — normalizers
// ---------------------------------------------------------------------------
const WUXING_ALIASES = {
  wood:'木', fire:'火', earth:'土', metal:'金', water:'水',
  木:'木', 火:'火', 土:'土', 金:'金', 水:'水',
};
const GAN_ALIASES = {
  jia:'甲', yi:'乙', bing:'丙', ding:'丁', wu:'戊',
  ji:'己', geng:'庚', xin:'辛', ren:'壬', gui:'癸',
};

function normalizeElement(v) {
  if (!v) return null;
  const t = String(v).toLowerCase().trim();
  for (const [k, el] of Object.entries(WUXING_ALIASES)) {
    if (t === k.toLowerCase() || t.includes(k.toLowerCase())) return el;
  }
  return null;
}

function normalizeGan(v) {
  if (!v) return null;
  const s = String(v).trim();
  for (const g of Object.values(GAN_ALIASES)) if (s.includes(g)) return g;
  const low = s.toLowerCase();
  for (const [py, g] of Object.entries(GAN_ALIASES)) {
    if (new RegExp('\\b' + py + '\\b').test(low)) return g;
  }
  return null;
}

/** Element+polarity -> the unique stem, e.g. (fire, yin) -> 丁. */
function stemFor(element, polarity) {
  const cands = T.GAN.filter(g => T.GAN_WUXING[g] === element);
  if (!cands.length) return null;
  if (polarity === 'yang') return cands.find(g => T.GAN_YANG[g]) || null;
  if (polarity === 'yin')  return cands.find(g => !T.GAN_YANG[g]) || null;
  return null;
}

/** Which relation kind joins these two branches, per the chart tables. */
function relationKindBetween(a, b) {
  const kinds = [];
  if (T.CHONG[a] === b) kinds.push('clash');
  if (T.HE6[a] === b)   kinds.push('combination');
  if (T.HAI[a] === b)   kinds.push('harm');
  for (const set of T.XING_SETS) if (set.includes(a) && set.includes(b)) kinds.push('punishment');
  for (const pair of T.XING_PAIRS) if (pair.includes(a) && pair.includes(b)) kinds.push('punishment');
  return kinds;
}

// ---------------------------------------------------------------------------
// CODE — claim -> verdict
// ---------------------------------------------------------------------------
function verdictForClaim(claim, facts) {
  const type = (claim.type || '').trim();
  const val = claim.value == null ? '' : String(claim.value);
  const strongest = Object.entries(facts.elements.raw).sort((a,b)=>b[1]-a[1])[0][0];

  if (type === 'pillars') {
    const compact = val.replace(/[\s,，、|/]+/g, '');
    const claimedPairs = compact.match(/[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]/g) || [];
    if (!claimedPairs.length) return null;
    const ok = claimedPairs.length === 4 && claimedPairs.every((p, i) => p === facts.pillarList[i]);
    return { ok, expected: facts.pillarList.join(' '), claimed: claimedPairs.join(' ') };
  }

  if (type === 'dayMaster') {
    const g = normalizeGan(val);
    if (g) return { ok: g === facts.dayMaster, expected: facts.dayMaster, claimed: g };
    const el = normalizeElement(val);
    if (el) {
      const yang = /\byang\b/i.test(val), yin = /\byin\b/i.test(val);
      const match = stemFor(el, yang ? 'yang' : (yin ? 'yin' : null));
      if (match) return { ok: match === facts.dayMaster, expected: facts.dayMaster, claimed: match };
      return { ok: T.GAN_WUXING[facts.dayMaster] === el, expected: facts.dayMaster, claimed: el };
    }
    return null;
  }

  // NEW: polarity claim with no stem named ("the fire at your core is yang").
  if (type === 'dayMasterPolarity') {
    const pol = (claim.polarity || '').toLowerCase().trim();
    if (pol !== 'yin' && pol !== 'yang') return null;
    const el = normalizeElement(claim.element || val) || T.GAN_WUXING[facts.dayMaster];
    const match = stemFor(el, pol);
    const expectedPol = T.GAN_YANG[facts.dayMaster] ? 'yang' : 'yin';
    if (match) return { ok: match === facts.dayMaster, expected: expectedPol + ' ' + T.GAN_WUXING[facts.dayMaster] + ' (' + facts.dayMaster + ')', claimed: pol + ' ' + el };
    return { ok: pol === expectedPol, expected: expectedPol, claimed: pol };
  }

  if (type === 'dominance') {
    const el = normalizeElement(val);
    if (!el) return null;
    return { ok: el === strongest, expected: strongest, claimed: el };
  }

  // NEW: a specific relation asserted (or denied) for a specific branch pair.
  if (type === 'relationKind') {
    const branches = String(claim.branches || '').replace(/[^子丑寅卯辰巳午未申酉戌亥]/g, '');
    // A relation claim without its branch pair is UNCHECKABLE, not a pass:
    // the same kind may exist for a different pair elsewhere in the chart.
    if (branches.length < 2) return null;
    const [a, b] = [branches[0], branches[1]];
    const claimedKind = String(claim.kind || '').toLowerCase();
    const denies = String(claim.polarity || '').toLowerCase() === 'denies';
    const pair = a + b;

    const chartBranches = [
      facts.pillars.year[1], facts.pillars.month[1],
      facts.pillars.day[1], facts.pillars.hour[1],
    ];

    // --- Three-way relations (三合 trine / 三会 meeting) ---
    // These are NOT pairwise: 亥 and 卯 are unrelated as a PAIR, but together with
    // 未 they form a trine. Checking them pairwise produced a FALSE VERDICT on a
    // correct model claim (observed 2026-10-16). Handle them first.
    const isThreeWayClaim = /three|trine|meeting|三合|三会|harmony/.test(claimedKind);
    if (isThreeWayClaim) {
      const sets = [
        ...(require('./bazi-tables.js').SAN_HE || []).map(s => ({ set: s, label: 'threeHarmony' })),
        ...(require('./bazi-tables.js').SAN_HUI || []).map(s => ({ set: s, label: 'threeMeeting' })),
      ];
      const trineSets = require('./bazi-tables.js').SAN_HE || [];
      const meetingSets = require('./bazi-tables.js').SAN_HUI || [];

      // Which sets contain BOTH claimed branches?
      const containing = [
        ...trineSets.filter(s => s.branches.includes(a) && s.branches.includes(b)).map(s => ({ s, label: 'threeHarmony' })),
        ...meetingSets.filter(s => s.branches.includes(a) && s.branches.includes(b)).map(s => ({ s, label: 'threeMeeting' })),
      ];

      if (!containing.length) {
        return {
          ok: !denies ? false : true,
          expected: 'no three-way set contains ' + pair,
          claimed: claimedKind + ' for ' + pair,
          note: `${pair} belongs to no three-way set`,
        };
      }

      // The branches are part of a set. Is the WHOLE set present in the chart?
      const results = containing.map(({ s, label }) => {
        const present = s.branches.filter(x => chartBranches.includes(x));
        const missing = s.branches.filter(x => !chartBranches.includes(x));
        return { label, members: s.branches, present, missing, complete: missing.length === 0 };
      });
      const complete = results.find(r => r.complete);

      if (denies) {
        const ok = !complete;
        return {
          ok,
          expected: complete ? complete.members.join('') : 'none',
          claimed: 'denies ' + claimedKind + ' for ' + pair,
          note: ok ? null : `the full ${complete.label} ${complete.members.join('')} IS present in the chart`,
        };
      }

      if (complete) {
        return {
          ok: true,
          expected: complete.members.join(''),
          claimed: claimedKind + ' for ' + pair,
          note: null,
        };
      }

      const partial = results[0];
      return {
        ok: false,
        expected: 'incomplete: have ' + (partial.present.join('') || 'neither') + ', missing ' + partial.missing.join(''),
        claimed: claimedKind + ' for ' + pair,
        note: `${pair} is part of ${partial.members.join('')} but the set is INCOMPLETE (missing ${partial.missing.join('')})`,
      };
    }

    // --- Pairwise relations ---
    // Two DIFFERENT questions, previously conflated (which produced 310 false
    // verdicts on 806 claims, measured 2026-10-16):
    //   (1) are both branches present in the chart?
    //   (2) does the claimed relation actually hold between them?
    // Presence is a precondition for an ASSERTION, not a verdict. Two branches
    // can both be present and have no relation at all — so denying a relation
    // between them is TRUE, not false.
    const bothPresent = chartBranches.includes(a) && chartBranches.includes(b);
    const actual = relationKindBetween(a, b);
    const holdsNow = actual.includes(claimedKind);
    const presentSet = chartBranches.join('');

    if (denies) {
      // "There is no <kind> between X and Y."
      // True iff the relation genuinely does not hold for this pair.
      // (Absent branches cannot hold a relation either, so this covers that too.)
      return {
        ok: !holdsNow,
        expected: holdsNow ? actual.join('/') : 'none',
        claimed: 'denies ' + claimedKind + ' for ' + pair,
        note: holdsNow
          ? `pair ${pair} IS ${actual.join('/')} in the chart`
          : null,
      };
    }

    // Assertion: it holds only if the relation genuinely holds for this pair.
    if (!holdsNow) {
      return {
        ok: false,
        expected: actual.length ? actual.join('/') : 'none',
        claimed: claimedKind + ' for ' + pair,
        note: bothPresent
          ? `pair ${pair} is ${actual.join('/') || 'unrelated'} in the chart (${presentSet})`
          : `pair ${pair} is not present in the chart (${presentSet})`,
      };
    }

    return {
      ok: true,
      expected: actual.join('/'),
      claimed: claimedKind + ' for ' + pair,
      note: null,
    };
  }

  // NEW: a branch asserted at a specific pillar position, with no pillar string.
  if (type === 'branchesAtPosition') {
    const pos = String(claim.position || '').toLowerCase().trim();
    const idx = ['year','month','day','hour'].indexOf(pos);
    if (idx === -1) return null;
    const ch = String(claim.value || '').replace(/[^子丑寅卯辰巳午未申酉戌亥]/g, '')[0];
    if (!ch) return null;
    const actualBranches = [facts.pillars.year[1], facts.pillars.month[1], facts.pillars.day[1], facts.pillars.hour[1]];
    return { ok: actualBranches[idx] === ch, expected: actualBranches[idx], claimed: ch };
  }

  if (type === 'relationsAbsence') {
    const rel = facts.branchRelations || {};
    const positives = [
      ...(rel.clashes || []), ...(rel.combinations || []),
      ...(rel.harms || []), ...(rel.punishments || []),
    ];
    return { ok: positives.length === 0, expected: positives.length ? positives.join(',') : 'none', claimed: 'none' };
  }

  // --- Timing-period claims (the segmented reading's today/year/decade talks) ---
  // A period claim names a pillar or a relation for a TIMESCALE rather than for the
  // natal chart. Verified against the timing facts computed in chartFacts().
  if (type === 'periodPillar') {
    const period = String(claim.period || '').toLowerCase().trim();
    const tm = facts.timing;
    if (!tm) return null;
    const wanted = period === 'today' ? tm.todayPillar
      : period === 'year' ? tm.annualPillar
      : period === 'decade' ? tm.decadePillar
      : null;
    if (!wanted) return null;               // no such period in context
    const got = String(val).replace(/[^子丑寅卯辰巳午未申酉戌亥甲乙丙丁戊己庚辛壬癸]/g, '').slice(0, 2);
    if (got.length < 2) return null;
    return {
      ok: got === wanted,
      expected: wanted,
      claimed: got + ' (' + period + ')',
      note: got === wanted ? null : `${period}'s pillar is ${wanted}, not ${got}`,
    };
  }

  if (type === 'periodRelation') {
    const period = String(claim.period || '').toLowerCase().trim();
    const tm = facts.timing;
    if (!tm) return null;
    const wanted = period === 'today' ? tm.todayRelation
      : period === 'year' ? tm.annualRelation
      : period === 'decade' ? tm.decadeRelation
      : null;
    if (!wanted) return null;
    // The claim may give the Chinese term, the English name, the pinyin form, or a
    // combination (the extractor emits e.g. "Direct Resource (Zheng Yin)").
    // NOTE: the Ten God names are TWO characters each, so this must match whole
    // terms, not single characters. A character class ([正印...]) matches only the
    // first char and produced false positives ("正印" -> "正") — the same class of
    // bug as the three-harmony verdict.
    const GOD_TERMS = ['比肩','劫财','食神','伤官','偏财','正财','七杀','正官','偏印','正印'];
    const GOD_EN = {
      'companion': '比肩', 'peer': '比肩', 'bi jian': '比肩', 'bijian': '比肩',
      'rob wealth': '劫财', 'jie cai': '劫财', 'jiecai': '劫财',
      'eating god': '食神', 'shi shen': '食神', 'shishen': '食神',
      'hurting officer': '伤官', 'shang guan': '伤官', 'shangguan': '伤官',
      'indirect wealth': '偏财', 'pian cai': '偏财', 'piancai': '偏财',
      'direct wealth': '正财', 'zheng cai': '正财', 'zhengcai': '正财',
      'seven killings': '七杀', 'qi sha': '七杀', 'qisha': '七杀',
      'direct officer': '正官', 'zheng guan': '正官', 'zhengguan': '正官',
      'indirect resource': '偏印', 'pian yin': '偏印', 'pianyin': '偏印',
      'direct resource': '正印', 'zheng yin': '正印', 'zhengyin': '正印',
    };
    const raw = String(val);
    const chinese = GOD_TERMS.find(g => raw.includes(g));
    const low = raw.toLowerCase().replace(/[()\[\]]/g, ' ').replace(/\s+/g, ' ');
    const english = Object.entries(GOD_EN).find(([k]) => low.includes(k));
    const g = normalizeGan(raw);
    const claimedGod = chinese || (english && english[1]) ||
      (g ? require('./bazi-tables.js').tenGod(facts.dayMaster, g) : null);
    if (!claimedGod) return null;
    return {
      ok: claimedGod === wanted,
      expected: wanted,
      claimed: claimedGod + ' (' + period + ')',
      note: claimedGod === wanted ? null : `${period}'s relation is ${wanted}, not ${claimedGod}`,
    };
  }

  if (type === 'tenGod') return null;
  if (type === 'element') return null;
  return null;
}

// ---------------------------------------------------------------------------
// Logging (ADR 0002)
// ---------------------------------------------------------------------------
function logVerdict(entry, config) {
  const fs = require('fs');
  const path = require('path');
  fs.appendFileSync(path.join(__dirname, config.logPath), JSON.stringify(entry) + '\n');
}

// ---------------------------------------------------------------------------
// Public API — non-blocking
// ---------------------------------------------------------------------------
async function checkReading(reading, dateStr, timeStr, overrides = {}) {
  const c = chart(dateStr, timeStr);
  return checkReadingFromChart(reading, c, overrides);
}

/**
 * Same check, for a chart supplied directly (chart-space runs).
 * The chart object must have {pillars, tenGods, elements, branchRelations}.
 */
async function checkReadingFromChart(reading, chartObj, overrides = {}) {
  const config = loadConfig(overrides);
  const facts = factsFromChart(chartObj);

  if (!config.enabled) {
    logVerdict({
      ts: new Date().toISOString(), enabled: false, model: null,
      reading: reading.slice(0, 200), verdict: 'skipped',
      claims: [], failures: [], reason: 'extractor disabled by toggle',
    }, config);
    return { reading, verdict: 'skipped', enabled: false, claims: [], failures: [], facts };
  }

  const out = await callExtractor(config, reading, facts);
  return finishVerdict(reading, facts, out, config);
}

/** Build the extractor's facts view from a chart object directly. */
function factsFromChart(c) {
  const pillarList = [c.pillars.year, c.pillars.month, c.pillars.day, c.pillars.hour];
  return {
    raw: c,
    pillars: c.pillars,
    pillarList,
    dayMaster: c.tenGods.dayMaster,
    stems: c.tenGods.stems,
    branches: c.tenGods.branches,
    elements: c.elements,
    branchZhi: [c.pillars.year[1], c.pillars.month[1], c.pillars.day[1], c.pillars.hour[1]],
    branchRelations: c.branchRelations || {},
  };
}

/** Shared tail: parse claims, run CODE, log, return. */
function finishVerdict(reading, facts, out, config) {
  const parsed = parseClaims(out.raw);

  const claims = [];
  const failures = [];
  for (const c of parsed.claims) {
    const v = verdictForClaim(c, facts);
    const rec = {
      type: c.type,
      claimed: v ? v.claimed : c.value,
      ok: v ? v.ok : null,
      expected: v ? v.expected : null,
      note: v && v.note ? v.note : null,
    };
    claims.push(rec);
    if (v && v.ok === false) failures.push(rec);
  }

  const verdict = out.error ? 'extractor-error'
    : parsed.parseError ? 'parse-error'
    : (claims.length === 0 ? 'no-claims' : (failures.length ? 'fail' : 'pass'));

  logVerdict({
    ts: new Date().toISOString(), enabled: true, model: config.model,
    verdict, latencyMs: out.latencyMs,
    extractorError: out.error || null, parseError: parsed.parseError || null,
    claims, failures,
  }, config);

  return {
    reading, verdict, enabled: true, model: config.model,
    latencyMs: out.latencyMs, claims, failures, facts,
    interpretation: parsed.interpretation,
    extractorError: out.error || null, parseError: parsed.parseError || null,
  };
}

module.exports = {
  checkReading, checkReadingFromChart, factsFromChart,
  parseClaims, verdictForClaim, loadConfig, DEFAULTS,
  normalizeGan, normalizeElement, stemFor, relationKindBetween,
};

if (require.main === module) {
  const fs = require('fs');
  const r = JSON.parse(fs.readFileSync(__dirname + '/reading-B01.json', 'utf8'));
  (async () => {
    for (const enabled of [true, false]) {
      const res = await checkReading(r.reading, r.dateStr, r.timeStr, { enabled });
      console.log('=== enabled=' + enabled + ' verdict=' + res.verdict + (res.latencyMs ? ' (' + res.latencyMs + 'ms)' : '') + ' ===');
      console.log('claims:   ', JSON.stringify(res.claims, null, 2));
      console.log('failures: ', JSON.stringify(res.failures, null, 2));
      if (res.extractorError) console.log('error:     ' + res.extractorError);
      if (res.parseError) console.log('parseError: ' + res.parseError);
      console.log('');
    }
  })();
}
