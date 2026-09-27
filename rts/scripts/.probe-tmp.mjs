import puppeteer from 'puppeteer-core';
const RTS_URL = process.env.RTS_URL ?? 'http://localhost:5174/';
const CHROME_PATH = process.env.CHROME_PATH ?? 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: 'new', protocolTimeout: 9e5, args: ['--no-sandbox', '--disable-gpu-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(`${RTS_URL}?seed=4242&x=-17&z=-267`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__rts?.phase === 'world' && window.__rts?.shadowBridge, { timeout: 240000, polling: 500 });
await page.evaluate(() => {
  const w = window.__rts;
  w.swarm.ledger.total = 400; w.swarm.ledger.releaseCap = 400;
  w.__elite = w.mobDefs.findIndex((m) => m.id === 'laojie');
  w.swarm.spawn({ mobIndex: w.__elite, x: -70, y: 2, z: -267, hp: 500, maxHp: 500, defense: 4, attackPower: 0,
    speed: 2, meleeDamage: 10, meleeRange: 1.2, scale: 2, tier: 0, aggro: 10, wanderSpeed: 1 });
  window.__setSpeed(10);
  w.__s = [];
  const sample = () => {
    const tab = w.swarm.squads, sb = w.shadowBridge, p = w.swarm.pool;
    let car = '-', x = 0, z = 0, uid = 0;
    for (let i = 0; i < p.count; i++) if (p.mobIndex[i] === w.__elite) { car = 'L2'; uid = p.swarmUid[i]; x = p.x[i]; z = p.z[i]; }
    if (car === '-') for (const e of w.enemies) { const sq = tab.squadOf(e.swarmUid); if (sq && sq.mobKind === w.__elite && e.lifeState === 'active') { car = 'L3'; uid = e.swarmUid; x = e.position.x; z = e.position.z; } }
    if (car !== '-') { const sq = tab.squadOf(uid), st = sq ? sb.writer.store.get(sq.id) : null; w.__s.push({ x, z, car, ord: st ? `${st.order.kind}${st.order.mission ? '/' + st.order.mission : ''}->${st.order.target.x.toFixed(0)},${st.order.target.z.toFixed(0)}` : '-' }); }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
});
await new Promise((r) => setTimeout(r, 45000));
console.log(await page.evaluate(() => {
  const arr = window.__rts.__s;
  const W = 300; let best = { start: 0, flips: 0 };
  for (let s = 0; s + W < arr.length; s += 60) {
    let flips = 0, vx = 0, vz = 0;
    for (let i = s + 1; i < s + W; i++) {
      const mx = arr[i].x - arr[i - 1].x, mz = arr[i].z - arr[i - 1].z;
      if (Math.hypot(mx, mz) < 0.01) continue;
      if ((vx || vz) && mx * vx + mz * vz < 0) flips++;
      vx = mx; vz = mz;
    }
    if (flips > best.flips) best = { start: s, flips };
  }
  return { best, lines: arr.slice(best.start, best.start + 16).map((s) => `${s.car} @(${s.x.toFixed(1)},${s.z.toFixed(1)}) ${s.ord}`) };
}));
