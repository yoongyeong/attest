'use strict';
/**
 * corruption-eval.js — build readings with KNOWN defects, then measure whether
 * the extractor + CODE verdict catches them.
 *
 * Why this exists (ADR 0002): the extractor has two error modes that push the
 * flag rate in opposite directions —
 *   (a) MISSED lies        -> verdict reads "pass"  -> flag rate understated
 *   (b) INVENTED failures  -> verdict reads "fail"  -> flag rate overstated
 * Both were observed by hand on 2026-10-14. Neither is measurable without a set
 * of readings whose defects we already know. That is this file.
 *
 * Method: take a real, correct reading, then mechanically corrupt it in a
 * specific labelled way. The corruption is the ground truth — we know exactly
 * which claim should fail.
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

/**
 * A corruption case: base reading + a mutation whose defect is known.
 * `expectTypes` lists the claim types that SHOULD be flagged.
 */
function buildCases(baseReading) {
  const cases = [];

  // --- CONTROL: the untouched reading. Its only real defect is the relations
  // lie the generator actually made (it claimed no relations; the chart has four).
  cases.push({
    id: 'CONTROL-original',
    kind: 'control',
    expectFlag: true,
    expectTypes: ['relations'],
    note: 'unmodified generated reading; contains a genuine false absence claim',
    text: baseReading,
  });

  // --- M01: swap the day master to a wrong stem.
  cases.push({
    id: 'M01-wrong-daymaster-stem',
    kind: 'corruption',
    expectFlag: true,
    expectTypes: ['dayMaster'],
    note: 'day master changed Ding -> Geng (wrong stem)',
    text: baseReading.replace(/Day Master is Ding/i, 'Day Master is Geng')
                     .replace(/丁/g, '庚'),
  });

  // --- M02: claim the wrong element is dominant.
  cases.push({
    id: 'M02-wrong-dominance',
    kind: 'corruption',
    expectFlag: true,
    expectTypes: ['dominance'],
    note: 'dominant element changed Wood -> Metal',
    text: baseReading.replace(/Wood as your dominant element/i, 'Metal as your dominant element'),
  });

  // --- M03: assert a relation exists that does not.
  cases.push({
    id: 'M03-invented-relation',
    kind: 'corruption',
    expectFlag: true,
    expectTypes: ['relations'],
    note: 'claims a 子卯 punishment; chart has none of that pair',
    text: baseReading.replace(
      /there are no specific branch relationships present/i,
      'your chart carries a 子卯 punishment'),
  });

  // --- M04: keep the absence claim but make it about a chart that HAS relations.
  cases.push({
    id: 'M04-false-absence',
    kind: 'corruption',
    expectFlag: true,
    expectTypes: ['relations'],
    note: 'explicit false absence: "no clashes" while clashes exist',
    text: baseReading.replace(
      /there are no specific branch relationships present/i,
      'there are no clashes anywhere in your chart'),
  });

  // --- M05: HONEST control — all factual claims match the chart.
  // Expected: NO flag. This measures false positives.
  const honest =
    'Your Day Master is Ding, a Yin Fire day master. Wood is your dominant element. ' +
    'Your chart shows a clash between 亥 and 巳, a combination of 申 and 巳, and a harm between 申 and 亥. ' +
    'These relationships suggest inner tension alongside strong creative flow.';
  cases.push({
    id: 'M05-honest-all-correct',
    kind: 'honest-control',
    expectFlag: false,
    expectTypes: [],
    note: 'every factual claim matches the chart; any flag here is a FALSE POSITIVE',
    text: honest,
  });

  // --- M06: honest absence — genuinely no relations (fabricated chart state).
  // Uses a claim about absence where the chart DOES have relations, so it must flag.
  cases.push({
    id: 'M06-absence-negative-control',
    kind: 'corruption',
    expectFlag: true,
    expectTypes: ['relations'],
    note: 'negative-phrased absence claim: "free of clashes and combinations"',
    text: baseReading.replace(
      /there are no specific branch relationships present/i,
      'your chart is free of clashes and combinations'),
  });

  return cases;
}

async function run() {
  const { checkReading } = require('./extractor.js');

  const rd = JSON.parse(fs.readFileSync(path.join(ROOT, 'reading-B01.json'), 'utf8'));
  const cases = buildCases(rd.reading);

  const results = [];
  for (const c of cases) {
    const res = await checkReading(c.text, rd.dateStr, rd.timeStr, { enabled: true });
    const flaggedTypes = [...new Set(res.failures.map(f => f.type))];
    const caught = c.expectFlag ? (res.failures.length > 0) : (res.failures.length === 0);
    results.push({
      id: c.id, kind: c.kind, note: c.note,
      expectFlag: c.expectFlag, expectTypes: c.expectTypes,
      verdict: res.verdict, flaggedTypes,
      caught, latencyMs: res.latencyMs,
      extractorError: res.extractorError, parseError: res.parseError,
    });
    const mark = caught ? 'OK ' : 'MISS';
    console.log(`${mark} ${c.id.padEnd(30)} verdict=${(res.verdict||'').padEnd(15)} flagged=[${flaggedTypes.join(',')}]`);
  }

  const corruptions = results.filter(r => r.expectFlag);
  const honest = results.filter(r => !r.expectFlag);
  const recall = corruptions.filter(r => r.caught).length;
  const falsePos = honest.filter(r => !r.caught).length;

  const summary = {
    ts: new Date().toISOString(),
    total: results.length,
    corruptionCases: corruptions.length,
    caught: recall,
    recallPct: corruptions.length ? +(recall / corruptions.length * 100).toFixed(1) : null,
    honestCases: honest.length,
    falsePositives: falsePos,
    falsePositiveRatePct: honest.length ? +(falsePos / honest.length * 100).toFixed(1) : null,
    results,
  };

  fs.writeFileSync(path.join(ROOT, 'eval-results.json'), JSON.stringify(summary, null, 2));
  console.log('\n--- SUMMARY ---');
  console.log('corruption recall : ' + recall + '/' + corruptions.length + ' (' + summary.recallPct + '%)');
  console.log('false positives   : ' + falsePos + '/' + honest.length + ' (' + summary.falsePositiveRatePct + '%)');
  console.log('written: eval-results.json');
}

module.exports = { buildCases };
if (require.main === module) run();
