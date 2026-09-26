import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
const pg = await b.newPage();
await pg.goto('http://localhost:5174/?seed=4242&x=60&z=-40', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction(() => window.__rts && window.__rts.phase === 'world' && window.__rts.swarm, { timeout: 240000, polling: 500 });
await new Promise((r) => setTimeout(r, 80000));
for (let k = 0; k < 18; k++) {
  const s = await pg.evaluate(() => {
    const w = window.__rts, sw = w.swarm;
    const out = [];
    for (const sq of sw.squads.all()) {
      const lead = sq.members.get(sq.leaderUid);
      if (!lead) continue;
      const o = w.shadowBridge.writer.store.get(sq.id);
      if (!o || o.order.mission !== 'patrol') continue;
      const d = Math.hypot(o.order.target.x - lead.x, o.order.target.z - lead.z);
      out.push(`#${sq.id}:${d.toFixed(0)}m`);
    }
    return out.join(' ') || '(none)';
  });
  console.log(`t+${k * 2}s ${s}`);
  await new Promise((r) => setTimeout(r, 2000));
}
await b.close();
