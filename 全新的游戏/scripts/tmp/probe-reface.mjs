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
const s1 = await page.evaluate(() => {
  const c = window.__commander, P = c.plan;
  const kindBy = (k) => c.buildPieces.filter(p => p.kind === k).map(p => ({ x: +p.x.toFixed(1), z: +p.z.toFixed(1), r: p.ring }));
  return { ax: +P.approachX.toFixed(2), az: +P.approachZ.toFixed(2), trench: kindBy('trench'), cover: kindBy('cover') };
});
console.log('落地朝轴: (' + s1.ax + ',' + s1.az + ')  战壕', s1.trench.length, ' 掩体', s1.cover.length);
for (let r = 2; r >= 0; r--) {
  const t = s1.trench.filter(x => x.r === r).sort((a, b) => a.x - b.x);
  console.log('环' + r + ' 战壕直线:', t.map(q => q.x.toFixed(0) + ',' + q.z.toFixed(0)).join('  '));
}
// ★ 强制高威胁 + 玩家在侧 → reface 应转向玩家(+x≈1,0)
const s2 = await page.evaluate(() => {
  const c = window.__commander;
  c.lastPlayerX = c.plan.cx + 120; c.lastPlayerZ = c.plan.cz;
  c.battlePosture = 'assault'; c.postureP = 0.9;
  c['refaceDefense']();
  const P = c.plan;
  return { ax: +P.approachX.toFixed(2), az: +P.approachZ.toFixed(2), trench: c.buildPieces.filter(p => p.kind === 'trench').length, cover: c.buildPieces.filter(p => p.kind === 'cover').length };
});
console.log('强制高威胁 reface → 朝轴: (' + s2.ax + ',' + s2.az + ')  战壕', s2.trench, ' 掩体', s2.cover);
// ★ 跑一段让新战壕挖满 5 遍，测最终深度
const t0 = Date.now();
while (Date.now() - t0 < 65000) await page.evaluate((s, st) => window.__ppRun(s, st), 8, 0.1);
const s3 = await page.evaluate(() => {
  const c = window.__commander;
  const raster = window.__ppMode().raster;
  const done = [...c.builtSlots].slice(0, 3).map(k => {
    const [x, z] = k.split(',').map(Number);
    return { x, z, deep: +raster.levelDepthAt(x, z).toFixed(2) };
  });
  const passes = [...c.digPasses.entries()].slice(0, 3);
  return { built: c.builtSlots.size, pieces: c.buildPieces.length, done, passes: passes.map(x => x[1]) };
});
console.log('已建', s3.built, '/', s3.pieces, '  战壕建成深度:', s3.done.map(d => d.x.toFixed(0) + ',' + d.z.toFixed(0) + '=' + d.deep + 'm').join(' '), '  在建遍数:', s3.passes.join(','));
await browser.close();
