'use strict';
/**
 * compatibility.js — the PAIR-BASED composition path.
 *
 * ADR 0004 flagged that a pair-based surface (two charts) is not covered by the
 * single-chart composition path: it keys to two subjects, not one.
 *
 * This module supplies:
 *   - the pair key  : (dominant branch relation across both charts, Ten God A->B)
 *   - a describe()  : composer-compatible, reading the pair out of the context
 *   - compatibility() : the surface function (chartA, chartB) -> reading
 *
 * Defaults (2026-10-16, reversible):
 *   1. NEUTRAL CORE  — one "two people" reading; no relationship-type input.
 *   2. SUBJECT-RELATIVE — the reading addresses chart A's owner as "you".
 */

const fs = require('fs');
const path = require('path');
const T = require('./bazi-tables.js');
const composer = require('./composer.js');

const PATH_FRAG = path.join(__dirname, 'compatibility-fragments.json');
const DOMINANTS = ['clash', 'combine', 'harm', 'punish', 'trine', 'none'];

let _cache = null;
function loadFragments() {
  if (_cache) return _cache;
  const raw = JSON.parse(fs.readFileSync(PATH_FRAG, 'utf8'));
  const map = new Map();
  for (const f of raw.fragments) map.set(f.key, f);
  _cache = { byKey: map, meta: raw };
  return _cache;
}

// ---------------------------------------------------------------------------
// Pair key derivation
// ---------------------------------------------------------------------------

/** Branch-level relation between two branches, as a set of kinds. */
function branchRelation(a, b) {
  const kinds = [];
  if (T.CHONG[a] === b) kinds.push('clash');
  if (T.HE6[a] === b) kinds.push('combine');
  if (T.HAI[a] === b) kinds.push('harm');
  for (const s of T.XING_SETS) if (s.includes(a) && s.includes(b)) kinds.push('punish');
  for (const p of T.XING_PAIRS) if (p.includes(a) && p.includes(b)) kinds.push('punish');
  return kinds;
}

function isTrine(a, b) {
  for (const s of T.SAN_HE) if (s.branches.includes(a) && s.branches.includes(b)) return true;
  return false;
}

/** All branch relations between two 4-branch charts. */
function chartPairRelations(branchesA, branchesB) {
  const tally = { clash: 0, combine: 0, harm: 0, punish: 0, trine: 0 };
  for (const a of branchesA) {
    for (const b of branchesB) {
      for (const k of branchRelation(a, b)) tally[k]++;
      if (isTrine(a, b)) tally.trine++;
    }
  }
  return tally;
}

/** The dominant relation kind across the pair (highest count, ties broken by order). */
function dominantRelation(tally) {
  let best = 0, dominant = 'none';
  for (const k of ['clash', 'combine', 'harm', 'punish', 'trine']) {
    if (tally[k] > best) { best = tally[k]; dominant = k; }
  }
  return dominant;
}

const branchesOf = (ch) => [ch.pillars.year[1], ch.pillars.month[1], ch.pillars.day[1], ch.pillars.hour[1]];

/**
 * Pair key from a context carrying two charts.
 * ctx.pair = { a: chart, b: chart }
 */
function pairKey(ctx) {
  const a = ctx.pair && ctx.pair.a;
  const b = ctx.pair && ctx.pair.b;
  if (!a || !b) return null;
  const tally = chartPairRelations(branchesOf(a), branchesOf(b));
  const dominant = dominantRelation(tally);
  const god = T.tenGod(a.pillars.day[0], b.pillars.day[0]);
  if (!god) return null;
  return dominant + '|' + god;
}

/**
 * Register the compatibility set with the composer.
 * Pair-based: it contributes to its own sections and does not collide with the
 * single-chart sets (daily/annual), because those are not present in a pair context.
 */
function registerCompatibilitySet() {
  const { byKey } = loadFragments();
  composer.register({
    name: 'compatibility',
    surface: 'compatibility',
    group: 'compatibility',
    role: 'primary',
    epistemic: 'interpretation',
    priority: 30,
    sections: ['overall', 'strengths', 'friction', 'advice'],
    fragments: byKey,
    describe: pairKey,
  });
  return { count: byKey.size };
}

// ---------------------------------------------------------------------------
// Surface function
// ---------------------------------------------------------------------------

/**
 * Compatibility reading for two people. `chartA`'s owner is the subject ("you").
 */
function compatibility(chartA, chartB) {
  const lib = loadFragments();
  const key = pairKey({ pair: { a: chartA, b: chartB } });
  if (!key) return { available: false, reason: 'could not derive pair key' };

  const frag = lib.byKey.get(key);
  if (!frag) return { available: false, reason: 'no fragment for pair key ' + key, key };

  const tally = chartPairRelations(branchesOf(chartA), branchesOf(chartB));

  return {
    available: true,
    key,
    dominant: frag.dominant,
    god: frag.god,
    tallies: tally,
    you: { dayMaster: chartA.pillars.day[0], pillars: chartA.asString },
    them: { dayMaster: chartB.pillars.day[0], pillars: chartB.asString },
    sections: frag.sections,
    meta: { model: lib.meta.model, generatedAt: lib.meta.generatedAt, fragments: lib.meta.count },
  };
}

/** Coverage of the 60-key pair space. */
function coverage() {
  const lib = loadFragments();
  const missing = [];
  for (const d of DOMINANTS) {
    for (const g of ['比肩','劫财','食神','伤官','偏财','正财','七杀','正官','偏印','正印']) {
      if (!lib.byKey.has(d + '|' + g)) missing.push(d + '|' + g);
    }
  }
  return { total: lib.byKey.size, missing, complete: missing.length === 0 };
}

module.exports = {
  compatibility, registerCompatibilitySet, coverage,
  pairKey, dominantRelation, chartPairRelations, branchRelation, isTrine,
};

if (require.main === module) {
  const { chart } = require('./bazi.js');
  console.log('=== coverage ===');
  console.log(JSON.stringify(coverage(), null, 2));

  const a = chart('1980-03-15', '09:20');   // subject
  const b = chart('1992-07-22', '14:05');
  console.log('\n=== compatibility ===');
  const r = compatibility(a, b);
  if (!r.available) { console.log('UNAVAILABLE: ' + r.reason); process.exit(1); }
  console.log(`you ${r.you.pillars} (dm ${r.you.dayMaster})  ×  them ${r.them.pillars} (dm ${r.them.dayMaster})`);
  console.log(`key: ${r.key}   tallies: ${JSON.stringify(r.tallies)}`);
  console.log('');
  for (const [k, v] of Object.entries(r.sections)) console.log(`[${k}] ${v}\n`);
}
