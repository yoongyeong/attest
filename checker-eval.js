'use strict';
/**
 * checker-eval.js — measure the CHECKER's own error rate.
 *
 * The bug on 2026-10-16 was not a model fabrication — it was the checker
 * producing a FALSE VERDICT on a correct claim (亥卯 three-harmony, complete in
 * the chart, flagged as "expected none").
 *
 * That is the most serious class of bug in this project, because the entire
 * architecture rests on "code decides truth, and code cannot hallucinate."
 * Code cannot hallucinate, but it CAN be wrong — incomplete, and therefore
 * confidently false. So the checker needs its own eval, the same way the
 * extractor got one (ADR 0003).
 *
 * This measures two rates:
 *   FALSE POSITIVE : a TRUE claim marked false   (the observed bug)
 *   FALSE NEGATIVE : a FALSE claim marked true   (a missed lie)
 *
 * Ground truth is computed independently of the verdict logic — every case is
 * derived from the engine's own chart output, then hand-classified.
 */

const { chart } = require('./bazi.js');
const T = require('./bazi-tables.js');
const extractor = require('./extractor.js');

// ---------------------------------------------------------------------------
// Cases: each asserts something whose truth we can determine from the chart
// BY CONSTRUCTION (not by asking the checker).
// ---------------------------------------------------------------------------

