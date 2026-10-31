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
await page.evaluateOnNewDocument((s) => localStorage.setItem('arknights_rogue_save', JSON.stringify(s)), mk());
await page.goto('http://localhost:5199/?perf=1', { waitUntil: 'domcontentloaded' });
await page.bringToFront();
await page.waitForFunction('!!window.__ppEnterWorld', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2200));
await page.evaluate(() => window.__ppEnterWorld());
await new Promise((r) => setTimeout(r, 5500));
await page.evaluate(() => window.__ppMode().finishDock());
await new Promise((r) => setTimeout(r, 16000));
const SAMPLER = `
  window.__startPerf = (dur) => new Promise((resolve) => {
    const w = window.__ppWp, e = window.__ppEp;
    const SECS = ['chunks','ui','combat','ai','entity','post','phys'];
    const spikes = []; const t0 = performance.now(); let last = t0, pNA = w.nAgents, pNE = w.nEnemies, pEnt = w.nEntities;
    const step = () => {
      const now = performance.now();
      const wall = now - last; last = now;
      const secs = SECS.map(k => w[k]);
      const dA = w.nAgents - pNA, dE = w.nEnemies - pNE, dEnt = w.nEntities - pEnt;
      pNA = w.nAgents; pNE = w.nEnemies; pEnt = w.nEntities;
      if (wall > 15 || w.total > 8) {
        spikes.push({ wall: +wall.toFixed(1), upd: +w.total.toFixed(2), secs: secs.map(x => +x.toFixed(2)),
          brain: +e.swarmBrain.toFixed(2), move: +e.swarmMove.toFixed(2), sep: +e.swarmSep.toFixed(2), tier: +e.swarmTier.toFixed(2), rend: +e.swarmRender.toFixed(2),
          nA: w.nAgents, nE: w.nEnemies, nEnt: w.nEntities, dA, dE, dEnt, asm: +w.assembly.toFixed(1) });
      }
      if (now - t0 >= dur) resolve({ spikes, n: spikes.length });
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
`;
await page.evaluate(SAMPLER);
await page.keyboard.down('w');
const data = await page.evaluate((d) => window.__startPerf(d), 25000);
await page.keyboard.up('w');
await browser.close();
fs.writeFileSync('scripts/perf/data/run_spikes.json', JSON.stringify(data, null, 2));
const spikes = data.spikes;
console.log('spikes:', spikes.length);
for (const s of spikes.slice(0, 60)) console.log(JSON.stringify(s));