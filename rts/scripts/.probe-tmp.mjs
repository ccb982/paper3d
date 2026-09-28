import puppeteer from 'puppeteer-core';
const RTS_URL = process.env.RTS_URL ?? 'http://localhost:5174/';
const CHROME_PATH = process.env.CHROME_PATH ?? 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: 'new', protocolTimeout: 9e5, args: ['--no-sandbox', '--disable-gpu-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(`${RTS_URL}?seed=4242&x=132&z=-198`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__rts?.phase === 'world' && window.__rts?.shadowBridge, { timeout: 240000, polling: 500 });
await page.evaluate(() => {
  const w = window.__rts;
  window.__setSpeed(5);
  const sb = w.shadowBridge;
  w.__by = {}; w.__rows = [];
  // 跟踪每队近 4s 位移
  const A = new Map();
  const track = () => {
    const now = performance.now() / 1000;
    for (const sq of w.swarm.squads.all()) {
      const lead = sq.members.get(sq.leaderUid);
      if (!lead) continue;
      const a = A.get(sq.id) ?? (A.set(sq.id, { x: lead.x, z: lead.z, pth: 0, t: now }), A.get(sq.id));
      a.pth += Math.hypot(lead.x - a.x, lead.z - a.z); a.x = lead.x; a.z = lead.z;
      if (now - a.t > 4) { a.moved = a.pth; a.pth = 0; a.t = now; }
    }
    setTimeout(track, 300);
  };
  track();
  const og = w.goneLog.push.bind(w.goneLog);
  w.goneLog.push = (r) => {
    if (r.reason === 'stuck') {
      const d = Math.min(Math.hypot(r.x - w.hooks.shipX, r.z - w.hooks.shipZ), Math.hypot(r.x - w.hooks.playerX, r.z - w.hooks.playerZ));
      if (d > 120) {
        const o = sb.writer.store.get(r.squadId)?.order;
        if (o && o.kind === 'act' && !o.mission) {
          const tgt = o.target;
          const dT = tgt ? Math.hypot(tgt.x - r.x, tgt.z - r.z) : -1;
          const dTShip = tgt ? Math.hypot(tgt.x - w.hooks.shipX, tgt.z - w.hooks.shipZ) : -1;
          const plan = sb.plan.get(r.squadId);
          const a = A.get(r.squadId);
          const moved = a?.moved ?? -1;
          const key = `源=${o.source} 守点(距令target${dT <= 8 ? '≤8m' : '>8m'}) 计划=${plan ? plan.mode : 'none'} 动=${moved > 1 ? '动' : '静'}`;
          w.__by[key] = (w.__by[key] || 0) + 1;
          if (w.__rows.length < 10) w.__rows.push(`${r.carrier} 令target=${tgt ? `${tgt.x | 0},${tgt.z | 0}` : '-'} 距tgt=${dT.toFixed(0)}m tgt距舰=${dTShip.toFixed(0)}m 4s位移=${moved.toFixed(1)}m ${key}`);
        }
      }
    }
    og(r);
  };
});
await new Promise((r) => setTimeout(r, 90000));
console.log(await page.evaluate(() => {
  return `${Object.entries(window.__rts.__by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join('\n')}\n--- 样本 ---\n${window.__rts.__rows.join('\n')}`;
}));
await browser.close();
