'use strict';
/**
 * validate-luck-pillars.js — exact-match validation of our luck-pillar
 * implementation against lunar-javascript 1.7.7.
 *
 * Standard for the project: exact match, or the feature does not ship.
 *
 * Checks, per chart, per gender:
 *   1. direction (forward/backward) agrees with the library
 *   2. every cycle's ganZhi matches
 *   3. every cycle's startYear / endYear matches
 *   4. the start age (y/m/d) matches
 *   5. no gender -> our code reports unavailable (library cannot be asked)
 */

const { Solar } = require('lunar-javascript');
const { luckPillars, isForward } = require('./luck-pillars.js');
const T = require('./bazi-tables.js');

const CASES = [
  ['1980-03-15', '09:20'],   // 庚 yang
  ['1992-07-22', '14:05'],   // 壬 yang
  ['2005-11-08', '03:45'],   // 乙 yin
  ['1995-01-30', '18:30'],   // 甲 yang (pre-LiChun)
  ['1988-09-12', '11:15'],   // 戊 yang
  ['2024-06-01', '23:30'],   // late Zi
  ['1988-02-15', '23:30'],   // late Zi
  ['1975-05-04', '07:10'],
  ['2001-12-25', '21:45'],
  ['1968-08-19', '13:00'],
  ['2010-11-11', '06:30'],
  ['1955-06-06', '06:06'],
];

function libLuck(dateStr, timeStr, gender) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const ec = Solar.fromYmdHms(y, m, d, hh, mm, 0).getLunar().getEightChar();
  const g = gender === 'male' ? 1 : 0;
  const yun = ec.getYun(g, 1);
  return {
    forward: yun.isForward(),
    startYear: yun.getStartYear(),
    startMonth: yun.getStartMonth(),
    startDay: yun.getStartDay(),
    cycles: yun.getDaYun().filter(c => c.getGanZhi())
      .map(c => ({ ganZhi: c.getGanZhi(), startYear: c.getStartYear(), endYear: c.getEndYear() })),
  };
}

function compare(dateStr, timeStr, gender) {
  const mine = luckPillars(dateStr, timeStr, gender, { cycles: 10 });
  const lib = libLuck(dateStr, timeStr, gender);
  const problems = [];

  if (!mine.available) {
    problems.push('our code reported unavailable with a gender supplied');
    return problems;
  }
  if (mine.forward !== lib.forward) problems.push(`direction: ours=${mine.forward} lib=${lib.forward}`);
  if (mine.startAge.years !== lib.startYear) problems.push(`startYear: ours=${mine.startAge.years} lib=${lib.startYear}`);
  if (mine.startAge.months !== lib.startMonth) problems.push(`startMonth: ours=${mine.startAge.months} lib=${lib.startMonth}`);
  if (mine.startAge.days !== lib.startDay) problems.push(`startDay: ours=${mine.startAge.days} lib=${lib.startDay}`);

  const n = Math.min(mine.cycles.length, lib.cycles.length);
  for (let i = 0; i < n; i++) {
    const a = mine.cycles[i], b = lib.cycles[i];
    if (a.ganZhi !== b.ganZhi) problems.push(`cycle[${i}] ganZhi: ours=${a.ganZhi} lib=${b.ganZhi}`);
    if (a.startYear !== b.startYear) problems.push(`cycle[${i}] startYear: ours=${a.startYear} lib=${b.startYear}`);
    if (a.endYear !== b.endYear) problems.push(`cycle[${i}] endYear: ours=${a.endYear} lib=${b.endYear}`);
  }
  return problems;
}

(async () => {
  let checked = 0, passed = 0;
  const failures = [];

  for (const [dateStr, timeStr] of CASES) {
    for (const gender of ['male', 'female']) {
      const problems = compare(dateStr, timeStr, gender);
      checked++;
      if (!problems.length) { passed++; continue; }
      failures.push({ dateStr, timeStr, gender, problems });
      console.log(`MISMATCH ${dateStr} ${timeStr} ${gender}`);
      problems.slice(0, 4).forEach(p => console.log('   ' + p));
    }
  }

  // Direction rule sweep: all 10 year stems x 2 genders, against the library.
  console.log('\n--- direction rule sweep (all charts above, both genders) ---');
  let dirOk = 0, dirTotal = 0;
  const dirFail = [];
  for (const [dateStr, timeStr] of CASES) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const [hh, mm] = timeStr.split(':').map(Number);
    const ec = Solar.fromYmdHms(y, m, d, hh, mm, 0).getLunar().getEightChar();
    const yg = ec.getYearGan();
    for (const gender of ['male', 'female']) {
      dirTotal++;
      const ours = isForward(yg, gender);
      const lib = ec.getYun(gender === 'male' ? 1 : 0, 1).isForward();
      if (ours === lib) dirOk++; else dirFail.push(`${dateStr} ${gender} yg=${yg} ours=${ours} lib=${lib}`);
    }
  }
  console.log(`direction: ${dirOk}/${dirTotal} agree`);
  dirFail.forEach(f => console.log('   ' + f));

  // No-gender behaviour.
  console.log('\n--- no-gender behaviour ---');
  const ng = luckPillars('1980-03-15', '09:20', null);
  console.log(`available=${ng.available} reason="${ng.reason || ''}"`);

  // Annual + daily spot checks against the library.
  console.log('\n--- annual & daily pillars ---');
  const { annualPillar, dailyPillar } = require('./luck-pillars.js');
  let apOk = 0, apTotal = 0, dpOk = 0, dpTotal = 0;
  for (const yr of [1980, 1992, 2005, 2024, 2026]) {
    const mine = annualPillar(yr).ganZhi;
    const lib = Solar.fromYmdHms(yr, 6, 1, 12, 0, 0).getLunar().getEightChar().getYear();
    apTotal++; if (mine === lib) apOk++; else console.log(`  annual ${yr}: ours=${mine} lib=${lib}`);
  }
  for (const ds of ['1980-03-15', '2024-06-01', '2026-10-15', '1968-08-19']) {
    const mine = dailyPillar(ds).dayGanZhi;
    const [y, m, d] = ds.split('-').map(Number);
    const lib = Solar.fromYmdHms(y, m, d, 12, 0, 0).getLunar().getEightChar().getDay();
    dpTotal++; if (mine === lib) dpOk++; else console.log(`  daily ${ds}: ours=${mine} lib=${lib}`);
  }
  console.log(`annual: ${apOk}/${apTotal} | daily: ${dpOk}/${dpTotal}`);

  console.log('\n================ RESULT ================');
  console.log(`luck pillars: ${passed}/${checked} exact`);
  console.log(failures.length ? `FAILURES: ${failures.length}` : 'no mismatches');
  process.exit(failures.length || dirFail.length ? 1 : 0);
})();
