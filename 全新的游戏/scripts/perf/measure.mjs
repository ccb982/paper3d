// ★ 性能基线采集（headless Chrome + SwiftShader 软件光栅化；测量 CPU 侧换算代表性）
//  依赖 main.ts 临时暴露 window.__ppMode / __ppEnterWorld（采集完移除）。
// 用法: node scripts/perf/measure.mjs   （需先启动 vite: npx vite --port 5199）
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.PP_PORT ?? '5199';
const OUT = process.env.PP_OUT ?? path.join('scripts', 'perf', 'data');
fs.mkdirSync(OUT, { recursive: true });

const grid = (r, c) => Array.from({ length: r }, () => Array(c).fill(null));
const player = grid(4, 6);

function makeSession({ hp = 100, atk = 10, def = 2 } = {}) {
  return {
    meta: { version: '0.2.0', day: 1, seed: 4242, totalDaysSurvived: 0, deaths: 0, createdAt: '', lastSavedAt: '' },
    player: { hp, maxHp: hp, attackPower: atk, defense: def, ammo: { default: 150 }, slots: Array(12).fill(null) },
    inventories: { base: grid(30, 30), ship: grid(8, 10), player },
    ship: { hp: 1e6, maxHp: 1e6, shield: 2e5, armor: 999, fuel: 60, fuelMax: 60, position: { x: 30, z: 30 }, techTree: [], turrets: [] },
    gacha: { pityCounter: 0, totalPulls: 0, bossPity: 0 },
    dayProgress: { hasDepartedToday: false },
    outOfRun: { owned: {} },
    story: { flags: {}, events: {} },
  };
}

let browser;
const launch = () => puppeteer.launch({
  executablePath: process.env.PP_CHROME ?? 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe',
  headless: false,
  defaultViewport: { width: 1280, height: 800 },
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--window-size=1280,800', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});

// 页内性能采样器：每帧记录 worldPerf/entityPerf 关键字段 + 帧墙钟，300ms 抓一次 HUD 文本
const SAMPLER = `
  window.__startPerf = (dur) => new Promise((resolve) => {
    const w = window.__ppWp, e = window.__ppEp;
    const SECS = ['chunks','ui','combat','ai','entity','post','phys'];
    const frames = [];
    const hudSamples = [];
    const t0 = performance.now();
    let last = t0;
    const step = () => {
      const now = performance.now();
      const wall = now - last; last = now;
      frames.push([
        wall,
        w.total,
        SECS.map(k => w[k]),
        e.swarmBrain + e.swarmMove + e.swarmSep + e.swarmTier, e.swarmRender,
        w.nAgents, w.nEnemies, w.nEntities, w.assembly,
      ]);
      if (now - lastHud >= 300) { lastHud = now; hudSamples.push({ t: now - t0, text: document.body.innerText }); }
      if (now - t0 >= dur) {
        resolve({ n: frames.length, dur: now - t0, frames, hudSamples, heapNow: performance.memory ? performance.memory.usedJSHeapSize : -1 });
      } else requestAnimationFrame(step);
    };
    let lastHud = 0;
    requestAnimationFrame(step);
  });
`;

async function runScenario(name, { session, url = '', warmup = 18000, sample = 25000, input = null }) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message ?? e)));
  await page.evaluateOnNewDocument((s) => localStorage.setItem('arknights_rogue_save', JSON.stringify(s)), session);
  await page.goto(`http://localhost:${PORT}/${url}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.bringToFront();
  await page.waitForFunction('!!window.__ppEnterWorld', { timeout: 180000 });
  await new Promise((r) => setTimeout(r, 2500));
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown', vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : 'unknown' };
  }).catch(() => null);

  await page.evaluate(() => window.__ppEnterWorld());
  await new Promise((r) => setTimeout(r, 6000));
  await page.evaluate(() => window.__ppMode().finishDock());
  await new Promise((r) => setTimeout(r, warmup));
  await page.evaluate(SAMPLER);

  // 持续输入：按 W 前进（开阔地形直行，跨 chunk）
  const keyNames = input?.keys ?? [];
  for (const k of keyNames) await page.keyboard.down(k);
  const data = await page.evaluate((d) => window.__startPerf(d), sample);
  for (const k of keyNames) await page.keyboard.up(k);

  const out = { name, gpu, errs, data };
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(out, null, 2));
  console.log(`[done] ${name}  frames=${data.n}  durMs=${Math.round(data.dur)}  errs=${errs.length}`);
  await page.close();
  return out;
}

const BASE = makeSession();
const TANK = makeSession({ hp: 1e6, atk: 4000, def: 900 });

browser = await launch();
try {
  await runScenario('idle', { session: BASE, sample: 20000, input: null });
  await runScenario('run', { session: BASE, warmup: 14000, sample: 20000, input: { keys: ['w'] } });
  await runScenario('cbt150', {
    session: TANK, url: '?enemies=150', warmup: 20000, sample: 20000,
    input: { keys: ['w'] },
  });
} finally {
  await browser.close();
}
console.log('ALL DONE');