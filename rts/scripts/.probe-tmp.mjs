import puppeteer from 'puppeteer-core';
const RTS_URL = process.env.RTS_URL ?? 'http://localhost:5174/';
const CHROME_PATH = process.env.CHROME_PATH ?? 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: 'new', protocolTimeout: 9e5, args: ['--no-sandbox', '--disable-gpu-sandbox'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 100)));
await page.setViewport({ width: 1280, height: 720 });
await page.goto(`${RTS_URL}?seed=4242&x=-17&z=-267`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__rts?.phase === 'world' && window.__rts?.shadowBridge, { timeout: 240000, polling: 500 });
await page.evaluate(() => {
  const w = window.__rts;
  w.swarm.ledger.total = 400; w.swarm.ledger.releaseCap = 400;
  w.__elite = w.mobDefs.findIndex((m) => m.id === 'laojie');
  [[-70, -267], [-160, -120], [-200, 120]].forEach(([x, z]) => w.swarm.spawn({ mobIndex: w.__elite, x, y: 2, z,
    hp: 500, maxHp: 500, defense: 4, attackPower: 0, speed: 2, meleeDamage: 10, meleeRange: 1.2, scale: 2, tier: 0, aggro: 10, wanderSpeed: 1 }));
  window.__setSpeed(10);
  w.__tr = {};
  w.__ji = setInterval(() => {
    const p = w.swarm.pool, tab = w.swarm.squads, sb = w.shadowBridge, tac = w.tactics;
    const touch = (uid, carrier, x, z, sqId) => {
      const h = w.__tr[uid] ?? (w.__tr[uid] = { carrier, first: Date.now(), last: Date.now(), dist: 0, px: x, pz: z, sector: -99, orders: 0, lastOrder: '-', x, z });
      h.last = Date.now(); h.dist += Math.hypot(x - h.px, z - h.pz); h.px = x; h.pz = z; h.x = x; h.z = z;
      h.sector = tac ? (tac.battalions.deployPlan.get(sqId) ?? -1) : -2;
      const st = sqId >= 0 ? sb.writer.store.get(sqId) : null;
      const o = st ? `${st.order.kind}->${st.order.target.x.toFixed(0)},${st.order.target.z.toFixed(0)}` : '-';
      if (o !== h.lastOrder) { h.orders++; h.lastOrder = o; }
    };
    for (let i = 0; i < p.count; i++) { if (p.mobIndex[i] !== w.__elite) continue; const sq = tab.squadOf(p.swarmUid[i]); touch(p.swarmUid[i], 'L2', p.x[i], p.z[i], sq?.id ?? -1); }
    for (const e of w.enemies) { const sq = tab.squadOf(e.swarmUid); if (!sq || sq.mobKind !== w.__elite || e.lifeState !== 'active') continue; touch(e.swarmUid, 'L3', e.position.x, e.position.z, sq.id); }
  }, 150);
});
await new Promise((r) => setTimeout(r, 22000));
console.log(await page.evaluate(() => {
  const w = window.__rts; clearInterval(w.__ji);
  const rows = Object.entries(w.__tr).map(([uid, h]) =>
    `${h.carrier} uid${uid} 存活=${((h.last - h.first) / 1000).toFixed(1)}s 区=${h.sector} @(${h.x.toFixed(0)},${h.z.toFixed(0)}) 路程=${h.dist.toFixed(1)}m 目标变更=${h.orders}`);
  return `实例数=${rows.length} 判官回收=${w.shadowBridge.timers.dbg.expiredTotal}\n` + rows.join('\n');
}));
console.log('errors=' + errs.length);
await browser.close();
