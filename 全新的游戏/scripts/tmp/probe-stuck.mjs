// 卡死回收调试：看人口/小队是否被误回收
import puppeteer from 'puppeteer-core';
const SEED = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 4242;
const grid = (r, c) => Array.from({ length: r }, () => Array(c).fill(null));
const makeSession = (seed) => ({ meta: { version: '0.2.0', day: 1, seed, totalDaysSurvived: 0, deaths: 0, createdAt: '', lastSavedAt: '' }, player: { hp: 100, maxHp: 100, attackPower: 10, defense: 2, ammo: { default: 150 }, slots: Array(12).fill(null) }, inventories: { base: grid(30, 30), ship: grid(8, 10), player: grid(4, 6) }, ship: { hp: 1e6, maxHp: 1e6, shield: 2e5, armor: 999, fuel: 60, fuelMax: 60, position: { x: 30, z: 30 }, techTree: [], turrets: [] }, gacha: { pityCounter: 0, totalPulls: 0, bossPity: 0 }, dayProgress: { hasDepartedToday: false }, outOfRun: { owned: {} }, story: { flags: {}, events: {} } });
const browser = await puppeteer.launch({ executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 6e5, args: ['--no-sandbox', '--disable-gpu-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
await page.evaluateOnNewDocument((s) => localStorage.setItem('arknights_rogue_save', JSON.stringify(s)), makeSession(SEED));
await page.goto(`http://localhost:5173/?perf=1&swarmdbg=1&seed=${SEED}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('!!window.__ppEnterWorld', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2000));
await page.evaluate(() => window.__ppEnterWorld());
await new Promise((r) => setTimeout(r, 4000));
await page.evaluate(() => window.__ppMode().finishDock());
await page.waitForFunction('!!window.__commander', { timeout: 120000 });
await page.evaluate(() => { window.__commander.debugDayT01 = 0.12; });
const run = async (ms, s = 8, st = 0.1) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) await page.evaluate((a, b) => window.__ppRun(a, b), s, st);
};
const snap = () => page.evaluate(() => {
  const sw = window.__swarm, c = window.__commander;
  const L = sw.ledger;
  const rows = [];
  for (const s of sw.squads.all()) {
    const st = sw.tactics.board.get(s.id);
    rows.push(`${s.type}${s.builders ? '*' : ''}#${s.members.size}:${st?.order.kind ?? '-'}${st?.order.mission ? '/' + st.order.mission : ''}`);
  }
  let zeroTarget = 0, arrived = 0;
  for (let i = 0; i < sw.pool.count; i++) {
    const tx = sw.pool.orderTargetX[i], tz = sw.pool.orderTargetZ[i];
    if (tx === 0 && tz === 0) zeroTarget++;
    else if (Math.hypot(sw.pool.x[i] - tx, sw.pool.z[i] - tz) <= 6) arrived++;
  }
  return {
    pool: sw.pool.count, alive: L.alive, kills: L.kills, recalled: L.recalled, removed: L.removed,
    stuck: sw['stuck'].size, zeroTarget, arrived,
    dbg: JSON.stringify(sw.stuckDbg),
    samples: (() => {
      const out = [];
      for (let i = 0; i < Math.min(4, sw.pool.count); i++) {
        const uid = sw.pool.swarmUid[i];
        const sq = sw.squads.get(sw.pool.squadId[i]);
        const st = sq ? sw.tactics.board.get(sq.id) : undefined;
        out.push(`${sq?.type ?? '?'}:${st?.order.kind ?? '-'}@${sw.pool.x[i].toFixed(0)},${sw.pool.z[i].toFixed(0)}`
          + ` t=${sw.pool.taskX[i].toFixed(0)},${sw.pool.taskZ[i].toFixed(0)}`
          + ` d=${sw.pool.directiveTargetX[i].toFixed(0)},${sw.pool.directiveTargetZ[i].toFixed(0)}`
          + ` o=${sw.pool.orderTargetX[i].toFixed(0)},${sw.pool.orderTargetZ[i].toFixed(0)}`);
      }
      return out.join(' | ');
    })(),
    squads: rows.join(' '),
  };
});
for (let k = 0; k < 6; k++) {
  await run(8000);
  console.log(`T+${(k + 1) * 8} :`, JSON.stringify(await snap()));
}
await browser.close();
