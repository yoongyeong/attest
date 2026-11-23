'use strict';
/**
 * annual-fragments.js — measure the ANNUAL FORECAST fragment space.
 *
 * The annual pillar (流年) layers on top of the decade and the natal chart.
 * The question this file answers: how many precomputed fragments would an
 * annual forecast need?
 *
 * A naive key is (annual pillar x day master) = 60 x 10 = 600.
 * But as with the daily, the meaning depends on the RELATIONSHIP, not the
 * pillar string. Two candidate keys are measured:
 *
 *   K1  (Ten God of the annual stem vs day master, element of the annual branch)
 *       -> 10 x 5 = 50, the same collapse as the daily
 *
 *   K2  K1 plus whether the annual branch forms a relation with the natal chart
 *       -> adds context: a clash year reads very differently from a quiet year
 *
 * All deterministic. No model calls.
 */

const T = require('./bazi-tables.js');
const { annualPillar } = require('./luck-pillars.js');

const GODS = ['比肩','劫财','食神','伤官','偏财','正财','七杀','正官','偏印','正印'];
const ELEMENTS = ['木','火','土','金','水'];

function all60() {
  const out = [];
  for (let i = 0; i < 60; i++) out.push(T.GAN[i % 10] + T.ZHI[i % 12]);
  return out;
}

/** K1: (Ten God, branch element) — the daily's key shape, one layer up. */
function measureK1() {
  const observed = new Set();
  for (const p of all60()) {
    for (const dm of T.GAN) {
      const god = T.tenGod(dm, p[0]);
      const el = T.ZHI_WUXING[p[1]];
      if (god && el) observed.add(god + '|' + el);
    }
  }
  return { theoretical: GODS.length * ELEMENTS.length, observed: observed.size, list: [...observed].sort() };
}

/**
 * K2: K1 plus a relation class between the annual branch and the chart.
 * Relation classes, coarse enough to stay precomputable:
 *   none   - no relation fires
 *   clash  - a 冲 with any natal branch
 *   combine- a 合 with any natal branch
 *   harm   - a 害
 *   punish - a 刑
 * A year may hit several; we key on the SET of classes, which is stable.
 */
function relationClasses(natalBranches, annualBranch) {
  const classes = [];
  for (const nb of natalBranches) {
    if (T.CHONG[nb] === annualBranch) classes.push('clash');
    if (T.HE6[nb] === annualBranch) classes.push('combine');
    if (T.HAI[nb] === annualBranch) classes.push('harm');
    for (const s of T.XING_SETS) if (s.includes(nb) && s.includes(annualBranch)) classes.push('punish');
    for (const s of T.XING_PAIRS) if (s.includes(nb) && s.includes(annualBranch)) classes.push('punish');
  }
  return [...new Set(classes)].sort();
}

/**
 * How many distinct relation-class sets can a year produce against a chart?
 * Enumerated exhaustively over every (4-branch chart, 12 annual branches).
 */
function measureK2() {
  const sets = new Set();
  const branches = T.ZHI;
  // enumerate natal charts by their 4 branches (12^4 = 20,736 — cheap)
  for (const a of branches) for (const b of branches) for (const c of branches) for (const d of branches) {
    const natal = [a, b, c, d];
    for (const annual of branches) {
      const cls = relationClasses(natal, annual);
      sets.add(cls.length ? cls.join('+') : 'none');
    }
  }
  return { observed: sets.size, list: [...sets].sort() };
}

function main() {
  console.log('============ ANNUAL FORECAST FRAGMENT SPACE ============\n');

  const k1 = measureK1();
  console.log('K1 — (Ten God of annual stem, element of annual branch)');
  console.log(`  theoretical : ${k1.theoretical}`);
  console.log(`  observed    : ${k1.observed}`);
  console.log(`  -> fragments: ${k1.observed}\n`);

  const k2 = measureK2();
  console.log('K2 — relation classes between the annual branch and the natal chart');
  console.log(`  distinct sets observed: ${k2.observed}`);
  console.log(`  sets: ${k2.list.join('  ')}\n`);

  const k2Total = k1.observed * k2.observed;
  console.log('COMBINED — K1 x K2');
  console.log(`  raw             : ${k1.observed} x ${k2.observed} = ${k2Total}`);
  console.log(`  naive (pillar x dm): 60 x 10 = 600\n`);

  console.log('================ OPTIONS ================');
  console.log(`A. K1 only (mirror of the daily)   : ${k1.observed} fragments`);
  console.log(`B. K1 x relation class (full)      : ${k2Total} fragments`);
  console.log(`C. K1 + relation as a SEPARATE set : ${k1.observed} + ${k2.observed} = ${k1.observed + k2.observed} fragments (composed)`);
  console.log('');
  console.log('C keeps fragments reviewable by composing two small sets instead of');
  console.log('multiplying them. Recommended unless the interaction needs its own voice.');
}

module.exports = { measureK1, measureK2, relationClasses, all60 };
if (require.main === module) main();
