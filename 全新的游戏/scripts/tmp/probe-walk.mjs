// 临时探针：站立 vs 走动 vs 转视角 的分段对比（定位「一动就一卡一卡」）
// 用法：node scripts/tmp/probe-walk.mjs
import puppeteer from 'puppeteer-core';

const URL = process.env.PROBE_URL || 'http://localhost:5173/?perf=1&wipe=1&seed=1679464028';
const CHROME = process.env.CHROME_PATH
  || 'C:\\Users\\22641\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  protocolTimeout: 600000,
  defaultViewport: { width: 1600, height: 900 },
  args: [
    '--window-size=1600,900',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});
const page = await browser.newPage();
page.on('console', (m) => {
  const t = m.text();
  if (/\[spike\]|\[chunk\]|错误|Error|Failed|失败/.test(t)) console.log(`[page]`, t);
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.__ppEnterWorld === 'function', { timeout: 120000, polling: 200 });
await new Promise((r) => setTimeout(r, 4000));
await page.evaluate(() => window.__ppEnterWorld());
await page.waitForFunction(() => window.__ppWp && window.__ppWp.chunks > 0, { timeout: 90000, polling: 500 });
// ★ 直接进入「停靠后」场景（explore：人在地面）——不走航行/降落流程
await new Promise((r) => setTimeout(r, 2000));
const phaseAfterDock = await page.evaluate(() => {
  try {
    const m = window.__ppMode();
    m.finishDock();
    return m.phase;
  } catch (e) { return `throw:${String(e)}`; }
});
console.log('finishDock ->', phaseAfterDock);
await new Promise((r) => setTimeout(r, 18000));
const phaseNow = await page.evaluate(() => {
  try { return window.__ppMode().phase; } catch { return '?'; }
});
console.log('当前阶段 =', phaseNow);

// ---- 逐帧采样器 ----
await page.evaluate(() => {
  const S = {
    on: true, rows: [], phase: -1, last: performance.now(), t0: performance.now(),
  };
  window.__wps = S;
  const num = (o) => {
    if (!o) return {};
    const out = {};
    for (const [k, v] of Object.entries(o)) if (typeof v === 'number') out[k] = v;
    return out;
  };
  const loop = () => {
    if (!S.on) return;
    const now = performance.now();
    const dt = now - S.last;
    S.last = now;
    const m = window.__ppMode && window.__ppMode();
    const r = m && m.renderer && m.renderer.info && m.renderer.info.render;
    const pp = m && m.player && m.player.position;
    S.rows.push({
      ph: S.phase,
      dt: +dt.toFixed(2),
      px: pp ? +pp.x.toFixed(2) : 0,
      pz: pp ? +pp.z.toFixed(2) : 0,
      wp: num(window.__ppWp),
      cu: num(window.__ppCu),
      ep: num(window.__ppEp),
      calls: r ? r.calls : -1,
      tris: r ? r.triangles : -1,
    });
    if (now - S.t0 > 180000) { S.on = false; return; }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});

const setPhase = (i) => page.evaluate((n) => { window.__wps.phase = n; }, i);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const startLook = (px) => page.evaluate((step) => {
  window.__lookTimer = setInterval(() => {
    window.dispatchEvent(new MouseEvent('mousemove', {
      movementX: step, movementY: 0, bubbles: true,
    }));
  }, 16);
}, px);
const stopLook = () => page.evaluate(() => { clearInterval(window.__lookTimer); window.__lookTimer = null; });

await page.bringToFront();
await page.evaluate(() => { const c = document.querySelector('canvas'); if (c) { c.focus(); c.click(); } });
await sleep(1200);   // 让可能的锁定/首帧噪声过去

// 0 热身
await setPhase(0); await sleep(3000);
// 1 站立
await setPhase(1); await sleep(5000);
// 2 走动（W）
await setPhase(2);
await page.keyboard.down('KeyW');
await sleep(7000);
await page.keyboard.up('KeyW');
// 3 站立
await setPhase(3); await sleep(4000);
// 4 轻转视角（每 16ms 1.5px）
await setPhase(4);
await startLook(1.5);
await sleep(7000);
await stopLook();
// 5 走动 + 转视角
await setPhase(5);
await page.keyboard.down('KeyW');
await startLook(1.5);
await sleep(6000);
await stopLook();
await page.keyboard.up('KeyW');
// 6 站立收尾
await setPhase(6); await sleep(4000);

const data = await page.evaluate(() => {
  window.__wps.on = false;
  return window.__wps.rows;
});
await browser.close();

const NAME = { 0: '热身', 1: '站立A', 2: '走动', 3: '站立B', 4: '转视角', 5: '走动+转', 6: '站立C' };
const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] || 0;
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
const segKeys = ['total', 'pre', 'world', 'chunks', 'ui', 'combat', 'ai', 'entity', 'post', 'phys',
  'drones', 'ent', 'water', 'clamp', 'swarmMs', 'engineMs', 'assembly'];
const cuKeys = ['head', 'waterTier', 'waterRebuild', 'patch', 'sync', 'prefetch', 'drain',
  'ground', 'decor', 'coarse', 'lod', 'sweep', 'total'];
const epKeys = ['behavior', 'phys', 'anim', 'render', 'moved', 'shadow', 'move', 'sepOther',
  'sepStatic', 'dye', 'swarmBrain', 'swarmMove', 'swarmSep', 'swarmRender'];

for (const ph of [1, 2, 3, 4, 5, 6]) {
  const rows = data.filter((r) => r.ph === ph);
  if (!rows.length) continue;
  const dt = rows.map((r) => r.dt).sort((a, b) => a - b);
  console.log(`\n===== [${ph}] ${NAME[ph]}  ${rows.length} 帧 =====`);
  console.log(`fps ${(1000 / avg(dt)).toFixed(1)} | avg ${avg(dt).toFixed(1)}ms | p50 ${pct(dt, 0.5).toFixed(1)} | p95 ${pct(dt, 0.95).toFixed(1)} | p99 ${pct(dt, 0.99).toFixed(1)} | max ${dt[dt.length - 1].toFixed(1)}`);
  console.log(`>33ms ${(rows.filter((r) => r.dt > 33).length / rows.length * 100).toFixed(1)}%  >50ms ${(rows.filter((r) => r.dt > 50).length / rows.length * 100).toFixed(1)}%`);
  const calls = rows.map((r) => r.calls);
  const tris = rows.map((r) => r.tris);
  const a0 = rows[0], a1 = rows[rows.length - 1];
  const moved = Math.hypot(a1.px - a0.px, a1.pz - a0.pz).toFixed(1);
  console.log(`位移 ${moved}m  (${a0.px},${a0.pz}) → (${a1.px},${a1.pz})`);
  console.log(`绘制 ${Math.round(avg(calls))} 调用  三角 ${Math.round(avg(tris))}`);
  const seg = {};
  for (const k of segKeys) seg[k] = +avg(rows.map((r) => r.wp[k] || 0)).toFixed(2);
  console.log('wp  ' + JSON.stringify(seg));
  const cu = {};
  for (const k of cuKeys) cu[k] = +avg(rows.map((r) => r.cu[k] || 0)).toFixed(2);
  console.log('cu  ' + JSON.stringify(cu));
  const ep = {};
  for (const k of epKeys) ep[k] = +avg(rows.map((r) => r.ep[k] || 0)).toFixed(2);
  console.log('ep  ' + JSON.stringify(ep));
  const worst = [...rows].sort((a, b) => b.dt - a.dt).slice(0, 5);
  console.log('最差 5 帧:');
  for (const w of worst) {
    console.log(`  dt=${w.dt} upd=${(w.wp.total || 0).toFixed(1)} chunks=${(w.wp.chunks || 0).toFixed(1)}`
      + ` [head=${(w.cu.head || 0).toFixed(1)} sync=${(w.cu.sync || 0).toFixed(1)} drain=${(w.cu.drain || 0).toFixed(1)}`
      + ` decor=${(w.cu.decor || 0).toFixed(1)} coarse=${(w.cu.coarse || 0).toFixed(1)} lod=${(w.cu.lod || 0).toFixed(1)}]`
      + ` calls=${w.calls} tris=${w.tris} water=${(w.wp.water || 0).toFixed(1)} clamp=${(w.wp.clamp || 0).toFixed(1)}`
      + ` post=${(w.wp.post || 0).toFixed(1)} phys=${(w.wp.phys || 0).toFixed(1)}`);
  }
}
