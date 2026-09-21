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
const t0 = Date.now();
while (Date.now() - t0 < 85000) await page.evaluate((s, st) => window.__ppRun(s, st), 12, 0.1);
const res = await page.evaluate(() => {
  const c = window.__commander;
  const raster = window.__ppMode().raster;
  const trench = c.buildPieces.filter(p => p.kind === 'trench');
  const dug = trench.filter(p => c.builtSlots.has(p.x + ',' + p.z))
    .map(p => ({ x: p.x, z: p.z, deep: +raster.levelDepthAt(p.x, p.z).toFixed(2), pass: c.digPasses.get(p.x + ',' + p.z) ?? 5 }));
  const ongoing = trench.filter(p => !c.builtSlots.has(p.x + ',' + p.z))
    .map(p => c.digPasses.get(p.x + ',' + p.z) ?? 0);
  return { built: c.builtSlots.size, pieces: c.buildPieces.length,
    trenchBuilt: dug.slice(0, 6), trenchPasses: ongoing.slice(0, 6) };
});
console.log('已建', res.built, '/', res.pieces);
console.log('已建战壕深度:', res.trenchBuilt.map(d => d.x.toFixed(0) + ',' + d.z.toFixed(0) + '=' + d.deep + 'm/' + d.pass + '遍').join('  ') || '(尚无战壕建成)');
console.log('在建战壕遍数:', res.trenchPasses.join(',') || '(无)');
await browser.close();
