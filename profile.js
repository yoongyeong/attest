'use strict';
/**
 * profile.js — the unified entry point.
 *
 * One call that answers the actual user question: "given this person, what do
 * they see?" Composes every applicable surface and renders them STACKED.
 *
 * Stacked presentation (chosen 2026-10-16):
 *   - each timescale gets its own labelled block, never an invented transition
 *   - verified facts render in their own register, separate from interpretation
 *   - contributions the composer held back appear in their own block, not merged
 *
 * This is the code-level shape of what becomes the API. A web app, a bot, or a
 * CLI all call this.
 */

const composer = require('./composer.js');
const { chart } = require('./bazi.js');
const { dailyFortune, stateFor } = require('./daily-fortune.js');
const { annualForecast } = require('./annual-forecast.js');
const { luckPillars, annualPillar, dailyPillar } = require('./luck-pillars.js');
const { synthesis } = require('./synthesis.js');
const { compatibility } = require('./compatibility.js');
const T = require('./bazi-tables.js');

// ---------------------------------------------------------------------------
// Verified facts — computed by CODE, never by a model.
// ---------------------------------------------------------------------------
function verifiedFacts(dateStr, ch, year) {
  const p = ch.pillars;
  const natal = [p.year[1], p.month[1], p.day[1], p.hour[1]];
  const today = dailyPillar(dateStr);
  const yearP = annualPillar(year);

  const lines = [];
  lines.push(`Four Pillars: ${p.year} ${p.month} ${p.day} ${p.hour}`);
  lines.push(`Day Master: ${p.day[0]} (${T.GAN_WUXING[p.day[0]]}, ${T.GAN_YANG[p.day[0]] ? 'yang' : 'yin'})`);
  lines.push(`Today's pillar: ${today.dayGanZhi}`);
  lines.push(`Annual pillar ${year}: ${yearP.ganZhi}`);

  const god = T.tenGod(p.day[0], today.dayGanZhi[0]);
  if (god) lines.push(`Today's relation to you: ${god}`);

  return { lines, natal, todayPillar: today.dayGanZhi, yearPillar: yearP.ganZhi };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * @param {object|string} chartOrBirth  a chart object, or an ISO date string
 * @param {object} opts
 *   date     {string}  'YYYY-MM-DD' (default: today)
 *   year     {number}  (default: year of `date`)
 *   gender   {'male'|'female'}  optional — enables luck cycles
 *   partner  {object}  optional chart object — enables the compatibility surface
 *   surfaces {string[]}  which to include; default all available
 *     one of: 'facts' | 'daily' | 'annual' | 'cycles' | 'synthesis' | 'compatibility'
 */
function profile(chartOrBirth, opts = {}) {
  // Accept: a chart object, an ISO datetime string, or a plain birth date.
  let ch, birthDate, birthTime;
  if (typeof chartOrBirth === 'string') {
    const [d, t] = chartOrBirth.split(' ');
    birthDate = d; birthTime = t || '12:00';
    ch = chart(birthDate, birthTime);
  } else {
    ch = chartOrBirth;
    // A chart remembers its own birth (bazi.js sets `birth`). Fall back to opts
    // only for externally-constructed chart objects.
    birthDate = opts.birthDate || (ch && ch.birth && ch.birth.date) || null;
    birthTime = opts.birthTime || (ch && ch.birth && ch.birth.time) || '12:00';
  }

  if (!ch || !ch.pillars) return { ok: false, error: 'no chart supplied' };

  const date = opts.date || new Date().toISOString().slice(0, 10);
  const year = opts.year || Number(date.slice(0, 4));
  const want = opts.surfaces || ['facts', 'daily', 'annual', 'cycles', 'synthesis', 'compatibility'];
  const dm = ch.pillars.day[0];

  const out = {
    ok: true,
    subject: { dayMaster: dm, pillars: ch.asString, date, year, birthDate, birthTime },
    blocks: [],          // stacked presentation, in order
    provenance: {},      // per-section provenance, for the accountability view
    collisions: [],      // recorded, never silently resolved
    warnings: [],
  };

  // ---- 1. VERIFIED FACTS (always first; the trust anchor) ----
  if (want.includes('facts')) {
    const vf = verifiedFacts(date, ch, year);
    out.blocks.push({
      kind: 'verified-fact',
      timescale: null,
      title: 'Your chart',
      lines: vf.lines,
      provenance: [{ set: 'engine', epistemic: 'verified-fact', key: 'computed' }],
    });
  }

  // ---- 2. DAILY (short-horizon habit surface) ----
  if (want.includes('daily')) {
    const d = dailyFortune(ch, date);
    if (d.available) {
      out.blocks.push({
        kind: 'interpretation',
        timescale: 'day',
        title: `Today · ${date}`,
        sections: d.sections,
        meta: { state: d.tenGod + '/' + d.element, dayPillar: d.dayPillar, key: d.key },
        provenance: Object.keys(d.sections).map(s => ({ set: 'daily', epistemic: 'interpretation', key: d.key, section: s })),
      });
    } else {
      out.warnings.push('daily unavailable: ' + d.reason);
    }
  }

  // ---- 3. ANNUAL (long-horizon depth surface) ----
  if (want.includes('annual')) {
    const a = annualForecast(ch, year);
    if (a.available) {
      out.blocks.push({
        kind: 'interpretation',
        timescale: 'year',
        title: `Year · ${year}`,
        sections: a.sections,
        meta: { state: a.tenGod + '/' + a.element, yearPillar: a.yearPillar, relation: a.relationClass },
        provenance: [
          { set: 'annual-k1', epistemic: 'interpretation', key: a.meta && a.meta.k1Key ? a.meta.k1Key : (a.tenGod + '|' + a.element), section: 'overall' },
          ...(a.relationClass ? [{ set: 'annual-k2', epistemic: 'interpretation', key: a.relationClass, section: 'overall' }] : []),
        ],
      });
    } else {
      out.warnings.push('annual unavailable: ' + a.reason);
    }
  }

  // ---- 4. LUCK CYCLES (optional; requires gender) ----
  // Cycles run from the BIRTH, not from today. Without a known birth date the
  // block is skipped rather than silently computed from the wrong anchor.
  let currentDecadePillar = null;
  if (want.includes('cycles')) {
    if (!opts.gender) {
      out.warnings.push('luck cycles skipped: gender not supplied (direction is undetermined)');
    } else if (!birthDate) {
      out.warnings.push('luck cycles skipped: birth date unknown (cycles run from birth, not today)');
    } else {
      const lp = luckPillars(birthDate, birthTime, opts.gender, { cycles: 6 });
      if (lp.available) {
        out.blocks.push({
          kind: 'verified-fact',
          timescale: 'decade',
          title: 'Luck cycles (大运)',
          lines: lp.cycles.map(c =>
            `ages ${c.startAge}–${c.endAge} · ${c.ganZhi} · ${c.tenGod} (${c.startYear}–${c.endYear})`),
          provenance: [{ set: 'engine', epistemic: 'verified-fact', key: 'luckPillars' }],
        });
        // remember the decade in play, for the synthesis layer
        const cur = lp.cycles.find(c => c.startYear <= year && c.endYear >= year) || lp.cycles[0];
        currentDecadePillar = cur ? cur.ganZhi : null;
      } else {
        out.warnings.push('luck cycles unavailable: ' + lp.reason);
      }
    }
  }

  // ---- 5. SYNTHESIS (cross-timescale; needs a decade or a date) ----
  if (want.includes('synthesis')) {
    const syn = synthesis({ year, dayMaster: dm, decadePillar: currentDecadePillar, dateStr: date });
    if (syn.available) {
      for (const part of syn.parts) {
        const label = part.pair === 'decade-year' ? `This year within your decade` : `Today within this year`;
        out.blocks.push({
          kind: 'interpretation',
          timescale: 'synthesis',
          title: `Synthesis · ${label}`,
          sections: {
            synthesis: part.sections.overall,
            texture: part.sections.texture,
            advice: part.sections.advice,
          },
          meta: { pair: part.pair, key: part.key },
          provenance: [{ set: 'synthesis', epistemic: 'interpretation', key: part.key }],
        });
      }
    } else {
      out.warnings.push('synthesis unavailable: ' + syn.reason);
    }
  }

  // ---- 6. COMPATIBILITY (optional; needs a partner chart) ----
  if (want.includes('compatibility')) {
    if (!opts.partner) {
      out.warnings.push('compatibility skipped: no partner chart supplied');
    } else {
      const comp = compatibility(ch, opts.partner);
      if (comp.available) {
        out.blocks.push({
          kind: 'interpretation',
          timescale: 'pair',
          title: `Compatibility`,
          sections: {
            overall: comp.sections.overall,
            strengths: comp.sections.strengths,
            friction: comp.sections.friction,
            advice: comp.sections.advice,
          },
          meta: {
            key: comp.key,
            you: `${comp.you.pillars} (${comp.you.dayMaster})`,
            them: `${comp.them.pillars} (${comp.them.dayMaster})`,
          },
          provenance: [{ set: 'compatibility', epistemic: 'interpretation', key: comp.key }],
        });
      } else {
        out.warnings.push('compatibility unavailable: ' + comp.reason);
      }
    }
  }

  return out;
}

/**
 * Render the stacked blocks as plain text — the honest presentation:
 * labelled timescales, facts separate from interpretation, nothing merged.
 */
function render(result) {
  if (!result.ok) return 'error: ' + result.error;
  const L = [];
  L.push('═'.repeat(64));
  L.push(`DAY MASTER ${result.subject.dayMaster}   ${result.subject.pillars}`);
  L.push('═'.repeat(64));

  for (const b of result.blocks) {
    L.push('');
    const tag = b.kind === 'verified-fact' ? '[VERIFIED]' : '[READING]';
    L.push(`${tag} ${b.title}`);
    L.push('─'.repeat(46));
    if (b.lines) {
      for (const ln of b.lines) L.push('  ' + ln);
    } else if (b.sections) {
      if (b.meta) L.push('  (' + Object.entries(b.meta).map(([k, v]) => `${k}: ${v}`).join(' · ') + ')');
      for (const [sec, txt] of Object.entries(b.sections)) {
        if (sec === '_meta') continue;
        L.push('');
        L.push('  ' + sec.toUpperCase());
        L.push('  ' + txt);
      }
    }
  }

  if (result.warnings.length) {
    L.push('');
    L.push('Notes: ' + result.warnings.join(' | '));
  }
  return L.join('\n');
}

module.exports = { profile, render, verifiedFacts };

if (require.main === module) {
  const gender = process.argv[2] || null;
  // pass the birth datetime so luck cycles anchor correctly
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const r = profile('1980-03-15 09:20', { date: today, year: d.getFullYear(), gender });
  console.log(render(r));
}
