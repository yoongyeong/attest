'use strict';
/**
 * daily-fortune.js — the serve path for the daily-fortune fragment library.
 *
 * Composes nothing and generates nothing: it looks up the precomputed fragment
 * for today's interpretive state. Zero model cost, zero drift, instant.
 *
 *   state = ( Ten God of today's stem vs the user's day master,
 *             element of today's branch )
 *
 * 50 states cover the whole day-pillar space (see daily-fragments.js).
 */

const fs = require('fs');
const path = require('path');
const T = require('./bazi-tables.js');
const { dailyPillar } = require('./luck-pillars.js');

const FRAGMENTS_PATH = path.join(__dirname, 'fragments.json');

let _cache = null;
function loadFragments() {
  if (_cache) return _cache;
  const raw = JSON.parse(fs.readFileSync(FRAGMENTS_PATH, 'utf8'));
  const byKey = new Map();
  for (const f of raw.fragments) byKey.set(f.key, f);
  _cache = { meta: { generatedAt: raw.generatedAt, model: raw.model, count: raw.count }, byKey };
  return _cache;
}

/**
 * The interpretive state for a given day + user.
 * @param {string} dayMaster   the user's day-master stem (e.g. 丁)
 * @param {string} dayPillar   today's day pillar (e.g. 辛酉)
 */
function stateFor(dayMaster, dayPillar) {
  if (!dayMaster || !dayPillar || dayPillar.length < 2) return null;
  const tenGod = T.tenGod(dayMaster, dayPillar[0]);
  const element = T.ZHI_WUXING[dayPillar[1]];
  if (!tenGod || !element) return null;
  return { tenGod, element, key: tenGod + '|' + element };
}

/**
 * Daily fortune for a user's chart on a given date.
 *
 * @param {object} chartOrDayMaster  a chart object from bazi.chart(), or a day-master stem
 * @param {string} dateStr           'YYYY-MM-DD'
 * @returns {object} { available, date, dayPillar, tenGod, element, key, sections, meta }
 */
function dailyFortune(chartOrDayMaster, dateStr) {
  const dayMaster = typeof chartOrDayMaster === 'string'
    ? chartOrDayMaster
    : (chartOrDayMaster && chartOrDayMaster.pillars && chartOrDayMaster.pillars.day
        ? chartOrDayMaster.pillars.day[0]
        : (chartOrDayMaster && chartOrDayMaster.dayMaster) || null);

  if (!dayMaster) {
    return { available: false, reason: 'no day master supplied (a chart or a day-master stem is required)' };
  }

  const { dayGanZhi } = dailyPillar(dateStr);
  const state = stateFor(dayMaster, dayGanZhi);
  if (!state) {
    return { available: false, reason: 'could not derive state', dayMaster, dayPillar: dayGanZhi };
  }

  const lib = loadFragments();
  const frag = lib.byKey.get(state.key);
  if (!frag) {
    return {
      available: false,
      reason: 'no fragment for state ' + state.key,
      dayMaster, dayPillar: dayGanZhi, ...state,
    };
  }

  return {
    available: true,
    date: dateStr,
    dayMaster,
    dayPillar: dayGanZhi,
    tenGod: state.tenGod,
    element: state.element,
    key: state.key,
    sections: frag.sections,
    meta: { model: lib.meta.model, fragmentGeneratedAt: lib.meta.generatedAt, fragmentsCount: lib.meta.count },
  };
}

/** Coverage check: which of the 50 states have fragments. */
function coverage() {
  const lib = loadFragments();
  const missing = [];
  for (const g of ['比肩','劫财','食神','伤官','偏财','正财','七杀','正官','偏印','正印']) {
    for (const e of ['木','火','土','金','水']) {
      if (!lib.byKey.has(g + '|' + e)) missing.push(g + '|' + e);
    }
  }
  return { total: lib.byKey.size, missing, complete: missing.length === 0 };
}

module.exports = { dailyFortune, stateFor, coverage, loadFragments };

if (require.main === module) {
  const chart = require('./bazi.js').chart('1980-03-15', '09:20');
  const dateStr = process.argv[2] || new Date().toISOString().slice(0, 10);

  console.log('=== coverage ===');
  console.log(JSON.stringify(coverage(), null, 2));

  console.log('\n=== daily fortune ===');
  console.log('user day master: ' + chart.pillars.day[0] + '  |  date: ' + dateStr);
  const r = dailyFortune(chart, dateStr);
  if (!r.available) { console.log('UNAVAILABLE: ' + r.reason); process.exit(1); }
  console.log(`today's pillar: ${r.dayPillar}   state: ${r.tenGod} / ${r.element}`);
  console.log('');
  for (const [k, v] of Object.entries(r.sections)) console.log(`[${k}] ${v}\n`);
}
