// 工程兵"挖战壕"链路探针：落点后观察 stage / 建块 / 已建 / 挖遍数 / digTrench 是否真的在跑
// 运行：node scripts/tmp/l1-engprobe.mjs [seed] [waitSec]
import puppeteer from 'puppeteer-core';
const SEED = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 4242;
const WAIT = Number(process.argv[3]) > 0 ? Number(process.argv[3]) : 25;
const grid = (r, c) => Array.from({ length: r }, () => Array(c).fill(null));
const makeSession = (seed) => ({
  meta: { version: '0.2.0', day: 1, seed, totalDaysSurvived: 0, deaths: 0, createdAt: '', lastSavedAt: '' },
  player: { hp: 100, maxHp: 100, attackPower: 10, defense: 2, ammo: { default: 150 }, slots: Array(12).fill(null) },
  inventories: { base: grid(30, 30), ship: grid(8, 10), player: grid(4, 6) },
  ship: { hp: 1e6, maxHp: 1e6, shield: 2e5, armor: 999, fuel: 60, fuelMax: 60, position: { x: 30, z: 30 }, techTree: [], turrets: [] },
  gacha: { pityCounter: 0, totalPulls: 0, bossPity: 0 },
  dayProgress: { hasDepartedToday: false }, outOfRun: { owned: {} }, story: { flags: {}, events: {} },
});
const browser = await puppeteer.launch({
  executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe',
  headless: 'new', args: ['--no-sandbox', '--disable-gpu-sandbox'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.evaluateOnNewDocument((s) => localStorage.setItem('arknights_rogue_save', JSON.stringify(s)), makeSession(SEED));
await page.goto(`http://localhost:5173/?perf=1&swarmdbg=1&seed=${SEED}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('!!window.__ppEnterWorld', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2000));
await page.evaluate(() => window.__ppEnterWorld());
await new Promise((r) => setTimeout(r, 4000));
await page.evaluate(() => window.__ppMode().finishDock());
await page.waitForFunction('!!window.__swarm && !!window.__holeMask', { timeout: 120000 });
const snap = () => page.evaluate(() => {
  const c = window.__swarm?.commander;
  if (!c) return { noCommander: true };
  const kinds = { cover: 0, trench: 0 };
  for (const q of c.buildPieces ?? []) kinds[q.kind]++;
  const mask = window.__holeMask;
  let dug = 0;
  if (mask?.isReady) {
    const a = mask.anchor;
    for (let iz = 0; iz < 288; iz += 2) for (let ix = 0; ix < 288; ix += 2) {
      if (mask.depthAt(a.x - 144 + ix + 0.5, a.z - 144 + iz + 0.5) >= 0.15) dug++;
    }
  }
  const sq = [];
  for (const s of window.__swarm?.squads?.all?.() ?? []) {
    let cx = 0, cz = 0, n = 0;
    for (const m of s.members.values()) { cx += m.x; cz += m.z; n++; }
    sq.push({ id: s.id, type: s.type, b: s.builders, n, x: +(cx / Math.max(1, n)).toFixed(0), z: +(cz / Math.max(1, n)).toFixed(0) });
  }
  return {
    stage: c.stage,
    digTrench: typeof c.digTrench,
    buildCover: typeof c.buildCover,
    pieces: c.buildPieces?.length ?? 0, kinds,
    builtSlots: c.builtSlots?.size ?? 0,
    digPasses: c.digPasses?.size ?? 0,
    dugHalf: dug,
    squads: sq,
  };
});
console.log('① 落点后 →', JSON.stringify(await snap()));
await new Promise((r) => setTimeout(r, WAIT * 1000));
console.log(`② +${WAIT}s →`, JSON.stringify(await snap()));
await page.screenshot({ path: 'scripts/tmp/l1-engprobe.png' });
await browser.close();
console.log('DONE');
