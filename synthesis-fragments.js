'use strict';
/**
 * synthesis-fragments.js — measure the SYNTHESIS fragment space.
 *
 * Synthesis is the cross-timescale layer: it says how the day, the year, and the
 * decade INTERACT — "your clash year is showing up this week". Neither the daily
 * nor the annual set can say this, because the composer holds back when two sets
 * answer the same question (ADR 0004). Synthesis answers a DIFFERENT question:
 * how do the timescales relate?
 *
 * Key shape (candidate): a pair of ADJACENT timescales and how they relate.
 *   - decade vs year   (the year's relation to the current luck cycle)
 *   - year vs day      (the day's relation to the current year)
 *
 * Each relation is expressed in the same primitive the rest of the product uses:
 * the Ten God between the two pillars' stems, plus whether they share branch
 * relations. That keeps the key small and the vocabulary consistent.
 *
 * All deterministic. No model calls.
 */

const T = require('./bazi-tables.js');

const GAN = T.GAN, ZHI = T.ZHI;
const GODS = ['比肩','劫财','食神','伤官','偏财','正财','七杀','正官','偏印','正印'];

/** Ten God between two stems (a -> b). */
const godBetween = (a, b) => T.tenGod(a, b);

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

/**
 * Candidate key: (timescale pair, god between them, relation-class between them)
 *
 *   timescalePair : 'decade-year' | 'year-day'          (2)
 *   god           : Ten God between the two stems        (10)
 *   relClass      : branch relation, coarsened           (4: none | clash | combine | support)
 */
function measure() {
  const pairs = ['decade-year', 'year-day'];
  const gods = GODS.length;

  // coarsen the branch relation between two single branches into 4 classes
  const relClasses = new Set();
  for (const a of ZHI) {
    for (const b of ZHI) {
      const k = branchRel(a, b);
      let cls = 'none';
      if (k.includes('combine')) cls = 'combine';       // favourable contact
      else if (k.includes('clash')) cls = 'clash';       // friction
      else if (k.includes('punish') || k.includes('harm')) cls = 'stress';
      relClasses.add(cls);
    }
  }

  const keySpace = pairs.length * gods * relClasses.size;
  return { pairs, gods, relClasses: [...relClasses].sort(), keySpace };
}

/**
 * Alternative (richer) key: include which timescale is "under" the other, i.e.
 * whether the shorter period reinforces or opposes the longer one. That is
 * derived from the relation class, so it does not multiply the space.
 */
function main() {
  console.log('============ SYNTHESIS FRAGMENT SPACE ============\n');

  const m = measure();
  console.log('timescale pairs :', m.pairs.join(', '));
  console.log('god axis        :', m.gods, '(Ten God between the two periods\' stems)');
  console.log('relation axis   :', m.relClasses.length, '->', m.relClasses.join(', '));
  console.log('');
  console.log(`CANDIDATE KEY: (timescale pair, god, relation class)`);
  console.log(`  ${m.pairs.length} x ${m.gods} x ${m.relClasses.length} = ${m.keySpace} fragments\n`);

  console.log('================ COMPARISON ============');
  console.log('single-chart daily   : 50');
  console.log('single-chart annual  : 66');
  console.log('pair compatibility   : 60');
  console.log(`cross-timescale synth: ${m.keySpace}   <-- this key shape`);
  console.log('');
  if (m.keySpace <= 150) {
    console.log('=> TRACTABLE. Same order of magnitude as the other sets.');
    console.log('   Synthesis composes TWO timescales and says how they relate —');
    console.log('   the thing no single-timescale set can say.');
  } else {
    console.log('=> key too large; coarsen the relation axis further.');
  }
}

module.exports = { measure, godBetween, branchRel };
if (require.main === module) main();
