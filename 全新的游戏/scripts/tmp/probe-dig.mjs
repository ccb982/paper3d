// 施工回归探针（锁死 fortify，专测：战壕照挖、深度 ≤ 硬约束、掩体照建）
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
// 锁死低日程：t01Base=dRaw → t01=0 → fortify 常驻（绝不进总攻）
await page.evaluate(() => { window.__commander.debugDayT01 = 0.12; });
const run = async (ms, s = 8, st = 0.1) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) await page.evaluate((a, b) => window.__ppRun(a, b), s, st);
};
await run(45000);
const r = await page.evaluate(() => {
  const c = window.__commander, raster = window.__ppMode().raster;
  const trench = c.buildPieces.filter((p) => p.kind === 'trench');
  const cover = c.buildPieces.filter((p) => p.kind === 'cover');
  const dug = trench.filter((p) => c.builtSlots.has(p.x + ',' + p.z));
  const deep = dug.slice(0, 5).map((p) => ({
    x: +p.x.toFixed(0), z: +p.z.toFixed(0),
    d: +raster.levelDepthAt(p.x, p.z).toFixed(2),
    h: +raster.surfaceHeightAt(p.x, p.z).toFixed(2),
  }));
  const over = deep.filter((q) => q.h < -1.2).length;
  const coverBuilt = cover.filter((p) => c.builtSlots.has(p.x + ',' + p.z)).length;
  return {
    posture: c.battlePosture, stage: c.stage,
    trenchN: trench.length, trenchBuilt: dug.length,
    coverN: cover.length, coverBuilt,
    ongoing: [...c.digPasses.values()].slice(0, 6),
    deep, over,
  };
});
console.log('态势', r.posture, '阶段', r.stage);
console.log('战壕', r.trenchBuilt, '/', r.trenchN, ' 掩体', r.coverBuilt, '/', r.coverN);
console.log('建成战壕样本:', r.deep.map((q) => `${q.x},${q.z}=${q.d}m(h=${q.h})`).join('  ') || '(无)');
console.log('在建遍数:', r.ongoing.join(',') || '(无)');
console.log('① 战壕照挖 :', r.trenchBuilt > 0 ? 'PASS' : 'FAIL');
console.log('② 深度合规 :', r.over === 0 ? 'PASS' : `FAIL 坑底越线 ${r.over}`);
await browser.close();
