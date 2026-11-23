'use strict';
/**
 * luck-pillars.js — 大运 (ten-year luck cycles), 流年 (annual), 流日 (daily).
 *
 * All arithmetic. No model. Per ARCHITECTURE.md, this is exactly the class of
 * work that must not be delegated to a generator model.
 *
 * GENDER IS OPTIONAL (settled by research, 2026-10-15):
 *   Direction depends on the birth-year stem polarity and gender:
 *     forward = (yang year stem AND male) OR (yin year stem AND female)
 *   Without gender the direction is undetermined, so the cycle sequence cannot
 *   be computed at all. The chart itself is unaffected — gender plays no role
 *   in pillars, Ten Gods, elements or relations. Callers therefore get
 *   `available: false` rather than an error when gender is absent.
 *
 * Verified against lunar-javascript 1.7.7 — see validate-luck-pillars.js.
 */

const { Solar } = require('lunar-javascript');
const T = require('./bazi-tables.js');

const GAN = T.GAN, ZHI = T.ZHI;

const YANG_STEMS = new Set(['甲','丙','戊','庚','壬']);

/**
 * Direction of the luck cycle.
 * @param {string} yearGan  the BaZi year stem (after Li Chun)
 * @param {'male'|'female'} gender
 * @returns {boolean|null} true=forward, false=backward, null=undetermined
 */
function isForward(yearGan, gender) {
  if (gender !== 'male' && gender !== 'female') return null;
  const yang = YANG_STEMS.has(yearGan);
  const male = gender === 'male';
  return (yang && male) || (!yang && !male);
}

/**
 * Luck pillars for a birth.
 *
 * @param {string} dateStr 'YYYY-MM-DD'
 * @param {string} timeStr 'HH:MM'
 * @param {'male'|'female'|null} gender
 * @param {object} opts { cycles: number } how many 10-year cycles (default 10)
 * @returns {object} { available, reason?, forward?, startAge?, startSolar?, cycles: [] }
 */
function luckPillars(dateStr, timeStr, gender = null, opts = {}) {
  const cycles = opts.cycles || 10;

  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const ec = Solar.fromYmdHms(y, m, d, hh, mm, 0).getLunar().getEightChar();

  const yearGan = ec.getYearGan();
  const forward = isForward(yearGan, gender);

  if (forward === null) {
    return {
      available: false,
      reason: 'gender required for cycle direction; chart itself is unaffected',
      yearGan,
    };
  }

  // gender integer for the library: 1 = male, 0 = female
  const g = gender === 'male' ? 1 : 0;
  const yun = ec.getYun(g, 1);

  // Cross-check our direction rule against the library's own judgement.
  const libForward = yun.isForward();
  const directionAgrees = libForward === forward;

  const daYun = yun.getDaYun();
  const out = [];
  for (const c of daYun) {
    const gz = c.getGanZhi();
    if (!gz) continue; // the first entry is the pre-start period, with no pillar
    out.push({
      ganZhi: gz,
      startAge: c.getStartAge(),
      endAge: c.getEndAge ? c.getEndAge() : null,
      startYear: c.getStartYear(),
      endYear: c.getEndYear(),
      tenGod: T.tenGod(ec.getDayGan(), gz[0]),
    });
    if (out.length >= cycles) break;
  }

  return {
    available: true,
    forward,
    directionAgrees,
    startAge: {
      years: yun.getStartYear(),
      months: yun.getStartMonth(),
      days: yun.getStartDay(),
      solar: yun.getStartSolar() ? yun.getStartSolar().toYmd() : null,
    },
    startPillarBase: ec.getMonth(),   // cycles step from the month pillar
    dayMaster: ec.getDayGan(),
    cycles: out,
  };
}

/**
 * Annual pillar (流年) for a calendar year, as it relates to a chart.
 * The year pillar changes at Li Chun, not January 1 — handled by the library.
 */
function annualPillar(year, dayGan) {
  // A representative moment safely after Li Chun of that year.
  const ec = Solar.fromYmdHms(year, 6, 1, 12, 0, 0).getLunar().getEightChar();
  const gz = ec.getYear();
  return {
    year,
    ganZhi: gz,
    tenGod: dayGan ? T.tenGod(dayGan, gz[0]) : null,
  };
}

/** Daily pillar (流日) for a calendar date. Pure date arithmetic. */
function dailyPillar(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const solar = Solar.fromYmdHms(y, m, d, 12, 0, 0);
  const ec = solar.getLunar().getEightChar();
  return {
    date: dateStr,
    dayGanZhi: ec.getDay(),
    monthGanZhi: ec.getMonth(),
    yearGanZhi: ec.getYear(),
  };
}

/** Monthly pillar (流月) for a year+month. */
function monthlyPillar(year, month) {
  const ec = Solar.fromYmdHms(year, month, 15, 12, 0, 0).getLunar().getEightChar();
  return { year, month, monthGanZhi: ec.getMonth() };
}

module.exports = { luckPillars, isForward, annualPillar, dailyPillar, monthlyPillar, YANG_STEMS };

if (require.main === module) {
  const [dateStr, timeStr] = (process.argv[2] || '1980-03-15 09:20').split(' ');
  const gender = process.argv[3] || null;
  const r = luckPillars(dateStr, timeStr, gender);
  console.log(JSON.stringify(r, null, 2));
}
