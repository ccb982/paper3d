// ============================================================
// ★ 标准测试位（用户定）：seed=4242 ship=-17,-267 landing=131,-206 cam=31,-242
// smoke —— RTS 冒烟（严格两阶段：选点页 → 换种子 → 确认 → 世界加载）
// 用法：npm run smoke（前置：dev server；环境：RTS_URL / CHROME_PATH / SEED）
// 失败退出码 = 1
// ============================================================
import puppeteer from 'puppeteer-core';

const RTS_URL = process.env.RTS_URL ?? 'http://localhost:5175/';
const CHROME_PATH = process.env.CHROME_PATH ?? 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe';
const SEED = Number(process.env.SEED ?? 4242);

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: 'new', protocolTimeout: 3e5, args: ['--no-sandbox', '--disable-gpu-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errs = [];
page.on('pageerror', (e) => errs.push('[pageerror] ' + String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text().slice(0, 200)); });

const checks = [];
let selInfo = { phase: null, hasSelect: false, canvases: 0 };
let world = { phase: null, swarmN: null, swarmAlive: null, drawCalls: null };
try {
  await page.goto(`${RTS_URL}?seed=${SEED}&x=-17&z=-267`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__rts?.phase === 'select' && !!window.__rts?.select, { timeout: 180000, polling: 500 });
  selInfo = await page.evaluate(() => ({
    phase: window.__rts?.phase ?? null,
    hasSelect: !!window.__rts?.select,
    canvases: document.querySelectorAll('canvas').length,
  }));
  console.log('A 选点页 =', JSON.stringify(selInfo));
  await page.screenshot({ path: 'sel.png' });

  // ★ 换种子实时切换（输入框改值 → applySeed）
  await page.evaluate(() => {
    const inp = document.querySelector('input');
    if (inp) inp.value = '99';
    window.__rts.select.applySeed();
  });
  await page.waitForFunction(() => window.__rts?.raster?.worldSeed === 99, { timeout: 120000, polling: 300 });
  console.log('换图后 seed = 99 ✓');
  await page.screenshot({ path: 'sel-seed99.png' });

  await page.evaluate((s) => {
    const inp = document.querySelector('input');
    if (inp) inp.value = String(s);
    window.__rts.select.applySeed();
  }, SEED);
  await page.waitForFunction((s) => window.__rts?.raster?.worldSeed === s, { timeout: 120000, polling: 300 }, SEED);

  await page.evaluate(() => window.__rts.select.setCenter(-200, 170));
  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: 'sel2.png' });

  await page.evaluate(() => window.__rts.select.confirmAt(60, -40));
  await page.waitForFunction(() => window.__rts?.phase === 'world' && (window.__rts?.swarm?.pool?.count ?? 0) > 0, { timeout: 240000, polling: 1000 });
  await new Promise((r) => setTimeout(r, 3000));
  world = await page.evaluate(() => ({
    phase: window.__rts?.phase ?? null,
    drawCalls: window.__rts?.renderer?.info?.render?.calls ?? null,
    triangles: window.__rts?.renderer?.info?.render?.triangles ?? null,
    fine: window.__rts?.chunks?.meshes?.size ?? null,
    coarse: window.__rts?.chunks?.coarseMeshes?.size ?? null,
    vis: window.__rts?.chunks?.terrainVisuals?.size ?? null,
    swarmN: window.__rts?.swarm?.pool?.count ?? null,
    swarmAlive: (() => { const p = window.__rts?.swarm?.pool; if (!p) return null; let n = 0; for (let i = 0; i < p.count; i++) if (p.hp[i] > 0) n++; return n; })(),
    cam: window.__rts?.cam ?? null,
  }));
  console.log('B 世界 =', JSON.stringify(world));
  await page.screenshot({ path: 'world.png' });
} catch (err) {
  errs.push('[smoke] ' + String(err).slice(0, 300));
}
const pageErrs = errs.filter((e) => e.startsWith('[pageerror]'));
checks.push(
  ['选点页就绪（phase=select）', selInfo.phase === 'select' && selInfo.hasSelect && selInfo.canvases >= 1],
  ['世界加载（phase=world）', world.phase === 'world'],
  ['蜂群池 > 0', (world.swarmN ?? 0) > 0],
  ['存活代理 > 0', (world.swarmAlive ?? 0) > 0],
  ['绘制调用 > 0', (world.drawCalls ?? 0) > 0],
  ['无 pageerror', pageErrs.length === 0],
);
console.log('errors =', errs.length ? errs.slice(0, 5).join('\n') : '(none)');
const pass = checks.filter(([, ok]) => ok).length;
for (const [name, ok] of checks) if (!ok) console.error(`  FAIL  ${name}`);
console.log(`冒烟断言: ${pass}/${checks.length} ${pass === checks.length ? 'PASS' : 'FAIL'}`);
if (pass !== checks.length) process.exitCode = 1;
await browser.close();
