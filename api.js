'use strict';
/**
 * api.js — the API adapter over profile().
 *
 * Implements API-CONTRACT.md v1:
 *   - normalises the TWO internal block shapes into ONE typed block shape
 *   - converts `warnings` strings into an explicit `availability` map
 *   - adds version + counts
 *
 * Stateless and pure: no storage, no sessions. Every response is a function of
 * the request.
 */

const profileMod = require('./profile.js');
const { chart } = require('./bazi.js');
const { buildReceipt } = require('./receipt.js');

const VERSION = 'v1';

const ALL_SURFACES = ['facts', 'daily', 'annual', 'cycles', 'synthesis', 'compatibility'];

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Facts blocks carry `lines`; interpretation blocks carry `sections`.
 * The contract wants one shape for every block, so both are expressed as
 * `sections` — facts as a single `chart`/`cycles` section built from the lines.
 * Nothing is lost; the provenance of each section is preserved.
 */
function normaliseBlock(block) {
  const epistemic = block.kind === 'verified-fact' ? 'verified-fact' : 'interpretation';
  let sections;

  if (block.lines) {
    // facts: one section whose value is the joined lines, one line per entry
    sections = { [block.timescale === 'decade' ? 'cycles' : 'chart']: block.lines.join('\n') };
  } else {
    sections = block.sections || {};
  }

  return {
    surface: block.surface || inferSurface(block),
    timescale: block.timescale,
    epistemic,
    title: block.title,
    sections,
    meta: block.meta || (block.lines ? { lines: block.lines.length } : {}),
    provenance: block.provenance || [],
  };
}

/** Infer which surface a block came from, when the block itself doesn't say. */
function inferSurface(block) {
  if (block.kind === 'verified-fact') {
    return block.timescale === 'decade' ? 'cycles' : 'facts';
  }
  const t = block.timescale;
  if (t === 'day') return 'daily';
  if (t === 'year') return 'annual';
  if (t === 'synthesis') return 'synthesis';
  if (t === 'pair') return 'compatibility';
  return 'unknown';
}

/**
 * Convert profile()'s `warnings` strings into the contract's availability map.
 * Each surface reports: available | unavailable (+reason) | skipped.
 */
function buildAvailability(blocks, warnings, requested) {
  const present = new Set(blocks.map(b => inferSurface(b)));
  const avail = {};

  for (const s of ALL_SURFACES) {
    if (requested && !requested.includes(s)) {
      avail[s] = { status: 'skipped', reason: 'excluded by the request' };
      continue;
    }
    if (present.has(s)) {
      avail[s] = { status: 'available' };
      continue;
    }
    // find a warning that mentions this surface, else generic
    const w = warnings.find(x => x.startsWith(s) || (s === 'cycles' && x.includes('luck cycles')));
    avail[s] = w
      ? { status: 'unavailable', reason: stripPrefix(w) }
      : { status: 'unavailable', reason: 'not produced' };
  }
  return avail;
}

function stripPrefix(w) {
  // "luck cycles skipped: gender not supplied (...)" -> "gender not supplied (...)"
  const m = w.match(/^[^:]*skipped:\s*(.*)$/);
  if (m) return m[1];
  const m2 = w.match(/^[^:]*unavailable:\s*(.*)$/);
  return m2 ? m2[1] : w;
}

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

function badRequest(detail) {
  return { status: 400, body: { error: 'invalid_request', detail } };
}

/**
 * Build an API response from a request body.
 * @param {object} body  as described in API-CONTRACT.md §3
 */
function handleProfile(body) {
  if (!body || typeof body !== 'object') return badRequest('body must be a JSON object');

  const birth = body.birth;
  if (!birth || !birth.date) return badRequest('birth.date is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth.date)) {
    return badRequest('birth.date must be YYYY-MM-DD');
  }
  if (birth.time && !/^\d{2}:\d{2}$/.test(birth.time)) {
    return badRequest('birth.time must be HH:MM');
  }

  const requested = body.surfaces;

  let subjectChart;
  try {
    subjectChart = chart(birth.date, birth.time || '12:00');
  } catch (e) {
    return badRequest('could not compute chart: ' + e.message);
  }

  let partnerChart = null;
  if (body.partner) {
    if (!body.partner.birth || !body.partner.birth.date) {
      return badRequest('partner.birth.date is required when partner is supplied');
    }
    try {
      partnerChart = chart(body.partner.birth.date, body.partner.birth.time || '12:00');
    } catch (e) {
      return badRequest('could not compute partner chart: ' + e.message);
    }
  }

  let internal;
  try {
    internal = profileMod.profile(subjectChart, {
      date: body.date,
      year: body.date ? Number(String(body.date).slice(0, 4)) : undefined,
      gender: body.gender,
      partner: partnerChart,
      surfaces: requested,
    });
  } catch (e) {
    return { status: 500, body: { error: 'internal', detail: e.message } };
  }

  if (!internal.ok) return badRequest(internal.error);

  const blocks = internal.blocks.map(normaliseBlock);
  const availability = buildAvailability(internal.blocks, internal.warnings, requested);

  const counts = {
    blocks: blocks.length,
    verifiedFact: blocks.filter(b => b.epistemic === 'verified-fact').length,
    interpretation: blocks.filter(b => b.epistemic === 'interpretation').length,
  };

  return {
    status: 200,
    body: {
      version: VERSION,
      subject: {
        dayMaster: internal.subject.dayMaster,
        pillars: internal.subject.pillars,
        birth: { date: internal.subject.birthDate, time: internal.subject.birthTime },
        date: internal.subject.date,
        year: internal.subject.year,
      },
      availability,
      blocks,
      counts,
      // The calculation receipt: how the chart was computed, and what that does
      // and does not establish. Optional — omit with receipt:false.
      receipt: body.receipt === false ? null : buildReceipt(
        birth.date, birth.time || '12:00', { gender: body.gender, year: internal.subject.year }),
    },
  };
}

function handleHealth() {
  const sets = {
    daily: safeCount('fragments.json'),
    annual: safeCount('annual-fragments.json'),
    compatibility: safeCount('compatibility-fragments.json'),
    synthesis: safeCount('synthesis-fragments.json'),
  };
  return { status: 200, body: { ok: true, version: VERSION, fragments: sets } };
}

function safeCount(file) {
  try { return require('./' + file).count; } catch { return null; }
}

module.exports = { handleProfile, handleHealth, normaliseBlock, buildAvailability, VERSION, ALL_SURFACES };

if (require.main === module) {
  const r = handleProfile({
    birth: { date: '1980-03-15', time: '09:20' },
    date: '2026-10-16',
    gender: 'male',
    partner: { birth: { date: '1992-07-22', time: '14:05' } },
  });
  console.log('status:', r.status);
  console.log('top-level keys:', Object.keys(r.body).join(', '));
  console.log('blocks:', r.body.counts);
  console.log('\navailability:');
  for (const [k, v] of Object.entries(r.body.availability)) {
    console.log(`  ${k.padEnd(14)} ${v.status}${v.reason ? ' — ' + v.reason : ''}`);
  }
  console.log('\nblock shapes (should be ONE distinct shape):');
  const shapes = new Set(r.body.blocks.map(b => Object.keys(b).sort().join('|')));
  [...shapes].forEach(s => console.log('  ' + s));
}
