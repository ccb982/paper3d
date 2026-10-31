// 总攻只停挖战壕（件保留、路径照常）验证：强制 assault 后 pri1 不再增长
import puppeteer from 'puppeteer-core';
const SEED = 4242;
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
await page.evaluate(() => { window.__commander.debugDayT01 = 0.12; });
const run = async (ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) await page.evaluate((a, b) => window.__ppRun(a, b), 8, 0.1); };
const stat = () => page.evaluate(() => {
  const c = window.__commander, key = (p) => p.x + ',' + p.z;
  const t = c.buildPieces.filter((p) => p.kind === 'trench');
  return {
    posture: c.battlePosture,
    trenchN: t.length, trenchBuilt: t.filter((p) => c.builtSlots.has(key(p))).length,
    passes: c.digPasses.size, pieces: c.buildPieces.length,
  };
});
// 先自然施工 20 秒（挖壕中）
await run(20000);
const A = await stat();
console.log('施工期 :', JSON.stringify(A));
// 强制总攻（只停挖）
await page.evaluate(() => window.__commander.setPosture('assault'));
await run(12000);
const B = await stat();
console.log('总攻后 :', JSON.stringify(B));
console.log('--- 判定 ---');
console.log('① 件保留     :', B.trenchN === A.trenchN && B.trenchN > 0 ? 'PASS' : `FAIL ${A.trenchN}→${B.trenchN}`);
console.log('② 停挖（件不增）:', B.trenchBuilt <= A.trenchBuilt + 1 ? 'PASS' : `FAIL built ${A.trenchBuilt}→${B.trenchBuilt}`);
await browser.close();
