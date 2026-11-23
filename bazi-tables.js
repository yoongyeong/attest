'use strict';
/**
 * Bazi domain tables — the raw material for the derived layers.
 *
 * Kept separate from bazi.js so the engine stays readable. Every table here is
 * cross-validated against lunar-javascript 1.7.7 (see validate-features.js).
 */

const GAN = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
const ZHI = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];

// Element of each stem.
const GAN_WUXING = {
  甲:'木', 乙:'木', 丙:'火', 丁:'火', 戊:'土',
  己:'土', 庚:'金', 辛:'金', 壬:'水', 癸:'水',
};

// Yang (true) / Yin (false) polarity of each stem.
const GAN_YANG = { 甲:true, 乙:false, 丙:true, 丁:false, 戊:true,
                   己:false, 庚:true, 辛:false, 壬:true, 癸:false };

// Element of each branch (its primary element).
const ZHI_WUXING = {
  子:'水', 丑:'土', 寅:'木', 卯:'木', 辰:'土', 巳:'火',
  午:'火', 未:'土', 申:'金', 酉:'金', 戌:'土', 亥:'水',
};

// Hidden stems (藏干) carried inside each branch, primary first.
// Order and content verified against lunar-javascript ZHI_HIDE_GAN.
const ZHI_HIDE_GAN = {
  子:['癸'],
  丑:['己','癸','辛'],
  寅:['甲','丙','戊'],
  卯:['乙'],
  辰:['戊','乙','癸'],
  巳:['丙','庚','戊'],
  午:['丁','己'],
  未:['己','丁','乙'],
  申:['庚','壬','戊'],
  酉:['辛'],
  戌:['戊','辛','丁'],
  亥:['壬','甲'],
};

// Generating cycle (生): key generates value.
const GENERATES = { 木:'火', 火:'土', 土:'金', 金:'水', 水:'木' };
// Controlling cycle (克): key controls value.
const CONTROLS  = { 木:'土', 土:'水', 水:'火', 火:'金', 金:'木' };

/**
 * Ten Gods (十神) name for `other` stem, relative to `dayMaster` stem.
 * Deterministic: element relationship x polarity agreement.
 */
function tenGod(dayMaster, other) {
  const de = GAN_WUXING[dayMaster], oe = GAN_WUXING[other];
  const same = GAN_YANG[dayMaster] === GAN_YANG[other];

  if (de === oe)                       return same ? '比肩' : '劫财'; // peer
  if (GENERATES[de] === oe)            return same ? '食神' : '伤官'; // output I generate
  if (CONTROLS[de] === oe)             return same ? '偏财' : '正财'; // wealth I control
  if (CONTROLS[oe] === de)             return same ? '七杀' : '正官'; // authority controlling me
  if (GENERATES[oe] === de)            return same ? '偏印' : '正印'; // resource generating me
  return null; // unreachable for valid stems
}

/**
 * Five-element tally for a chart.
 * Default weighting: visible stems count 1.0; branch primary element counts 1.0;
 * hidden stems count per their weight (primary 0.5, others 0.25 by default).
 * Weighting is configurable because this convention is school-dependent.
 */
function elementBalance(parts, opts = {}) {
  const wVisible = opts.visibleStemWeight ?? 1.0;
  const wBranch  = opts.branchWeight      ?? 1.0;
  const hidden   = opts.hiddenStems       ?? true;
  const wHiddenPrimary = opts.hiddenPrimaryWeight ?? 0.5;
  const wHiddenOther   = opts.hiddenOtherWeight   ?? 0.25;

  const tally = { 木:0, 火:0, 土:0, 金:0, 水:0 };
  const add = (el, w) => { if (el) tally[el] += w; };

  for (const key of ['year','month','day','hour']) {
    const pillar = parts[key];
    if (!pillar) continue;
    const [gan, zhi] = [pillar[0], pillar[1]];
    add(GAN_WUXING[gan], wVisible);
    add(ZHI_WUXING[zhi], wBranch);
    if (hidden) {
      const hs = ZHI_HIDE_GAN[zhi] || [];
      hs.forEach((g, i) => add(GAN_WUXING[g], i === 0 ? wHiddenPrimary : wHiddenOther));
    }
  }
  const total = Object.values(tally).reduce((a,b)=>a+b, 0);
  const percent = {};
  for (const k of Object.keys(tally)) percent[k] = total ? +(tally[k]/total*100).toFixed(1) : 0;
  return { raw: tally, percent, total };
}

