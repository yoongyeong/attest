'use strict';
/**
 * generator.js — writes the consumer reading from computed chart facts.
 *
 * Hard rule: the generator NEVER computes. Every fact it may use is supplied.
 * Its whole job is language. This is the architecture rule from ARCHITECTURE.md
 * applied at the product boundary.
 *
 * Model is configurable (see ollama-client.MODELS.generator) so swapping the
 * narrator is a config change. Ollama-only for now.
 */

const { chart } = require('./bazi.js');
const client = require('./ollama-client.js');

/** The facts a reading may draw on. Computed, verified, never model-derived. */
function factsFor(dateStr, timeStr) {
  return factsFromChartParts(chart(dateStr, timeStr));
}

/**
 * Same, but from a whole chart object — used when the chart comes from the
 * CHART SPACE rather than from a birth date (see chart-space.js).
 */
function factsFromChartParts(c) {
  const els = Object.entries(c.elements.raw).sort((a, b) => b[1] - a[1]);
  const rel = c.branchRelations || {};
  return {
    pillars: `${c.pillars.year} ${c.pillars.month} ${c.pillars.day} ${c.pillars.hour}`,
    pillarParts: c.pillars,
    dayMaster: c.tenGods.dayMaster,
    tenGods: c.tenGods,
    elements: c.elements.raw,
    elementPercent: c.elements.percent,
    strongestElement: els[0][0],
    weakestElement: els[els.length - 1][0],
    relations: rel,
    chart: c,
  };
}

function buildPrompt(facts) {
  const rel = facts.relations || {};
  const relLines = [];
  if (rel.clashes && rel.clashes.length) relLines.push(`clashes: ${rel.clashes.join(', ')}`);
  if (rel.combinations && rel.combinations.length) relLines.push(`combinations: ${rel.combinations.join(', ')}`);
  if (rel.harms && rel.harms.length) relLines.push(`harms: ${rel.harms.join(', ')}`);
  if (rel.punishments && rel.punishments.length) relLines.push(`punishments: ${rel.punishments.join(', ')}`);
  if (rel.threeHarmonies && rel.threeHarmonies.length) relLines.push(`three-harmonies: ${rel.threeHarmonies.map(t => t.branches).join(', ')}`);
  if (rel.threeMeetings && rel.threeMeetings.length) relLines.push(`three-meetings: ${rel.threeMeetings.map(t => t.branches).join(', ')}`);
  const relText = relLines.length ? relLines.join('\n  ') : 'none present';

  return `You are writing a short BaZi (Four Pillars) reading for a person.

The chart data below is VERIFIED and AUTHORITATIVE. It was computed exactly.
You must NOT recalculate, alter, or add to it.
Every factual statement you make MUST match it.

Four Pillars (year month day hour): ${facts.pillars}
Day Master: ${facts.dayMaster}
Ten Gods by pillar: ${JSON.stringify(facts.tenGods.stems)}
Element tally: ${JSON.stringify(facts.elements)}
Strongest element: ${facts.strongestElement}
Weakest element: ${facts.weakestElement}
Branch relationships present:
  ${relText}

Write a warm, readable reading of 4-6 sentences for a non-technical reader.
Explain what their day master means, what their dominant element suggests, and
what the branch relationships (if any) indicate about their tendencies.

IMPORTANT: if the branch relationships above say "none present", say there are
none. If they list specific relationships, refer to those specifically. Do not
invent relationships, and do not claim the absence of relationships that the
data lists.

Interpret freely. Just keep every factual claim consistent with the data.`;
}

/**
 * Generate a reading.
 * @returns {{ok:boolean, reading?:string, facts:object, model:string,
 *            latencyMs?:number, keySource?:string, error?:string, detail?:string}}
 */
async function generate(dateStr, timeStr, opts = {}) {
  return generateWithFacts(factsFor(dateStr, timeStr), opts);
}

/**
 * Generate a reading for a chart supplied directly (chart-space runs).
 * The chart object must have {pillars, tenGods, elements, branchRelations} —
 * i.e. the shape returned by bazi.chart().
 */
async function generateFromChart(chartObj, opts = {}) {
  return generateWithFacts(factsFromChartParts(chartObj), opts);
}

async function generateWithFacts(facts, opts = {}) {
  const model = opts.model || client.MODELS.generator;
  const res = await client.chat({
    model,
    messages: [{ role: 'user', content: buildPrompt(facts) }],
    timeoutMs: opts.timeoutMs || 120000,
    keys: opts.keys || [],
  });

  if (!res.ok) {
    return { ok: false, facts, model, error: res.error, detail: res.detail, triedKeys: res.triedKeys };
  }
  if (!res.content) {
    return { ok: false, facts, model, error: 'empty-content', detail: 'model returned no content', latencyMs: res.latencyMs };
  }
  return {
    ok: true,
    reading: res.content,
    facts,
    model,
    latencyMs: res.latencyMs,
    keySource: res.keySource,
  };
}

module.exports = { generate, generateFromChart, generateWithFacts, factsFor, factsFromChartParts, buildPrompt };

if (require.main === module) {
  const [dateStr, timeStr] = (process.argv[2] || '1980-03-15 09:20').split(' ');
  (async () => {
    const r = await generate(dateStr, timeStr);
    if (!r.ok) {
      console.log('FAILED: ' + r.error + ' ' + (r.detail || ''));
      process.exit(1);
    }
    console.log('model=' + r.model + ' key=' + r.keySource + ' latency=' + r.latencyMs + 'ms');
    console.log('--- READING ---');
    console.log(r.reading);
  })();
}
