// 最终验证：完整落地流程（approach → settle → explore），全程长任务与 render 计时
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const mk = () => ({
  meta: { version: '0.2.0', day: 1, seed: 4242, totalDaysSurvived: 0, deaths: 0, createdAt: '', lastSavedAt: '' },
  player: { hp: 100, maxHp: 100, attackPower: 10, defense: 2, ammo: { default: 150 }, slots: Array(12).fill(null) },
  inventories: { base: Array.from({ length: 30 }, () => Array(30).fill(null)), ship: Array.from({ length: 8 }, () => Array(10).fill(null)), player: Array.from({ length: 4 }, () => Array(6).fill(null)) },
  ship: { hp: 1e6, maxHp: 1e6, shield: 2e5, armor: 999, fuel: 60, fuelMax: 60, position: { x: 30, z: 30 }, techTree: [], turrets: [] },
  gacha: { pityCounter: 0, totalPulls: 0, bossPity: 0 },
  dayProgress: { hasDepartedToday: false },
  outOfRun: { owned: {} },
  story: { flags: {}, events: {} },
});

const browser = await puppeteer.launch({
  executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe',
  headless: false,
  defaultViewport: { width: 1280, height: 800 },
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--window-size=1280,800'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.evaluateOnNewDocument((s) => localStorage.setItem('arknights_rogue_save', JSON.stringify(s)), mk());
await page.goto('http://localhost:5173/?perf=1', { waitUntil: 'domcontentloaded' });
await page.bringToFront();
await page.waitForFunction('!!window.__ppEnterWorld', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2200));
await page.evaluate(() => window.__ppEnterWorld());

// 等预热完成（驱动后台编译 5~6s）
await new Promise((r) => setTimeout(r, 12000));

await page.evaluate(() => {
  window.__long = [];
  const po = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__long.push({ start: +e.startTime.toFixed(0), dur: +e.duration.toFixed(0) });
  });
  po.observe({ entryTypes: ['longtask'] });
  const proto = Object.getPrototypeOf(window.__ppMode());
  const orig = proto.render;
  window.__renders = [];
  proto.render = function (...a) {
    const t0 = performance.now();
    const r = orig.apply(this, a);
    window.__renders.push({ t: +t0.toFixed(0), ms: +(performance.now() - t0).toFixed(1) });
    return r;
  };
  window.__progBefore = window.__ppMode().renderer.info.programs.length;
});

// 直接调 requestDock（等价按 F，避开窗口焦点问题）
await page.evaluate(() => window.__ppMode().requestDock(false));

let done = false;
for (let i = 0; i < 45; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const st = await page.evaluate(() => {
    const m = window.__ppMode();
    return { phase: m.phase, landing: m.landing ? m.landing.phase : null, prog: m.renderer.info.programs.length, dockMs: m.renderer.info.render.calls };
  });
  if (i % 4 === 0) console.log(`  ${(i + 1) * 2}s`, JSON.stringify(st));
  if (st.phase === 'explore') { done = true; console.log('落地完成 @', (i + 1) * 2, 's', JSON.stringify(st)); break; }
}

const out = await page.evaluate(() => ({
  long: window.__long, renders: window.__renders,
  wp: JSON.parse(JSON.stringify(window.__ppWp)),
  phase: window.__ppMode().phase,
  progBefore: window.__progBefore,
  progAfter: window.__ppMode().renderer.info.programs.length,
}));
await browser.close();
fs.mkdirSync('scripts/perf/data', { recursive: true });
fs.writeFileSync('scripts/perf/data/run_dock_final.json', JSON.stringify(out, null, 2));

console.log('落地完成:', done, ' phase:', out.phase);
console.log('program 数 前→后:', out.progBefore, '→', out.progAfter);
console.log('worldPerf.dockMs:', out.wp.dockMs, ' planMs:', out.wp.planMs, ' pickMs:', out.wp.pickMs);
console.log('=== 长任务 TOP8 ===');
for (const l of out.long.sort((a, b) => b.dur - a.dur).slice(0, 8)) console.log(JSON.stringify(l));
console.log('=== 慢 render (>150ms) ===');
for (const r of out.renders.filter((x) => x.ms > 150)) console.log(JSON.stringify(r));
console.log('render 帧数:', out.renders.length, ' 最慢:', out.renders.reduce((m, x) => Math.max(m, x.ms), 0), 'ms');
