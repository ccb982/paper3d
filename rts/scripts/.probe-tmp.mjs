import puppeteer from 'puppeteer-core';
const RTS_URL = process.env.RTS_URL ?? 'http://localhost:5174/';
const CHROME_PATH = process.env.CHROME_PATH ?? 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: 'new', protocolTimeout: 9e5, args: ['--no-sandbox', '--disable-gpu-sandbox'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 110)));
await page.setViewport({ width: 1280, height: 720 });
await page.goto(`${RTS_URL}?seed=4242&x=132&z=-198`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__rts?.phase === 'world' && window.__rts?.shadowBridge, { timeout: 240000, polling: 500 });
await page.evaluate(() => {
  const w = window.__rts;
  window.__setSpeed(5);
  const sb = w.shadowBridge;
  w.__gone = {}; w.__agg = { stuck: 0, noOrder: 0, poolRanged: 0, poolRangedPermit: 0, poolRangedInOwn: 0, rangedSquad: 0, noPlan: 0 };
  w.__s = [];
  const og = w.goneLog.push.bind(w.goneLog);
  w.goneLog.push = (r) => {
    const k = r.reason ?? (r.killed ? 'killed' : 'other:');
    w.__gone[k] = (w.__gone[k] || 0) + 1;
    if (r.reason !== 'stuck') { og(r); return; }
    w.__agg.stuck++;
    const cur = sb.writer.store.get(r.squadId);
    if (!cur) w.__agg.noOrder++;
    if (!sb.plan.get(r.squadId)) w.__agg.noPlan++;
    const sq = w.swarm.squads.get(r.squadId);
    if (sq && sq.type === 'ranged') w.__agg.rangedSquad++;
    const p = w.swarm.pool;
    for (let i = 0; i < p.count; i++) {
      if (p.swarmUid[i] !== r.uid) continue;
      if (p.ranged[i] === 1) {
        w.__agg.poolRanged++;
        const d = Math.min(Math.hypot(r.x - w.hooks.playerX, r.z - w.hooks.playerZ), Math.hypot(r.x - w.hooks.shipX, r.z - w.hooks.shipZ));
        if (d <= p.meleeRange[i] + 4) w.__agg.poolRangedInOwn++;
        if (sb.timers.canFire(r.uid)) w.__agg.poolRangedPermit++;
      }
      break;
    }
    og(r);
  };
  setInterval(() => {
    try { const l = w.swarm.ledger; w.__s.push({ t: +(w.simT ?? 0).toFixed(0), sp: l.spawned, al: l.alive, rc: l.recalled }); } catch { /* */ }
  }, 1000);
});
await new Promise((r) => setTimeout(r, 100000));
console.log(await page.evaluate(() => {
  const w = window.__rts;
  const s = w.__s.filter((_, i) => i % 20 === 0).map((x) => `${x.t}s 生成=${x.sp} 存活=${x.al} 回收=${x.rc}`);
  const l = w.__s[w.__s.length - 1];
  const a = w.__agg;
  return `=== 时间线 ===\n${s.join('\n')}\n=== 终局 ===\n生成=${l.sp} 存活=${l.al} 回收=${l.rc} 回收率=${(l.rc / Math.max(1, l.sp) * 100).toFixed(1)}% 存活率=${(l.al / Math.max(1, l.sp) * 100).toFixed(1)}%\n离场: ${Object.entries(w.__gone).map(([k, v]) => `${k}=${v}`).join(' ')}  stuck速率=${(w.__gone.stuck / Math.max(1, l.t)).toFixed(3)}/s\nstuck 细分: 无现令=${a.noOrder} 无计划=${a.noPlan} 远程队=${a.rangedSquad}｜池远程被收=${a.poolRanged}（自身射程内=${a.poolRangedInOwn}，有许可=${a.poolRangedPermit}）`;
}));
console.log('errors=' + errs.length, errs.slice(0, 2).join(' | '));
await browser.close();
