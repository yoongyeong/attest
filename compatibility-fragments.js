'use strict';
/**
 * compatibility-fragments.js — measure the COMPATIBILITY (合婚) fragment space.
 *
 * Compatibility is PAIR-BASED: two charts, not one. ADR 0004 flags that this is
 * a different key shape and needs its own composition path. This file measures
 * what that key shape costs.
 *
 * The classical approach compares the two charts' branches and stems for:
 *   - 六合 liu he   (six combinations)  — favourable pairing
 *   - 三合 san he   (trine)             — favourable
 *   - 六冲 liu chong (six clashes)      — the classic "incompatible" signal
 *   - 六害 liu hai  (six harms)
 *   - 相刑 xing     (punishments)
 *
 * Naive key: (chartA, chartB). Way too large.
 * Candidate key: (dominant pair-relation, day-master relation between the two).
 *
 * All deterministic. No model calls.
 */

const T = require('./bazi-tables.js');

const GAN = T.GAN, ZHI = T.ZHI;

/** Branch-level relations between two branches, as a set of kinds. */
function branchRelation(a, b) {
  const kinds = [];
  if (T.CHONG[a] === b) kinds.push('clash');
  if (T.HE6[a] === b) kinds.push('combine');
  if (T.HAI[a] === b) kinds.push('harm');
  for (const s of T.XING_SETS) if (s.includes(a) && s.includes(b)) kinds.push('punish');
  for (const p of T.XING_PAIRS) if (p.includes(a) && p.includes(b)) kinds.push('punish');
  return kinds;
}

/** Is this pair of branches part of a 三合 trine? */
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

/**
 * The candidate fragment key for a pair:
 *   - the dominant branch relation (which kind fires most, and whether any fires)
 *   - the Ten God relation between the two day masters (how the two people meet)
 *
 * This collapses the pair space the way (Ten God, branch element) collapsed the
 * single-chart space.
 */
function pairKey(dayMasterA, dayMasterB, relTally) {
  const kinds = ['clash', 'combine', 'harm', 'punish', 'trine'];
  let dominant = 'none', best = 0;
  for (const k of kinds) {
    if (relTally[k] > best) { best = relTally[k]; dominant = k; }
  }
  const godForward = T.tenGod(dayMasterA, dayMasterB);
  return { dominant, godForward, key: dominant + '|' + godForward };
}

/** Enumerate the reachable pair-key space. */
function measureSpace() {
  const keys = new Set();
  const dominants = new Set();
  const gods = new Set();
  const branchSample = ZHI;

  // sample pair-charts by their branches (12^4 is 20,736 per chart; sample instead)
  // We enumerate day masters fully (10x10) and dominant relations by construction.
  const allRelStates = new Set();
  for (const a of branchSample) {
    for (const b of branchSample) {
      const k = branchRelation(a, b);
      allRelStates.add(k.length ? k.sort().join('+') : 'none');
    }
  }

  // the dominant-relation axis: which kinds can dominate
  for (const k of ['clash', 'combine', 'harm', 'punish', 'trine', 'none']) dominants.add(k);
  for (const ga of GAN) for (const gb of GAN) gods.add(T.tenGod(ga, gb));

  for (const d of dominants) for (const g of gods) keys.add(d + '|' + g);

  return {
    singleBranchRelationStates: allRelStates.size,
    singleBranchRelationList: [...allRelStates].sort(),
    dominantKinds: [...dominants],
    dayMasterGods: [...gods].length,
    pairKeys: keys.size,
    keys: [...keys].sort(),
  };
}

function main() {
  console.log('============ COMPATIBILITY (合婚) FRAGMENT SPACE ============\n');

  const naive = 518400 * 518400;
  console.log('naive pair key (chartA x chartB):');
  console.log('  ' + naive.toExponential(2) + '  (not computable)\n');

  const s = measureSpace();
  console.log('branch-pair relation states (one branch vs one branch):');
  console.log(`  distinct: ${s.singleBranchRelationStates}`);
  console.log(`  ${s.singleBranchRelationList.join('  ')}\n`);

  console.log('dominant-relation axis (which kind fires most across the pair):');
  console.log(`  ${s.dominantKinds.join(', ')}  (${s.dominantKinds.length} values)\n`);

  console.log('day-master relation axis (Ten God between the two day masters):');
  console.log(`  ${s.dayMasterGods} values\n`);

  console.log('CANDIDATE PAIR KEY: (dominant relation, day-master god)');
  console.log(`  ${s.dominantKinds.length} x ${s.dayMasterGods} = ${s.pairKeys} fragments\n`);

  console.log('================ COMPARISON ================');
  console.log(`single-chart daily   : 50 fragments`);
  console.log(`single-chart annual  : 66 fragments (50 + 16)`);
  console.log(`pair compatibility   : ${s.pairKeys} fragments  <-- this key shape`);
  console.log('');
  if (s.pairKeys <= 200) {
    console.log('=> COMPATIBILITY IS TRACTABLE with this key shape.');
    console.log('   Same order of magnitude as the annual. No new scaling problem —');
    console.log('   only a new composition path (two subjects in the context).');
  } else {
    console.log('=> key too large; needs a coarser dominant-relation axis.');
  }
}

module.exports = { branchRelation, isTrine, chartPairRelations, pairKey, measureSpace };
if (require.main === module) main();
