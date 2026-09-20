import puppeteer from 'puppeteer-core';
const grid = (r, c) => Array.from({ length: r }, () => Array(c).fill(null));
const makeSession = () => ({
  meta: { version: '0.2.0', day: 1, seed: 4242, totalDaysSurvived: 0, deaths: 0, createdAt: '', lastSavedAt: '' },
  player: { hp: 100, maxHp: 100, attackPower: 10, defense: 2, ammo: { default: 150 }, slots: Array(12).fill(null) },
  inventories: { base: grid(30, 30), ship: grid(8, 10), player: grid(4, 6) },
  ship: { hp: 1e6, maxHp: 1e6, shield: 2e5, armor: 999, fuel: 60, fuelMax: 60, position: { x: 30, z: 30 }, techTree: [], turrets: [] },
  gacha: { pityCounter: 0, totalPulls: 0, bossPity: 0 },
  dayProgress: { hasDepartedToday: false }, outOfRun: { owned: {} }, story: { flags: {}, events: {} },
});
const browser = await puppeteer.launch({ executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe', headless: false, args: ['--no-sandbox', '--disable-gpu-sandbox', '--window-size=1280,800'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.evaluateOnNewDocument((s) => localStorage.setItem('arknights_rogue_save', JSON.stringify(s)), makeSession());
await page.goto('http://localhost:5199/?swarmdbg=1&perf=1', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('!!window.__ppEnterWorld', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2500));
await page.evaluate(() => window.__ppEnterWorld());
await new Promise((r) => setTimeout(r, 4000));
await page.evaluate(() => { const m = window.__ppMode(); if (m.phase !== 'explore') m.finishDock(); });
await page.waitForFunction(() => window.__swarm && [...window.__swarm.squads.all()].length >= 3, { timeout: 120000 });
await new Promise((r) => setTimeout(r, 6000));
const probe = () => page.evaluate(() => {
  const s = window.__swarm, c = s.commander, t = c.terrainScore, m = window.__ppMode();
  const px = m.player.position.x, pz = m.player.position.z;
  const rows = [];
  for (const q of s.squads.all()) {
    const st = s.tactics.board.get(q.id);
    const tg = st?.order.target;
    if (!tg) continue;
    let cx = 0, cz = 0, n = 0;
    for (const mm of q.members.values()) { cx += mm.x; cz += mm.z; n++; }
    if (!n) continue;
    const ddx = px - tg.x, ddz = pz - tg.z, ddl = Math.hypot(ddx, ddz) || 1;
    const cover = t.isTrenchAt(tg.x, tg.z) || t.wallNearAt(tg.x, tg.z) || t.blockedAt(tg.x + (ddx / ddl) * 2, tg.z + (ddz / ddl) * 2);
    rows.push({ t: q.type, o: st?.order.kind, dTgt: +Math.hypot(tg.x - px, tg.z - pz).toFixed(0), dSelf: +Math.hypot(cx / n - px, cz / n - pz).toFixed(0), cover, sc: t.scoreAt(tg.x, tg.z) === null ? null : +t.scoreAt(tg.x, tg.z).toFixed(1) });
  }
  return { posture: c.battlePosture, p: +c.postureP.toFixed(2), coverN: rows.filter((r) => r.cover).length, rows };
});
const def = await probe();
await page.evaluate(() => { const c = window.__swarm.commander; const b = c.t01Base < 0 ? 0.01 : c.t01Base; c.debugDayT01 = b + 0.95 * (1 - b); });
await new Promise((r) => setTimeout(r, 8000));
const atk = await probe();
console.log(JSON.stringify({ defense: { posture: def.posture, coverN: def.coverN, of: def.rows.length, rows: def.rows.slice(0, 6) }, attack: { posture: atk.posture, coverN: atk.coverN, of: atk.rows.length, rows: atk.rows.slice(0, 6) } }, null, 2));
await browser.close();