/**
 * Ten Gods for every visible stem, plus the branch hidden stems.
 * The day stem itself is labelled 日主 (day master) rather than a god.
 */
function tenGodsForChart(parts) {
  const dm = parts.day[0];
  const out = { dayMaster: dm, stems: {}, branches: {} };

  for (const key of ['year','month','day','hour']) {
    const pillar = parts[key];
    if (!pillar) continue;
    const [gan, zhi] = [pillar[0], pillar[1]];
    out.stems[key] = (key === 'day') ? '日主' : tenGod(dm, gan);
    out.branches[key] = (ZHI_HIDE_GAN[zhi] || []).map(g => tenGod(dm, g));
  }
  return out;
}

// Six clashes (六冲) — opposite branches, 6 apart in the cycle.
const CHONG = {
  子:'午', 午:'子', 丑:'未', 未:'丑', 寅:'申', 申:'寅',
  卯:'酉', 酉:'卯', 辰:'戌', 戌:'辰', 巳:'亥', 亥:'巳',
};

// Six combinations (六合) — pairwise branch pairings.
const HE6 = {
  子:'丑', 丑:'子', 寅:'亥', 亥:'寅', 卯:'戌', 戌:'卯',
  辰:'酉', 酉:'辰', 巳:'申', 申:'巳', 午:'未', 未:'午',
};

// Three-harmonies (三合) — elemental frames of three branches.
const SAN_HE = [
  { branches:['申','子','辰'], element:'水' },
  { branches:['亥','卯','未'], element:'木' },
  { branches:['寅','午','戌'], element:'火' },
  { branches:['巳','酉','丑'], element:'金' },
];

// Three-meetings (三会) — directional seasonal frames.
const SAN_HUI = [
  { branches:['寅','卯','辰'], element:'木' },
  { branches:['巳','午','未'], element:'火' },
  { branches:['申','酉','戌'], element:'金' },
  { branches:['亥','子','丑'], element:'水' },
];

// Punishments (刑) — classical rule set. The library's ZHI_XING holds the
// twelve day-officers (建除), NOT punishments, so these are defined here.
//   寅巳申 (three-way punishment), 丑戌未 (three-way punishment),
//   子卯 (mutual), and self-punishments 辰辰 午午 酉酉 亥亥.
const XING_SETS = [
  ['寅','巳','申'],
  ['丑','戌','未'],
];
const XING_PAIRS = [['子','卯']];
const XING_SELF = { 辰:'辰', 午:'午', 酉:'酉', 亥:'亥' };

// Six harms (害).
const HAI = {
  子:'未', 未:'子', 丑:'午', 午:'丑', 寅:'巳', 巳:'寅',
  卯:'辰', 辰:'卯', 申:'亥', 亥:'申', 酉:'戌', 戌:'酉',
};

/** All pairwise relationships present among a list of branches. */
function branchRelations(branches) {
  const uniq = [...new Set(branches)];
  const out = { clashes: [], combinations: [], harms: [], punishments: [] };

  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      const a = uniq[i], b = uniq[j];
      if (CHONG[a] === b) out.clashes.push(a + b);
      if (HE6[a] === b)   out.combinations.push(a + b);
      if (HAI[a] === b)   out.harms.push(a + b);
      for (const pair of XING_PAIRS) {
        if (pair.includes(a) && pair.includes(b)) out.punishments.push(a + b);
      }
      // Partial pairs from the three-way punishment sets also constitute a
      // punishment (寅巳申 / 丑戌未). Any two of the three fire.
      for (const set of XING_SETS) {
        if (set.includes(a) && set.includes(b)) out.punishments.push(a + b);
      }
    }
  }

  // 三合 / 三会 frames complete when all three branches are present.
  out.threeHarmonies = SAN_HE.filter(s => s.branches.every(b => uniq.includes(b)))
    .map(s => ({ branches: s.branches.join(''), element: s.element }));
  out.threeMeetings = SAN_HUI.filter(s => s.branches.every(b => uniq.includes(b)))
    .map(s => ({ branches: s.branches.join(''), element: s.element }));

  return out;
}

module.exports = {
  GAN, ZHI, GAN_WUXING, GAN_YANG, ZHI_WUXING, ZHI_HIDE_GAN,
  GENERATES, CONTROLS, tenGod, elementBalance, tenGodsForChart,
  CHONG, HE6, SAN_HE, SAN_HUI, HAI, XING_SETS, XING_PAIRS, XING_SELF,
  branchRelations,
};
