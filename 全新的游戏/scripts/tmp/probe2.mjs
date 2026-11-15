// 临时探针 2：区分「CPU 更新 / 渲染提交 / GPU 等待」，并按真实分辨率+DPR 复现
// 用法：node scripts/tmp/probe2.mjs
import puppeteer from 'puppeteer-core';

const URL = process.env.PROBE_URL || 'http://localhost:5173/?perf=1&wipe=1&seed=1679464028';
const CHROME = process.env.CHROME_PATH
  || 'C:\\Users\\22641\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const W = Number(process.env.PROBE_W || 1920);
const H = Number(process.env.PROBE_H || 1080);
const DPR = Number(process.env.PROBE_DPR || 1.5);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  protocolTimeout: 600000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: DPR },
  args: [
    `--window-size=${W},${H + 40}`,
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});
const page = await browser.newPage();
page.on('console', (m) => {
  const t = m.text();
  if (/\[spike\]/.test(t)) console.log('[page]', t);
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.__ppEnterWorld === 'function', { timeout: 120000, polling: 200 });
await new Promise((r) => setTimeout(r, 4000));
await page.evaluate(() => window.__ppEnterWorld());
await page.waitForFunction(() => window.__ppWp && window.__ppWp.chunks > 0, { timeout: 90000, polling: 500 });
await new Promise((r) => setTimeout(r, 2000));
console.log('finishDock ->', await page.evaluate(() => {
  try { window.__ppMode().finishDock(); return window.__ppMode().phase; } catch (e) { return `throw:${String(e)}`; }
}));
// 等世界彻底静下来（区块管线连续 2s 空闲）再开始，避免装配噪声混进运动差异
await page.waitForFunction(() => {
  const cu = window.__ppCu;
  if (!cu) return false;
  const t = performance.now();
  if (cu.total < 0.35) {
    window.__quietSince = window.__quietSince || t;
    return t - window.__quietSince > 2500;
  }
  window.__quietSince = 0;
  return false;
}, { timeout: 180000, polling: 300 }).catch(() => console.log('（静默等待超时，直接开测）'));
console.log('世界已静默，开始采样');

await page.evaluate(() => {
  const S = { on: true, rows: [], phase: -1, last: performance.now(), t0: performance.now() };
  window.__wps = S;
  const m = window.__ppMode();
  const renderer = m.renderer;
  const gl = renderer.getContext();
  // 包裹 render：量「渲染提交」CPU 时间 + 读本帧绘制统计
  const origRender = m.render.bind(m);
  window.__rt = { submit: 0, calls: 0, tris: 0 };
  m.render = function () {
    const t = performance.now();
    origRender();
    const rt = window.__rt;
    rt.submit = performance.now() - t;
    rt.calls = renderer.info.render.calls;
    rt.tris = renderer.info.render.triangles;
  };
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
    const rt = window.__rt;
    // GPU 等待：在帧首 finish 一次 → 等的是上一帧未完成的 GPU 工作
    const g0 = performance.now();
    let gpu = 0;
    try { gl.finish(); } catch { /* ignore */ }
    gpu = performance.now() - g0;
    const pp = m.player && m.player.position;
    S.rows.push({
      ph: S.phase,
      dt: +dt.toFixed(2),
      submit: +rt.submit.toFixed(2),
      gpu: +gpu.toFixed(2),
      calls: rt.calls,
      tris: rt.tris,
      px: pp ? +pp.x.toFixed(2) : 0,
      pz: pp ? +pp.z.toFixed(2) : 0,
      wp: num(window.__ppWp),
      cu: num(window.__ppCu),
    });
    if (now - S.t0 > 180000) { S.on = false; return; }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});

const setPhase = (i) => page.evaluate((n) => { window.__wps.phase = n; }, i);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 高频鼠标（模拟 1000Hz 游戏鼠标；真机指针锁定下就是这种事件密度）
const startLook = (hz, px) => page.evaluate(({ hz, px }) => {
  window.__lookTimer = setInterval(() => {
    window.dispatchEvent(new MouseEvent('mousemove', { movementX: px, movementY: 0, bubbles: true }));
  }, Math.round(1000 / hz));
}, { hz, px });
const stopLook = () => page.evaluate(() => { clearInterval(window.__lookTimer); window.__lookTimer = null; });

await page.bringToFront();
await page.evaluate(() => { const c = document.querySelector('canvas'); if (c) { c.focus(); c.click(); } });
await sleep(1500);

await setPhase(1); await sleep(4000);                  // 站立
await setPhase(2);                                     // 走动
await page.keyboard.down('KeyW'); await sleep(6000); await page.keyboard.up('KeyW');
await setPhase(3); await sleep(3000);                  // 站立
await setPhase(4); await startLook(1000, 0.08); await sleep(5000); await stopLook();   // 轻转视角
await setPhase(5);                                     // 走动 + 转视角
await page.keyboard.down('KeyW'); await startLook(1000, 0.08); await sleep(6000);
await stopLook(); await page.keyboard.up('KeyW');
await setPhase(6); await sleep(3000);                  // 站立

const data = await page.evaluate(() => { window.__wps.on = false; return window.__wps.rows; });
await browser.close();

const NAME = { 1: '站立A', 2: '走动', 3: '站立B', 4: '轻转视角', 5: '走动+转', 6: '站立C' };
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))] || 0;
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
console.log(`\n注意：DPR=${DPR} 像素比=${Math.min(DPR, 1.5)}  视口 ${W}x${H}`);
for (const ph of [1, 2, 3, 4, 5, 6]) {
  const rows = data.filter((r) => r.ph === ph);
  if (rows.length < 10) continue;
  const dt = rows.map((r) => r.dt).sort((a, b) => a - b);
  const up = rows.map((r) => r.wp.total || 0);
  const sub = rows.map((r) => r.submit);
  const gpu = rows.map((r) => r.gpu);
  const a0 = rows[0], a1 = rows[rows.length - 1];
  console.log(`\n===== [${ph}] ${NAME[ph]}  ${rows.length} 帧 =====`);
  console.log(`fps ${(1000 / avg(dt)).toFixed(1)} | dt p50 ${pct(dt, 0.5).toFixed(1)} p95 ${pct(dt, 0.95).toFixed(1)} p99 ${pct(dt, 0.99).toFixed(1)} max ${dt[dt.length - 1].toFixed(1)} | >20ms ${(rows.filter((r) => r.dt > 20).length / rows.length * 100).toFixed(1)}%`);
  console.log(`更新 ${avg(up).toFixed(2)} (p95 ${pct([...up].sort((a, b) => a - b), 0.95).toFixed(2)})`
    + ` | 提交 ${avg(sub).toFixed(2)} (p95 ${pct([...sub].sort((a, b) => a - b), 0.95).toFixed(2)})`
    + ` | GPU等待 ${avg(gpu).toFixed(2)} (p95 ${pct([...gpu].sort((a, b) => a - b), 0.95).toFixed(2)})`);
  console.log(`绘制 ${Math.round(avg(rows.map((r) => r.calls)))} 调用 | 三角 ${Math.round(avg(rows.map((r) => r.tris)))}`);
  console.log(`位移 ${Math.hypot(a1.px - a0.px, a1.pz - a0.pz).toFixed(1)}m | 区块 head ${avg(rows.map((r) => r.cu.head || 0)).toFixed(2)} waterRebuild ${avg(rows.map((r) => r.cu.waterRebuild || 0)).toFixed(2)} ground ${avg(rows.map((r) => r.cu.ground || 0)).toFixed(2)} drain ${avg(rows.map((r) => r.cu.drain || 0)).toFixed(2)}`);
  const worst = [...rows].sort((a, b) => b.dt - a.dt).slice(0, 6);
  for (const w of worst) {
    console.log(`  dt=${w.dt} upd=${(w.wp.total || 0).toFixed(1)} sub=${w.submit} gpu=${w.gpu} calls=${w.calls} tris=${w.tris}`);
  }
}
