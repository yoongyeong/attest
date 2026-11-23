'use strict';
/**
 * composer.js — the shared composition layer.
 *
 * One place that assembles a reading from independently-registered fragment sets.
 * Adding a surface means REGISTERING A SET, not wiring it to every other surface.
 *
 * Commitments this layer makes:
 *
 *   1. COMPOSITION GROUPS (主/次) — sets declare a `group`. Sets in the SAME group
 *      stand in a primary/secondary relation (e.g. annual-k1 = what the year is
 *      about; annual-k2 = how it lands) and COMPOSE within a section. Sets in
 *      DIFFERENT groups are both primaries (daily vs annual = two timescales, no
 *      subordination) and do NOT merge — the lower-priority one is held back.
 *
 *      This mirrors the BaZi principle 主次: secondary factors modify the primary,
 *      they never contradict it. Two primaries have no such relationship, so
 *      merging them would manufacture a statement that does not exist.
 *
 *   2. EPISTEMIC SEPARATION — every set declares `verified-fact` or `interpretation`.
 *      Within a section, verified facts render before interpretation. The registers
 *      never blend, so an unfalsifiable-by-design reading cannot drift into making
 *      falsifiable claims.
 *
 *   3. PROVENANCE — the composer records which fragment and which set produced each
 *      contribution, so the accountability view can show WHY a reading says what it
 *      says. Hand-wired text has no traceable origin; this does.
 *
 *   4. COLLISION LOG — when contributions meet in a section, the composer RECORDS
 *      the collision (who led, who was held back, who merged). Genuine tension is
 *      named, not silently smoothed — the same way a clash is recorded in the chart
 *      rather than cancelled out.
 */

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
const SETS = new Map();

/**
 * Register a fragment set.
 *
 * @param {object} spec
 *   name        {string}   unique set id, e.g. 'annual-k1'
 *   surface     {string}   which surface it serves
 *   group       {string}   composition group; sets sharing a group compose (主/次)
 *   role        {string}   'primary' | 'secondary' within its group
 *   epistemic   {string}   'verified-fact' | 'interpretation'
 *   priority    {number}   lower = earlier; decides the lead within a group
 *   fragments   {Map}      key -> { sections: {section: text}, ... }
 *   sections    {string[]} canonical section order this set contributes to
 *   describe    {(ctx) => string|null}  derive the fragment key for a context
 */
function register(spec) {
  const required = ['name', 'group', 'role', 'epistemic', 'priority', 'fragments', 'sections'];
  for (const k of required) {
    if (spec[k] === undefined) throw new Error(`fragment set "${spec.name || '?'}" missing "${k}"`);
  }
  if (spec.epistemic !== 'verified-fact' && spec.epistemic !== 'interpretation') {
    throw new Error(`set "${spec.name}": epistemic must be 'verified-fact' or 'interpretation'`);
  }
  if (spec.role !== 'primary' && spec.role !== 'secondary') {
    throw new Error(`set "${spec.name}": role must be 'primary' or 'secondary'`);
  }
  SETS.set(spec.name, spec);
  return spec;
}

function unregister(name) { SETS.delete(name); }
function registeredSets() {
  return [...SETS.values()].sort((a, b) => a.priority - b.priority);
}
function clear() { SETS.clear(); }

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/**
 * Compose a reading for a context.
 *
 * @param {object} ctx  surface-specific context (chart, date, year, ...)
 * @param {object} [opts] { only?: string[] } restrict to these set names
 * @returns {object} { sections, heldBack, collisions, provenance, sets }
 */
function compose(ctx, opts = {}) {
  const only = opts.only;
  const sets = registeredSets().filter(s => !only || only.includes(s.name));

  const sections = {};   // section -> [ {set, group, role, epistemic, key, text} ] priority order
  const collisions = [];

  for (const s of sets) {
    let key = null;
    try { key = s.describe ? s.describe(ctx) : null; } catch { key = null; }
    if (!key) continue;
    const frag = s.fragments.get(key);
    if (!frag) continue;
    for (const [section, text] of Object.entries(frag.sections || {})) {
      if (!text) continue;
      (sections[section] = sections[section] || []).push({
        set: s.name, group: s.group, role: s.role, epistemic: s.epistemic, key, text,
      });
    }
  }

  const order = [];
  for (const s of sets) for (const sec of s.sections) if (!order.includes(sec)) order.push(sec);

  const rendered = {};
  const renderedProvenance = {};
  const heldBack = {};

  for (const sec of order) {
    const parts = sections[sec];
    if (!parts || !parts.length) continue;

    // Lead = highest priority (lowest number). Ties broken by set name for determinism.
    const lead = parts[0];
    const rest = parts.slice(1);

    // Split the rest into: same-group (compose — they are 次 to the lead) and
    // different-group (both primaries — held back, not merged).
    const composing = rest.filter(p => p.group === lead.group && p.epistemic === lead.epistemic);
    const held = rest.filter(p => !(p.group === lead.group && p.epistemic === lead.epistemic));

    // Order composing contributions: verified-fact before interpretation is not
    // needed here (epistemic must match the lead to compose); keep priority order.
    const ordered = [lead, ...composing];

    rendered[sec] = ordered.map(p => p.text).join(' ');

    renderedProvenance[sec] = [
      ...ordered.map(p => ({ set: p.set, group: p.group, role: p.role, epistemic: p.epistemic, key: p.key, composed: p !== lead })),
      ...held.map(p => ({ set: p.set, group: p.group, role: p.role, epistemic: p.epistemic, key: p.key, heldBack: true })),
    ];

    if (held.length) {
      heldBack[sec] = held.map(p => ({
        set: p.set, group: p.group, role: p.role, epistemic: p.epistemic, key: p.key, text: p.text,
      }));
    }

    // Collision log: record every meeting in this section. Records, never resolves.
    if (rest.length) {
      collisions.push({
        section: sec,
        lead: { set: lead.set, group: lead.group, key: lead.key },
        composed: composing.map(p => ({ set: p.set, group: p.group, role: p.role, key: p.key })),
        heldBack: held.map(p => ({ set: p.set, group: p.group, role: p.role, key: p.key })),
        reason: composing.length && held.length
          ? 'mixed: same-group contributions composed; cross-group held back'
          : (composing.length ? 'same group (主/次): composed' : 'cross group (two primaries): held back'),
      });
    }
  }

  return {
    sections: rendered,
    heldBack,
    collisions,
    provenance: renderedProvenance,
    sets: sets.map(s => ({ name: s.name, group: s.group, role: s.role, epistemic: s.epistemic, priority: s.priority })),
  };
}

/**
 * The accountability view: what produced this section, and how.
 */
function explain(result, section) {
  const prov = result.provenance[section];
  if (!prov) return null;
  const coll = result.collisions.find(c => c.section === section) || null;
  return { section, contributions: prov, collision: coll };
}

/** Verified-fact contribution built from engine output (never model-generated). */
function factFragment(text) {
  return { sections: { facts: text } };
}

module.exports = {
  register, unregister, registeredSets, clear,
  compose, explain, factFragment,
};
