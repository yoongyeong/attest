'use strict';
/**
 * synthesis.js — the cross-timescale composition path.
 *
 * Synthesis answers a question no single-timescale set can: how do the periods
 * INTERACT? ("this year presses against your decade, and today is where you feel it")
 *
 * Section naming: synthesis contributes to its OWN sections — `synthesis`,
 * `texture`, `synthesisAdvice` — deliberately distinct from the annual's
 * `overall`/`advice`. Under the 主/次 rule (ADR 0004), synthesis is not a
 * primary/secondary partner of any single set; it is a different KIND of
 * statement. Distinct section names let it compose additively without being
 * held back or shadowing another set's section.
 */

const fs = require('fs');
const path = require('path');
const T = require('./bazi-tables.js');
const composer = require('./composer.js');
const { annualPillar, dailyPillar, luckPillars } = require('./luck-pillars.js');

const PATH_FRAG = path.join(__dirname, 'synthesis-fragments.json');
const PAIRS = ['decade-year', 'year-day'];
const RELS = ['clash', 'combine', 'none', 'stress'];

let _cache = null;
function loadFragments() {
  if (_cache) return _cache;
  const raw = JSON.parse(fs.readFileSync(PATH_FRAG, 'utf8'));
  const map = new Map();
  for (const f of raw.fragments) map.set(f.key, f);
  _cache = { byKey: map, meta: raw };
  return _cache;
}

/** Branch relation kinds between two branches. */
function branchRel(a, b) {
  const kinds = [];
  if (T.CHONG[a] === b) kinds.push('clash');
  if (T.HE6[a] === b) kinds.push('combine');
  if (T.HAI[a] === b) kinds.push('harm');
  for (const s of T.XING_SETS) if (s.includes(a) && s.includes(b)) kinds.push('punish');
  for (const p of T.XING_PAIRS) if (p.includes(a) && p.includes(b)) kinds.push('punish');
  return kinds;
}

/** Coarsen a branch relation into the key's 4 classes. */
function relClass(a, b) {
  const k = branchRel(a, b);
  if (k.includes('combine')) return 'combine';
  if (k.includes('clash')) return 'clash';
  if (k.includes('punish') || k.includes('harm')) return 'stress';
  return 'none';
}

/**
 * Which synthesis pair applies to this context, and at what key?
 * Requires: the current decade pillar (needs gender + birth) and/or the year pillar.
 */
function synthesisKeys(ctx) {
  const keys = [];
  const { year, dayMaster, decadePillar, dateStr } = ctx;

  if (year && decadePillar) {
    const yp = annualPillar(year).ganZhi;
    const god = T.tenGod(decadePillar[0], yp[0]);
    const rel = relClass(decadePillar[1], yp[1]);
    if (god) keys.push({ pair: 'decade-year', key: 'decade-year|' + god + '|' + rel });
  }

  if (year && dateStr) {
    const yp = annualPillar(year).ganZhi;
    const dp = dailyPillar(dateStr).dayGanZhi;
    const god = T.tenGod(yp[0], dp[0]);
    const rel = relClass(yp[1], dp[1]);
    if (god) keys.push({ pair: 'year-day', key: 'year-day|' + god + '|' + rel });
  }

  return keys;
}

/** Composer describe(): return the first applicable synthesis key. */
function describe(ctx) {
  const keys = synthesisKeys(ctx);
  return keys.length ? keys[0].key : null;
}

/**
 * Register the synthesis set.
 * Sections are namespaced so the set never shadows annual/daily sections.
 */
function registerSynthesisSet() {
  const { byKey } = loadFragments();
  // Wrap fragments so their sections carry synthesis-specific names.
  const wrapped = new Map();
  for (const [key, frag] of byKey) {
    wrapped.set(key, {
      ...frag,
      sections: {
        synthesis: frag.sections.overall,
        texture: frag.sections.texture,
        synthesisAdvice: frag.sections.advice,
      },
    });
  }

  composer.register({
    name: 'synthesis',
    surface: 'synthesis',
    group: 'synthesis',
    role: 'primary',
    epistemic: 'interpretation',
    priority: 5,          // leads the synthesis sections (nothing else owns them)
    sections: ['synthesis', 'texture', 'synthesisAdvice'],
    fragments: wrapped,
    describe,
  });

  return { count: wrapped.size };
}

/** Direct surface function: synthesis reading for one person. */
function synthesis({ year, dayMaster, decadePillar, dateStr }) {
  const lib = loadFragments();
  const keys = synthesisKeys({ year, dayMaster, decadePillar, dateStr });
  if (!keys.length) {
    return { available: false, reason: 'need (year + decadePillar) and/or (year + dateStr)' };
  }
  const parts = [];
  for (const k of keys) {
    const frag = lib.byKey.get(k.key);
    if (frag) parts.push({ pair: k.pair, key: k.key, sections: frag.sections });
  }
  if (!parts.length) return { available: false, reason: 'no fragments for derived keys' };
  return { available: true, parts, meta: { model: lib.meta.model, fragments: lib.meta.count } };
}

function coverage() {
  const lib = loadFragments();
  const missing = [];
  for (const p of PAIRS) for (const g of ['比肩','劫财','食神','伤官','偏财','正财','七杀','正官','偏印','正印'])
    for (const r of RELS) if (!lib.byKey.has(p + '|' + g + '|' + r)) missing.push(p + '|' + g + '|' + r);
  return { total: lib.byKey.size, missing, complete: missing.length === 0 };
}

module.exports = {
  synthesis, registerSynthesisSet, coverage,
  synthesisKeys, describe, relClass, branchRel,
};

if (require.main === module) {
  console.log('=== coverage ===');
  console.log(JSON.stringify(coverage(), null, 2));

  const { chart } = require('./bazi.js');
  const ch = chart('1980-03-15', '09:20');
  const lp = luckPillars('1980-03-15', '09:20', 'male', { cycles: 10 });
  const nowDecade = lp.cycles.find(c => c.startYear <= 2026 && c.endYear >= 2026) || lp.cycles[0];

  console.log('\n=== synthesis ===');
  console.log(`decade in 2026: ${nowDecade.ganZhi} (${nowDecade.startYear}-${nowDecade.endYear})`);
  const r = synthesis({ year: 2026, dayMaster: ch.pillars.day[0], decadePillar: nowDecade.ganZhi, dateStr: '2026-10-16' });
  if (!r.available) { console.log('UNAVAILABLE: ' + r.reason); process.exit(1); }
  for (const p of r.parts) {
    console.log(`\n--- ${p.pair} (${p.key}) ---`);
    for (const [k, v] of Object.entries(p.sections)) console.log(`[${k}] ${v}\n`);
  }
}
