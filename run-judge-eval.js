// Run the judge-authored corruptions through the extractor + CODE verdict,
// then reconcile the JUDGE'S OWN LABELS against what the verdict actually found.
// Disagreement is a finding, not an error to smooth over.
const fs = require('fs');
const { checkReading } = require('./extractor.js');

const rd = JSON.parse(fs.readFileSync(__dirname + '/reading-B01.json', 'utf8'));
const j = JSON.parse(fs.readFileSync(__dirname + '/judge-corruptions.json', 'utf8'));

(async () => {
  const rows = [];
  for (const c of j.data.corruptions) {
    const res = await checkReading(c.text, rd.dateStr, rd.timeStr, { enabled: true });
    const flagged = [...new Set(res.failures.map(f => f.type))];
    const saysBroken = c.brokenClaimType;
    const caught = res.failures.length > 0;
    const typeMatch = flagged.includes(saysBroken);
    rows.push({
      id: c.id, judgeSays: saysBroken, verdict: res.verdict,
      flagged, caught, typeMatch, latencyMs: res.latencyMs,
      whyWrong: c.whyWrong,
      extractorError: res.extractorError, parseError: res.parseError,
    });
    const mark = caught ? (typeMatch ? 'CAUGHT' : 'CAUGHT*') : 'MISSED';
    console.log(`${mark.padEnd(8)} ${c.id}  judge-says=${saysBroken.padEnd(11)} verdict=${String(res.verdict).padEnd(14)} flagged=[${flagged.join(',')}]`);
    if (!caught) console.log(`         text: ${c.text.slice(0, 150).replace(/\n/g,' ')}`);
  }

  const caught = rows.filter(r => r.caught).length;
  const typeMatched = rows.filter(r => r.typeMatch).length;
  const summary = {
    ts: new Date().toISOString(),
    source: 'judge-authored (glm-5.3-flash:cloud)',
    total: rows.length, caught,
    recallPct: +(caught / rows.length * 100).toFixed(1),
    flaggedRightType: typeMatched,
    typeMatchPct: +(typeMatched / rows.length * 100).toFixed(1),
    rows,
  };
  fs.writeFileSync(__dirname + '/eval-judge-results.json', JSON.stringify(summary, null, 2));
  console.log('\n--- JUDGE-AUTHORED SET ---');
  console.log('caught something      : ' + caught + '/' + rows.length + ' (' + summary.recallPct + '%)');
  console.log('caught the RIGHT type : ' + typeMatched + '/' + rows.length + ' (' + summary.typeMatchPct + '%)');
})();
