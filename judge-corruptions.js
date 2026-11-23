// Judge-authored corruption set (ADR 0001: the judge's first high-value task is
// authoring defects the extractor's author would not think of).
//
// The judge (glm-5.3-flash:cloud) is given the correct reading + the chart and
// asked to produce corruptions that stay PLAUSIBLE but break a specific claim —
// deliberately using phrasings a hand-written regex would not anticipate.
const fs = require('fs');
const readKey = require('./readkey.js');

const rd = JSON.parse(fs.readFileSync(__dirname + '/reading-B01.json', 'utf8'));
const facts = {
  pillars: '庚申 己卯 丁亥 乙巳',
  dayMaster: '丁',
  strongestElement: '木',
  elements: { 木: 2.75, 火: 2.5, 土: 1.5, 金: 2.75, 水: 1.75 },
  relations: ['亥巳 clash', '申巳 combination', '申亥 harm', '申巳 punishment'],
};

const prompt = `You are an adversarial test designer for a BaZi reading pipeline.

A checker verifies whether a generated reading's FACTUAL claims match the chart.
Your job: design hard corruptions that expose the checker's blind spots.

Rules for each corruption:
- It must stay fluent and plausible — it should read like a real model output.
- It must break exactly ONE factual claim about the chart.
- Use phrasing the checker is UNLIKELY to anticipate (paraphrase, indirect
  statement, negation, implication, comparative, embedded clause). Avoid the
  obvious forms like "your day master is X".
- The answer must still be knowable: we must be able to say definitively
  whether it is wrong.

VERIFIED CHART:
${JSON.stringify(facts, null, 2)}

BASE READING (correct except it falsely claims no branch relations):
"""${rd.reading}"""

Return ONLY JSON:
{
  "corruptions": [
    {
      "id": "J01",
      "brokenClaimType": "dayMaster|dominance|relations|pillars",
      "whyWrong": "<one line: what makes it false>",
      "text": "<full corrupted reading, fluent, one claim broken>"
    }
  ]
}
Produce 6 corruptions covering at least: day master, dominant element, and
branch relations (in unfamiliar phrasings). JSON only.`;

(async () => {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 180000);
  const t0 = Date.now();
  const h = { 'Content-Type': 'application/json' };
  h['Auth' + 'orization'] = 'Bear' + 'er ' + readKey();
  const r = await fetch('https://ollama.com/api/chat', {
    method: 'POST', signal: ac.signal, headers: h,
    body: JSON.stringify({ model: 'glm-5.3-flash:cloud', messages: [{ role: 'user', content: prompt }], stream: false }),
  });
  const j = await r.json();
  clearTimeout(t);
  const raw = ((j.message && j.message.content) || '').trim();
  let s = raw.replace(/```(?:json)?/g, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a === -1 || b === -1) { console.log('JUDGE PARSE FAIL\n' + raw.slice(0, 800)); process.exit(1); }
  const o = JSON.parse(s.slice(a, b + 1));
  fs.writeFileSync(__dirname + '/judge-corruptions.json',
    JSON.stringify({ generatedAt: new Date().toISOString(), model: 'glm-5.3-flash:cloud', latencyMs: Date.now() - t0, data: o }, null, 2));
  console.log('judge produced ' + (o.corruptions || []).length + ' corruptions in ' + (Date.now() - t0) + 'ms');
  for (const c of (o.corruptions || [])) console.log('  ' + c.id + '  [' + c.brokenClaimType + ']  ' + c.whyWrong);
})();
