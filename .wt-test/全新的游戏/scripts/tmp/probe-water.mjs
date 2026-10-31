import puppeteer from 'puppeteer-core';
const SEED = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 4242;
const grid = (r, c) => Array.from({ length: r }, () => Array(c).fill(null));
const makeSession = (seed) => ({ meta: { version: '0.2.0', day: 1, seed, totalDaysSurvived: 0, deaths: 0, createdAt: '', lastSavedAt: '' }, player: { hp: 100, maxHp: 100, attackPower: 10, defense: 2, ammo: { default: 150 }, slots: Array(12).fill(null) }, inventories: { base: grid(30, 30), ship: grid(8, 10), player: grid(4, 6) }, ship: { hp: 1e6, maxHp: 1e6, shield: 2e5, armor: 999, fuel: 60, fuelMax: 60, position: { x: 30, z: 30 }, techTree: [], turrets: [] }, gacha: { pityCounter: 0, totalPulls: 0, bossPity: 0 }, dayProgress: { hasDepartedToday: false }, outOfRun: { owned: {} }, story: { flags: {}, events: {} } });
const browser = await puppeteer.launch({ executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 6e5, args: ['--no-sandbox', '--disable-gpu-sandbox'] });
const page = await browser.newPage();
await page.evaluateOnNewDocument((s) => localStorage.setItem('arknights_rogue_save', JSON.stringify(s)), makeSession(SEED));
await page.goto(`http://localhost:5173/?perf=1&swarmdbg=1&seed=${SEED}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('!!window.__ppEnterWorld', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2000));
await page.evaluate(() => window.__ppEnterWorld());
await new Promise((r) => setTimeout(r, 4000));
await page.evaluate(() => window.__ppMode().finishDock());
await page.waitForFunction('!!window.__commander', { timeout: 120000 });
const res = await page.evaluate(() => {
  const raster = window.__ppMode().raster;
  const hist = new Map(); let max = 0, maxPt = null; const wet = [];
  const S = raster.sideSpec ?? null;
  const scanSide = 128, step = 4;
  const ox = 0, oz = 0;
  for (let wi = 0; wi < Math.ceil(scanSide / step); wi++) {
    for (let wj = 0; wj < Math.ceil(scanSide / step); wj++) {
      const gx = 0 + wi * step, gz = 0 + wj * step;
      const td = raster.tileDefAt(gx, gz);
      if (!td) continue;
      const d = raster.levelDepthAt(gx, gz);
      const key = d.toFixed(1);
      hist.set(key, (hist.get(key) ?? 0) + 1);
      if (d > max) { max = d; maxPt = [gx, gz, td.genRole, raster.surfaceHeightAt(gx, gz).toFixed(1)]; }
      if (td.genRole === 'liquid') wet.push([gx, gz, +d.toFixed(1), +raster.surfaceHeightAt(gx, gz).toFixed(1)]);
    }
  }
  return { max, maxPt, wet: wet.slice(0, 12), hist: [...hist.entries()].sort((a, b) => Number(a[0]) - Number(b[0])) };
});
console.log('最深 levelDepthAt:', res.max, '@', res.maxPt);
console.log('水面角色示例:', res.wet);
console.log('深度直方图:', res.hist.slice(-14).join(' '));
await browser.close();
