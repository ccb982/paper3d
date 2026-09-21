// ★ 破坏掩码对账：mask.depthAt vs RasterMap.levelDepthAt 逐格一致 + 坑洞表打分门槛
// 前置：npm run dev（vite 5173）
// 运行：node scripts/tmp/l1-trench-grid.mjs
import puppeteer from 'puppeteer-core';
const SEED = 4242;
const grid = (r, c) => Array.from({ length: r }, () => Array(c).fill(null));
const makeSession = (seed) => ({
  meta: { version: '0.2.0', day: 1, seed, totalDaysSurvived: 0, deaths: 0, createdAt: '', lastSavedAt: '' },
  player: { hp: 100, maxHp: 100, attackPower: 10, defense: 2, ammo: { default: 150 }, slots: Array(12).fill(null) },
  inventories: { base: grid(30, 30), ship: grid(8, 10), player: grid(4, 6) },
  ship: { hp: 1e6, maxHp: 1e6, shield: 2e5, armor: 999, fuel: 60, fuelMax: 60, position: { x: 30, z: 30 }, techTree: [], turrets: [] },
  gacha: { pityCounter: 0, totalPulls: 0, bossPity: 0 },
  dayProgress: { hasDepartedToday: false }, outOfRun: { owned: {} }, story: { flags: {}, events: {} },
});
const browser = await puppeteer.launch({
  executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe',
  headless: 'new', args: ['--no-sandbox', '--disable-gpu-sandbox'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.evaluateOnNewDocument((s) => localStorage.setItem('arknights_rogue_save', JSON.stringify(s)), makeSession(SEED));
await page.goto(`http://localhost:5173/?perf=1&l1dbg=1&seed=${SEED}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('!!window.__ppEnterWorld', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2000));
await page.evaluate(() => window.__ppEnterWorld());
await new Promise((r) => setTimeout(r, 4000));
await page.evaluate(() => window.__ppMode().finishDock());
await page.waitForFunction('!!window.__l1 && !!window.__holeMask && !!window.__holeTable', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 1200));
const run = (fn, ...a) => page.evaluate(fn, ...a);

const stats1 = await run(() => {
  const l = window.__l1, t = window.__holeTable;
  return { l1Regions: l.stats().regionCount, holes0: t.holes.length };
});
console.log('① 初始 →', JSON.stringify(stats1));

// 大坑：40×40，两轮 → 覆盖几十个 4m 格中心
await run((x, z) => { const m = window.__ppMode(); for (let k = 0; k < 2; k++) m.chunks.digRect(x, z, 20, 20); return true; },
  (await run(() => window.__l1.anchor.x)) + 10, (await run(() => window.__l1.anchor.z)) - 20);
await new Promise((r) => setTimeout(r, 2600));   // 等 1 拍掩码全表重扫 + 2Hz 表重排

const chk = await run(() => {
  const m = window.__holeMask, t = window.__holeTable, a = window.__l1.anchor, r = window.__ppMode().raster;
  const R = 144, CELL = 4, sx = a.x - R, sz = a.z - R;
  const cx = a.x + 10, cz = a.z - 20;
  const x0 = Math.floor((cx - 16 - sx) / CELL), z0 = Math.floor((cz - 16 - sz) / CELL);
  const x1 = Math.ceil((cx + 16 - sx) / CELL), z1 = Math.ceil((cz + 16 - sz) / CELL);
  let total = 0, both = 0, depthOnly = 0, maskOnly = 0, none = 0, shallowHot = 0;
  for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
    const wx = sx + ix * CELL + CELL / 2, wz = sz + iz * CELL + CELL / 2;
    const depth = Math.max(0, r.levelDepthAt(wx, wz));
    const md = m.depthAt(wx, wz);
    total++;
    if (depth >= 0.15 && md >= 0.15) both++;
    else if (depth >= 0.15 && md < 0.15) depthOnly++;
    else if (depth < 0.15 && md >= 0.15) maskOnly++;
    else none++;
    // 打分门槛：浅坑（0.15~0.3）虽然算"破坏格"，但不应有坑洞分
    if (md >= 0.15 && md < 0.3 && t.scoreAt(wx, wz) > 0) shallowHot++;
  }
  const badHole = t.holes.filter((h) => h.maxDepth < 0.3 || h.score <= 0 || h.score > 1).length;
  return { total, both, depthOnly, maskOnly, none, shallowHot, badHole, holes: t.holes.length };
});
console.log('② 40×40 双轮后（±16m 窗内逐格对账）→', JSON.stringify(chk));
console.log('   depthOnly=0 且 maskOnly=0 → 掩码与 levelDepth 逐格一致');
console.log('   shallowHot=0 → 浅坑无分；badHole=0 → 条目全满足（深≥0.3 且 0<分≤1）');
await browser.close();
