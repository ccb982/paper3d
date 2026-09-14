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
const SAMPLER = `
  window.__startPerf = (dur) => new Promise((resolve) => {
    const w = window.__ppWp, e = window.__ppEp;
    const SECS = ['chunks','ui','combat','ai','entity','post','phys'];
    const frames = []; const hudSamples = [];
    const t0 = performance.now(); let last = t0, lastHud = 0;
    const step = () => {
      const now = performance.now();
      const wall = now - last; last = now;
      frames.push([wall, w.total, SECS.map(k => w[k]), w.nAgents, w.nEnemies, w.nEntities]);
      if (now - lastHud >= 300) { lastHud = now; hudSamples.push(document.body.innerText); }
      if (now - t0 >= dur) resolve({ n: frames.length, dur: now - t0, frames, hudSamples });
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
`;
const browser = await puppeteer.launch({
  executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe',
  headless: false,
  defaultViewport: { width: 1920, height: 1080 },
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--window-size=1920,1080'],
});
const page = await browser.newPage();
await page.evaluateOnNewDocument((s) => localStorage.setItem('arknights_rogue_save', JSON.stringify(s)), mk());
await page.goto('http://localhost:5199/?perf=1', { waitUntil: 'domcontentloaded' });
await page.bringToFront();
await page.waitForFunction('!!window.__ppEnterWorld', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2200));
await page.evaluate(() => window.__ppEnterWorld());
await new Promise((r) => setTimeout(r, 5500));
await page.evaluate(() => window.__ppMode().finishDock());
await new Promise((r) => setTimeout(r, 15000));
await page.evaluate(SAMPLER);
await page.keyboard.down('w');
const data = await page.evaluate((d) => window.__startPerf(d), 12000);
await page.keyboard.up('w');
await browser.close();

const fr = data.frames, N = fr.length;
const pct = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.max(0, Math.min(a.length - 1, Math.floor((a.length - 1) * p)))]; };
const wall = fr.map((f) => f[0]), tot = fr.map((f) => f[1]);
const mid = (data.hudSamples ?? [])[Math.max(0, ((data.hudSamples ?? []).length >> 1) - 1)]?.text ?? '';
console.log('1080p run:', JSON.stringify({
  frames: N,
  wallAvg: (wall.reduce((a, b) => a + b, 0) / N).toFixed(2),
  wallP50: pct(wall, 0.5).toFixed(2), wallP95: pct(wall, 0.95).toFixed(2), wallP99: pct(wall, 0.99).toFixed(2), wallMax: pct(wall, 1).toFixed(2),
  updAvg: (tot.reduce((a, b) => a + b, 0) / N).toFixed(3), updP95: pct(tot, 0.95).toFixed(2), updP99: pct(tot, 0.99).toFixed(2), updMax: pct(tot, 1).toFixed(2),
  hudFps: mid.match(/([\d.]+) FPS/)?.[1],
  hudUpdRend: mid.match(/更新 ([\d.]+) ms\s+渲染 ([\d.]+) ms/)?.slice(1),
  hudDrawsTris: mid.match(/绘制 (\d+) 调用\s+三角 (\d+)/)?.slice(1),
  gpuWin: Math.round(1920 * 1080), triPerPx1k: null,
}, null, 2));
fs.writeFileSync('scripts/perf/data/1080p_run.json', JSON.stringify(data, null, 2));