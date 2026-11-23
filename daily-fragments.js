'use strict';
/**
 * daily-fragments.js — enumerate the DAILY FORTUNE fragment space.
 *
 * A daily fortune is keyed to (today's day pillar, the user's day master),
 * optionally deepened by the current luck cycle. Unlike a full reading — which
 * is keyed to the whole chart (518,400) — this space is small enough that FULL
 * precomputation may be feasible. This file measures it, exactly.
 *
 * All deterministic. No model calls.
 *
 * Keys considered:
 *   L1  (dayPillar, dayMaster)                                  minimal
 *   L2  (dayPillar, dayMaster, currentLuckPillarGanZhi)        decade-aware
 *
 * Reachable-combination counts are computed by construction, not estimated.
 */

const T = require('./bazi-tables.js');
const { dailyPillar } = require('./luck-pillars.js');

const GAN = T.GAN, ZHI = T.ZHI;

/** All 60 day pillars, generated from the sexagenary cycle. */
function all60() {
  const out = [];
  for (let i = 0; i < 60; i++) out.push(GAN[i % 10] + ZHI[i % 12]);
  return out;
}

/**
 * Which (dayPillar, dayMaster) pairs are actually reachable?
 *
 * A day pillar is a stem+branch. A user's day master is their own day pillar's
 * stem. For a daily fortune, today's pillar and the user's day master are
 * INDEPENDENT — any of the 10 day masters can coexist with any of the 60 day
 * pillars. But the meaningful relation is between the day master and TODAY'S
 * STEM (that is what the Ten God is computed from), so the space partitions
 * naturally by Ten God rather than by raw pairing.
 */
function enumerateLevel1() {
  const pillars = all60();
  const dayMasters = GAN.slice();
  const pairs = [];
  for (const p of pillars) {
    for (const dm of dayMasters) {
      pairs.push({ dayPillar: p, dayMaster: dm, tenGod: T.tenGod(dm, p[0]) });
    }
  }
  return { pillars: pillars.length, dayMasters: dayMasters.length, pairs: pairs.length, sample: pairs.slice(0, 4) };
}

/**
 * Level 2 adds the current luck-cycle pillar (the decade the user is in).
 * The decade pillar is itself one of the 60, and in practice a user sees only
 * a handful of cycles in a lifetime, but the SPACE is what we measure.
 */
function enumerateLevel2() {
  const pillars = all60().length;          // today's pillar
  const dayMasters = GAN.length;           // user's day master
  const luckPillars = 60;                  // current decade pillar
  return { pillars, dayMasters, luckPillars, combinations: pillars * dayMasters * luckPillars };
}

/**
 * The KEY INSIGHT being tested: the interpretation does not depend on the
 * specific pillar string, but on the Ten God it forms against the day master,
 * plus the element of the branch. That collapses the space dramatically.
 *
 *   dayStemTenGod   : 10 possible (relative to day master)
 *   dayBranchElement: 5 possible
 *   => 50 interpretive states, independent of day master
 */
function enumerateInterpretiveStates() {
  const gods = ['比肩','劫财','食神','伤官','偏财','正财','七杀','正官','偏印','正印'];
  const elements = ['木','火','土','金','水'];
  const states = [];
  for (const g of gods) for (const e of elements) states.push({ tenGod: g, branchElement: e });

  // Verify the collapse empirically: bucket all 600 (pillar x dayMaster) pairs
  // by their interpretive state and count how many distinct states actually occur.
  const pillars = all60();
  const seen = new Set();
  const perState = new Map();
  for (const p of pillars) {
    for (const dm of GAN) {
      const key = T.tenGod(dm, p[0]) + '|' + T.ZHI_WUXING[p[1]];
      seen.add(key);
      perState.set(key, (perState.get(key) || 0) + 1);
    }
  }
  return {
    theoreticalStates: gods.length * elements.length,
    observedStates: seen.size,
    observedList: [...seen].sort(),
    pairsPerState: Object.fromEntries([...perState.entries()].sort()),
  };
}

/** Reachable day pillars: all 60 occur in the cycle. Confirm by construction. */
function reachableDayPillars() {
  const set = new Set();
  // walk a long date range and collect the distinct day pillars
  for (let i = 0; i < 200; i++) {
    const d = new Date(Date.UTC(2026, 0, 1 + i));
    const ds = d.toISOString().slice(0, 10);
    set.add(dailyPillar(ds).dayGanZhi);
  }
  return set.size;
}

function main() {
  console.log('================ DAILY FRAGMENT SPACE ================\n');

  const l1 = enumerateLevel1();
  console.log('LEVEL 1 — (today\'s pillar, user day master)');
  console.log(`  distinct day pillars : ${l1.pillars}`);
  console.log(`  day masters          : ${l1.dayMasters}`);
  console.log(`  raw pairs            : ${l1.pairs}`);
  console.log(`  sample               : ${JSON.stringify(l1.sample)}\n`);

  const l2 = enumerateLevel2();
  console.log('LEVEL 2 — adds current luck-cycle pillar');
  console.log(`  combinations         : ${l2.combinations.toLocaleString()}\n`);

  const st = enumerateInterpretiveStates();
  console.log('INTERPRETIVE COLLAPSE — the number that matters');
  console.log(`  theoretical states   : ${st.theoreticalStates}  (10 ten gods x 5 branch elements)`);
  console.log(`  actually observed    : ${st.observedStates}`);
  console.log(`  -> fragments needed  : ${st.observedStates} (one per state)\n`);

  const reach = reachableDayPillars();
  console.log(`distinct day pillars observed over 200 days: ${reach}/60\n`);

  console.log('================ VERDICT ================');
  console.log(`raw pairs              : ${l1.pairs}`);
  console.log(`interpretive fragments : ${st.observedStates}`);
  console.log(`reduction factor       : ${(l1.pairs / st.observedStates).toFixed(1)}x`);
  console.log('');
  if (st.observedStates <= 1000) {
    console.log('=> FULL PRECOMPUTATION IS FEASIBLE.');
    console.log(`   ${st.observedStates} fragments, each written once, vetted once, frozen.`);
    console.log('   Zero model cost and zero drift at serve time.');
  } else {
    console.log('=> precomputation sizeable; consider the live path with checking.');
  }
}

module.exports = { all60, enumerateLevel1, enumerateLevel2, enumerateInterpretiveStates, reachableDayPillars };
if (require.main === module) main();