/** Build a case list for one chart. */
function casesFor(dateStr, timeStr) {
  const ch = chart(dateStr, timeStr);
  const p = ch.pillars;
  const br = [p.year[1], p.month[1], p.day[1], p.hour[1]];
  const facts = extractor.factsFromChart(ch);
  // The eval must see the same timing facts the real checker gets, otherwise the
  // period claim types are unjudgeable here and the coverage is illusory.
  facts.timing = require('./fact-validator.js').chartFacts(dateStr, timeStr, { year: 2026 }).timing;
  const cases = [];

  // --- pairwise relations: for every ordered pair of chart branches ---
  for (const a of br) {
    for (const b of br) {
      if (a === b) continue;
      const actual = extractor.relationKindBetween(a, b);
      for (const kind of ['clash', 'combination', 'harm', 'punishment']) {
        const trulyPresent = actual.includes(kind);
        cases.push({
          id: `${a}${b}-${kind}-assert`,
          claim: { type: 'relationKind', branches: a + b, kind, polarity: 'asserts' },
          expectedOk: trulyPresent,   // asserting a present relation is TRUE
          why: trulyPresent ? `${a}${b} IS ${kind}` : `${a}${b} is ${actual.join('/') || 'nothing'}`,
        });
        cases.push({
          id: `${a}${b}-${kind}-deny`,
          claim: { type: 'relationKind', branches: a + b, kind, polarity: 'denies' },
          expectedOk: !trulyPresent,  // denying an absent relation is TRUE
          why: trulyPresent ? `${a}${b} IS ${kind}` : `${a}${b} is ${actual.join('/') || 'nothing'}`,
        });
      }
    }
  }

  // --- three-way sets: complete vs incomplete in this chart ---
  for (const set of T.SAN_HE) {
    const present = set.branches.filter(b => br.includes(b));
    const complete = present.length === set.branches.length;
    // claim the trine for the FIRST TWO members of the set
    const [x, y] = set.branches;
    if (present.includes(x) && present.includes(y)) {
      cases.push({
        id: `trine-${set.branches.join('')}-assert`,
        claim: { type: 'relationKind', branches: x + y, kind: 'threeHarmony', polarity: 'asserts' },
        expectedOk: complete,
        why: `亥卯未 complete=${complete} (have ${present.join('')})`,
      });
      cases.push({
        id: `trine-${set.branches.join('')}-deny`,
        claim: { type: 'relationKind', branches: x + y, kind: 'threeHarmony', polarity: 'denies' },
        expectedOk: !complete,
        why: `亥卯未 complete=${complete}`,
      });
    }
  }

  // --- relation asserted for a pair NOT in the chart at all ---
  // NOTE: these are UNJUDGEABLE, not false. "未丑 is a clash" is true in the
  // abstract (it is a clash pair); the chart simply does not contain 丑. Marking
  // them expectedOk=false made the eval demand a verdict the checker cannot
  // legitimately give, producing phantom false negatives. They are recorded as
  // unjudged instead.
  const absent = T.ZHI.filter(z => !br.includes(z));
  for (const a of br) {
    for (const b of absent.slice(0, 2)) {
      cases.push({
        id: `${a}${b}-clash-pair-absent`,
        claim: { type: 'relationKind', branches: a + b, kind: 'clash', polarity: 'asserts' },
        expectedOk: null,          // null = no verdict expected, by construction
        why: `${b} is not in the chart, so the claim is unjudgeable`,
        unjudgeable: true,
      });
    }
  }

  // --- identity claims (should be reliable) ---
  cases.push({ id: 'dm-correct', claim: { type: 'dayMaster', value: p.day[0] }, expectedOk: true, why: 'day master as computed' });  cases.push({ id: 'dm-wrong', claim: { type: 'dayMaster', value: T.GAN.find(g => g !== p.day[0]) }, expectedOk: false, why: 'a different stem' });

  const strongest = Object.entries(ch.elements.raw).sort((a, b) => b[1] - a[1])[0][0];
  cases.push({ id: 'dom-correct', claim: { type: 'dominance', value: strongest }, expectedOk: true, why: 'strongest element' });
  cases.push({ id: 'dom-wrong', claim: { type: 'dominance', value: ['木','火','土','金','水'].find(e => e !== strongest) }, expectedOk: false, why: 'not the strongest' });

  // --- timing-period claims (the segmented reading's today/year/decade talk) ---
  // Both directions, for each period that has a value in context.
  const tm = facts.timing || {};
  const periods = [
    ['today', tm.todayPillar, tm.todayRelation],
    ['year', tm.annualPillar, tm.annualRelation],
    ['decade', tm.decadePillar, tm.decadeRelation],
  ];
  for (const [label, pillar, relation] of periods) {
    if (pillar) {
      cases.push({
        id: `${label}-pillar-correct`,
        claim: { type: 'periodPillar', period: label, value: pillar },
        expectedOk: true, why: `${label}'s pillar is ${pillar}`,
      });
      const otherPillar = T.ZHI.find(z => z !== pillar[1]);
      const wrongPillar = T.GAN.find(g => g !== pillar[0]) + otherPillar;
      cases.push({
        id: `${label}-pillar-wrong`,
        claim: { type: 'periodPillar', period: label, value: wrongPillar },
        expectedOk: false, why: `${label}'s pillar is ${pillar}, not ${wrongPillar}`,
      });
    }
    if (relation) {
      cases.push({
        id: `${label}-relation-correct`,
        claim: { type: 'periodRelation', period: label, value: relation },
        expectedOk: true, why: `${label}'s relation is ${relation}`,
      });
      const wrongRel = ['比肩','劫财','食神','伤官','偏财','正财','七杀','正官','偏印','正印'].find(g => g !== relation);
      cases.push({
        id: `${label}-relation-wrong`,
        claim: { type: 'periodRelation', period: label, value: wrongRel },
        expectedOk: false, why: `${label}'s relation is ${relation}, not ${wrongRel}`,
      });
    }
  }

  return { ch, facts, cases };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const CHARTS = [
  ['1991-03-30', '09:20'],   // the chart that exposed the bug
  ['1980-03-15', '09:20'],
  ['1992-07-22', '14:05'],
  ['2005-11-08', '03:45'],
  ['1995-01-30', '18:30'],
  ['1988-09-12', '11:15'],
  ['2024-06-01', '23:30'],
  ['1975-05-04', '07:10'],
];

function run() {
  let total = 0, agree = 0;
  const falsePositives = [];   // true claim marked false  <- the observed bug class
  const falseNegatives = [];   // false claim marked true   <- missed lie
  const unjudged = [];         // checker returned null

  for (const [d, t] of CHARTS) {
    const { ch, facts, cases } = casesFor(d, t);
    for (const c of cases) {
      const v = extractor.verdictForClaim(c.claim, facts);
      total++;
      // Cases whose truth value is undefined by construction are not judged:
      // asking the checker for a verdict here would manufacture phantom misses.
      if (c.expectedOk === null) { unjudged.push({ chart: d, id: c.id, why: c.why, kind: 'unjudgeable-by-construction' }); continue; }
      if (!v || v.ok === null) { unjudged.push({ chart: d, ...c }); continue; }
      if (v.ok === c.expectedOk) { agree++; continue; }
      const rec = {
        chart: d, id: c.id, claim: c.claim,
        checkerSaid: v.ok, truth: c.expectedOk, why: c.why,
        note: v.note || null, expectedField: v.expected || null,
      };
      if (v.ok === false && c.expectedOk === true) falsePositives.push(rec);
      else falseNegatives.push(rec);
    }
  }

  const judged = total - unjudged.length;
  const fpRate = judged ? (falsePositives.length / judged * 100) : 0;
  const fnRate = judged ? (falseNegatives.length / judged * 100) : 0;

  console.log('================ CHECKER EVAL ================');
  console.log(`charts           : ${CHARTS.length}`);
  console.log(`claims tested    : ${total}`);
  console.log(`judged           : ${judged}`);
  console.log(`unjudged (null)  : ${unjudged.length}`);
  console.log(`checker agrees   : ${agree}/${judged} (${(agree / judged * 100).toFixed(1)}%)`);
  console.log('');
  console.log(`FALSE POSITIVES  : ${falsePositives.length} (${fpRate.toFixed(2)}%)  <- true claim marked FALSE`);
  console.log(`FALSE NEGATIVES  : ${falseNegatives.length} (${fnRate.toFixed(2)}%)  <- false claim marked TRUE`);
  console.log('');

  if (falsePositives.length) {
    console.log('--- false positives (the observed bug class) ---');
    for (const r of falsePositives.slice(0, 12)) {
      console.log(`  ${r.chart}  ${r.id}`);
      console.log(`     claim: ${JSON.stringify(r.claim)}`);
      console.log(`     truth: should be ${r.expectedOk ? 'PASS' : 'FAIL'} (${r.why})`);
      console.log(`     note : ${r.note || '-'}`);
    }
    if (falsePositives.length > 12) console.log(`  ... +${falsePositives.length - 12} more`);
  }
  if (falseNegatives.length) {
    console.log('--- false negatives (missed lies) ---');
    for (const r of falseNegatives.slice(0, 12)) {
      console.log(`  ${r.chart}  ${r.id}  truth=${r.expectedOk} (${r.why})`);
    }
    if (falseNegatives.length > 12) console.log(`  ... +${falseNegatives.length - 12} more`);
  }

  require('fs').writeFileSync(__dirname + '/checker-eval-results.json', JSON.stringify({
    ts: new Date().toISOString(),
    charts: CHARTS.length, total, judged, unjudged: unjudged.length,
    agreePct: +(agree / judged * 100).toFixed(2),
    falsePositives, falseNegatives,
    falsePositiveRatePct: +fpRate.toFixed(2),
    falseNegativeRatePct: +fnRate.toFixed(2),
  }, null, 2));
  console.log('\nwritten: checker-eval-results.json');
  return { falsePositives: falsePositives.length, falseNegatives: falseNegatives.length };
}

module.exports = { casesFor, run };
if (require.main === module) run();
