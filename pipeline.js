'use strict';
/**
 * pipeline.js — the product entry point.
 *
 *   birth (date + time)
 *     -> CHART        computed exactly (bazi.js, no model)
 *     -> READING      written by the generator model from those facts
 *     -> VERDICT      extracted claims compared against the chart (CODE)
 *     -> RESULT       { chart, reading, accountability, verdict }
 *
 * Non-blocking by design (ADR 0002): the reading is returned whether or not the
 * verdict flags it. The verdict is logged either way.
 *
 * The extraction step can be disabled entirely via the toggle — the pipeline
 * still produces a reading, just without the accountability check.
 */

const fs = require('fs');
const path = require('path');
const generator = require('./generator.js');
const extractor = require('./extractor.js');
const client = require('./ollama-client.js');
const { luckPillars, annualPillar, dailyPillar } = require('./luck-pillars.js');

const RESULTS_DIR = path.join(__dirname, 'readings');

/**
 * Run the full pipeline for one birth.
 *
 * @param {string} dateStr  'YYYY-MM-DD'
 * @param {string} timeStr  'HH:MM'
 * @param {object} opts
 *   - check: boolean            enable extraction+verdict (default: extractor DEFAULTS)
 *   - generatorModel: string    override the generator model
 *   - extractorModel: string    override the extractor model
 *   - save: boolean             write the result to readings/ (default true)
 *   - keys: string[]            explicit keys to try first
 *   - gender: 'male'|'female'   OPTIONAL. Enables 大运 luck cycles. When absent,
 *                               the cycles are simply not computed (see
 *                               luck-pillars.js) — the chart is unaffected.
 *   - cycles: number            how many 10-year cycles to include (default 10)
 *   - timeline: boolean         also include annual + daily pillars (default false)
 */
async function run(dateStr, timeStr, opts = {}) {
  const started = Date.now();

  // 1. CHART — deterministic, no model, no key needed.
  const gen = await generator.generate(dateStr, timeStr, {
    model: opts.generatorModel,
    keys: opts.keys,
    timeoutMs: opts.generatorTimeoutMs,
  });

  if (!gen.ok) {
    return {
      ok: false,
      stage: 'generator',
      dateStr, timeStr,
      error: gen.error,
      detail: gen.detail,
      triedKeys: gen.triedKeys,
      chart: gen.facts ? {
        pillars: gen.facts.pillars,
        dayMaster: gen.facts.dayMaster,
        strongestElement: gen.facts.strongestElement,
      } : null,
    };
  }

  // 2. READING -> 3. VERDICT (non-blocking; toggle respected)
  const check = opts.check !== undefined ? opts.check : extractor.DEFAULTS.enabled;
  let accountability = null;

  if (check) {
    const res = await extractor.checkReading(gen.reading, dateStr, timeStr, {
      enabled: true,
      model: opts.extractorModel || client.MODELS.extractor,
    });
    accountability = {
      verdict: res.verdict,
      claims: res.claims,
      failures: res.failures,
      extractorModel: res.model,
      extractorLatencyMs: res.latencyMs,
      extractorError: res.extractorError || null,
      parseError: res.parseError || null,
    };
  }

  // 3. OPTIONAL timing layers. Deterministic; no model, no key needed.
  //    Gender is required for cycle DIRECTION only. Absent gender is not an
  //    error — the cycles are simply unavailable, and the chart stands alone.
  let timing = null;
  if (opts.gender || opts.timeline) {
    const lp = luckPillars(dateStr, timeStr, opts.gender || null, { cycles: opts.cycles || 10 });
    timing = { luckPillars: lp };
    if (opts.timeline) {
      const now = new Date();
      timing.annual = annualPillar(now.getFullYear(), gen.facts.dayMaster);
      timing.daily = dailyPillar(
        `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
    }
  }

  const result = {
    ok: true,
    dateStr, timeStr,
    chart: {
      pillars: gen.facts.pillars,
      dayMaster: gen.facts.dayMaster,
      tenGods: gen.facts.tenGods,
      elements: gen.facts.elements,
      strongestElement: gen.facts.strongestElement,
      weakestElement: gen.facts.weakestElement,
      relations: gen.facts.relations,
    },
    reading: gen.reading,
    generator: { model: gen.model, latencyMs: gen.latencyMs, keySource: gen.keySource },
    timing,                     // null when neither gender nor timeline requested
    accountability,             // null when the toggle is off
    checkEnabled: check,
    stages: { generatorMs: gen.latencyMs, extractorMs: accountability ? accountability.extractorLatencyMs : null },
    totalMs: Date.now() - started,
  };

  if (opts.save !== false) save(result);
  return result;
}

function save(result) {
  try {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const slug = `${result.dateStr}_${result.timeStr.replace(':', '')}`;
    const p = path.join(RESULTS_DIR, slug + '.json');
    fs.writeFileSync(p, JSON.stringify(result, null, 2));
    result.savedTo = p;
  } catch (e) {
    result.saveError = e.message;
  }
}

/** Human-readable rendering of the verdict, for the accountability view. */
function formatAccountability(result) {
  if (!result.checkEnabled) return 'accountability: extraction disabled (toggle off)';
  const a = result.accountability;
  if (!a) return 'accountability: not run';
  const lines = [`verdict: ${a.verdict}`];
  for (const c of a.claims) {
    const mark = c.ok === false ? 'FAIL' : c.ok === true ? 'ok  ' : 'n/a ';
    lines.push(`  ${mark} ${c.type}: claimed ${JSON.stringify(c.claimed)}` +
      (c.ok === false ? ` — expected ${JSON.stringify(c.expected)}` : ''));
    if (c.note) lines.push(`       note: ${c.note}`);
  }
  if (!a.claims.length) lines.push('  (no claims extracted)');
  return lines.join('\n');
}

module.exports = { run, formatAccountability, RESULTS_DIR };

if (require.main === module) {
  const [dateStr, timeStr] = (process.argv[2] || '1980-03-15 09:20').split(' ');
  const checkFlag = process.argv[3];
  (async () => {
    const opts = {};
    if (checkFlag === 'off') opts.check = false;
    const r = await run(dateStr, timeStr, opts);
    if (!r.ok) {
      console.log(`FAILED at ${r.stage}: ${r.error} ${r.detail || ''}`);
      process.exit(1);
    }
    console.log('=== CHART ===');
    console.log('pillars:    ' + r.chart.pillars);
    console.log('dayMaster:  ' + r.chart.dayMaster);
    console.log('strongest:  ' + r.chart.strongestElement + '   weakest: ' + r.chart.weakestElement);
    console.log('relations:  ' + JSON.stringify(r.chart.relations.clashes || []) + ' / ' +
      JSON.stringify(r.chart.relations.combinations || []) + ' / ' +
      JSON.stringify(r.chart.relations.harms || []) + ' / ' +
      JSON.stringify(r.chart.relations.punishments || []));
    console.log('');
    console.log('=== READING (' + r.generator.model + ', ' + r.generator.latencyMs + 'ms) ===');
    console.log(r.reading);
    console.log('');
    console.log('=== ACCOUNTABILITY ===');
    console.log(formatAccountability(r));
    console.log('');
    console.log('total: ' + r.totalMs + 'ms' +
      '  (generator ' + r.stages.generatorMs + 'ms' +
      (r.stages.extractorMs != null ? ', extractor ' + r.stages.extractorMs + 'ms' : ', extraction skipped') + ')' +
      (r.savedTo ? '  saved: ' + path.basename(r.savedTo) : ''));
  })();
}
