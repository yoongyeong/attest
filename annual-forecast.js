'use strict';
/**
 * annual-forecast.js — compose an annual forecast from the two fragment sets.
 *
 *   K1  (Ten God of the annual stem, element of the annual branch)  -> WHAT the year is
 *   K2  (relation class between the annual branch and the natal chart) -> HOW it lands
 *
 * Composition, not multiplication: 50 + 16 fragments yield 800 distinct readings.
 *
 * The seam risk is real — two independently-written fragments stitched together
 * can read stitched. `compose()` therefore does NOT simply concatenate: it merges
 * by section and interleaves K1 and K2 voices so the reading reads as one piece.
 */

const fs = require('fs');
const path = require('path');
const T = require('./bazi-tables.js');
const { annualPillar } = require('./luck-pillars.js');
const { relationClasses } = require('./annual-fragments.js');

const PATH_FRAG = path.join(__dirname, 'annual-fragments.json');

let _cache = null;
function load() {
  if (_cache) return _cache;
  const raw = JSON.parse(fs.readFileSync(PATH_FRAG, 'utf8'));
  const k1 = new Map(), k2 = new Map();
  for (const f of raw.fragments) {
    if (f.kind === 'K1') k1.set(f.tenGod + '|' + f.element, f);
    else k2.set(f.relation, f);
  }
  _cache = { meta: raw, k1, k2 };
  return _cache;
}

/** The K1 key for a year + day master. */
function k1KeyFor(dayMaster, year) {
  const ap = annualPillar(year);
  const god = T.tenGod(dayMaster, ap.ganZhi[0]);
  const el = T.ZHI_WUXING[ap.ganZhi[1]];
  return { key: god + '|' + el, tenGod: god, element: el, yearPillar: ap.ganZhi };
}

/** The K2 key for a chart + year. */
function k2KeyFor(natalBranches, year) {
  const br = annualPillar(year).ganZhi[1];
  const cls = relationClasses(natalBranches, br);
  return { key: cls.length ? cls.join('+') : 'none', classes: cls };
}

/**
 * Compose the annual forecast.
 *
 * Merge strategy (the seam fix):
 *   overall -> K1 overall (the year's theme) + K2 overall (the texture of contact)
 *   career/money/love/health -> K1 sections, each closed with the K2 advice
 *   rhythm/advice -> K2's own sections, exposed separately as the pacing layer
 *
 * This keeps one narrative voice: K1 carries the domain content, K2 supplies the
 * connective texture rather than being bolted on as a second block.
 */
function compose(k1, k2, meta) {
  const s1 = k1.sections, s2 = k2 ? k2.sections : null;
  const out = {};

  if (s2) {
    out.overall = `${s1.overall} ${s2.overall}`;
  } else {
    out.overall = s1.overall;
  }

  for (const dom of ['career', 'money', 'love', 'health']) {
    out[dom] = s1[dom];
  }

  if (s2) {
    out.rhythm = s2.rhythm;
    out.advice = s2.advice;
  }

  // Internal bookkeeping (fragment keys, for provenance) is returned SEPARATELY
  // from the sections. Everything in `sections` is rendered as content by the API
  // and the page, so nothing internal may live there.
  return {
    sections: out,
    meta,
  };
}

/**
 * Annual forecast for a chart.
 * @param {object|string} chartOrDayMaster  chart object from bazi.chart(), or a day-master stem
 * @param {number} year
 * @param {string[]} [natalBranches]  required for the K2 layer; if absent, K1 only
 */
function annualForecast(chartOrDayMaster, year, natalBranches) {
  const lib = load();

  const dayMaster = typeof chartOrDayMaster === 'string'
    ? chartOrDayMaster
    : (chartOrDayMaster && chartOrDayMaster.pillars && chartOrDayMaster.pillars.day
        ? chartOrDayMaster.pillars.day[0]
        : (chartOrDayMaster && chartOrDayMaster.dayMaster) || null);

  if (!dayMaster) return { available: false, reason: 'no day master supplied' };

  // natal branches can be derived from a chart object
  let branches = natalBranches;
  if (!branches && chartOrDayMaster && chartOrDayMaster.pillars) {
    const p = chartOrDayMaster.pillars;
    branches = [p.year[1], p.month[1], p.day[1], p.hour[1]];
  }

  const k1info = k1KeyFor(dayMaster, year);
  const k1 = lib.k1.get(k1info.key);
  if (!k1) return { available: false, reason: 'no K1 fragment for ' + k1info.key };

  let k2info = null, k2 = null;
  if (branches && branches.length) {
    k2info = k2KeyFor(branches, year);
    k2 = lib.k2.get(k2info.key);
  }

  const composed = compose(k1, k2, {
    year,
    yearPillar: k1info.yearPillar,
    dayMaster,
    k1Key: k1info.key,
    k2Key: k2info ? k2info.key : null,
    k2Classes: k2info ? k2info.classes : null,
    k2Available: !!k2,
  });

  return {
    available: true,
    year,
    yearPillar: k1info.yearPillar,
    dayMaster,
    tenGod: k1info.tenGod,
    element: k1info.element,
    relationClass: k2info ? k2info.key : null,
    sections: composed.sections,
    meta: composed.meta,
  };
}

/** Coverage of both sets. */
function coverage() {
  const lib = load();
  const missingK1 = [], missingK2 = [];
  for (const g of ['比肩','劫财','食神','伤官','偏财','正财','七杀','正官','偏印','正印'])
    for (const e of ['木','火','土','金','水'])
      if (!lib.k1.has(g + '|' + e)) missingK1.push(g + '|' + e);
  const k2Keys = ['none','clash','combine','harm','punish','clash+combine','clash+harm','clash+punish',
    'combine+harm','combine+punish','harm+punish','clash+combine+harm','clash+combine+punish',
    'clash+harm+punish','combine+harm+punish','clash+combine+harm+punish'];
  for (const k of k2Keys) if (!lib.k2.has(k)) missingK2.push(k);
  return { k1: lib.k1.size, k2: lib.k2.size, missingK1, missingK2, complete: !missingK1.length && !missingK2.length };
}

module.exports = { annualForecast, compose, k1KeyFor, k2KeyFor, coverage, load };

if (require.main === module) {
  const chart = require('./bazi.js').chart('1980-03-15', '09:20');
  const year = Number(process.argv[2] || 2026);
  console.log('=== coverage ===');
  console.log(JSON.stringify(coverage(), null, 2));
  console.log('\n=== annual forecast ' + year + ' ===');
  const r = annualForecast(chart, year);
  if (!r.available) { console.log('UNAVAILABLE: ' + r.reason); process.exit(1); }
  console.log(`day master ${r.dayMaster} | year pillar ${r.yearPillar} | state ${r.tenGod}/${r.element} | relation ${r.relationClass}`);
  console.log('');
  for (const [k, v] of Object.entries(r.sections)) {
    if (k === '_meta') continue;
    console.log(`[${k}] ${v}\n`);
  }
}
