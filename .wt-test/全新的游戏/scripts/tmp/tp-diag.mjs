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
await page.evaluate(() => window.__ppMode().finishDock());
await new Promise((r) => setTimeout(r, 16000));
const d = await page.evaluate(() => {
  const m = window.__ppMode(), s = window.__swarm;
  const q = [...s.squads.all()].find((x) => x.type === 'ranged');
  const members = [...q.members.entries()].map(([uid, mm]) => ({ uid, mx: +mm.x.toFixed(0), mz: +mm.z.toFixed(0) }));
  let cx = 0, cz = 0, n = 0;
  for (const mm of q.members.values()) { cx += mm.x; cz += mm.z; n++; }
  const before = { px: +m.player.position.x.toFixed(0), pz: +m.player.position.z.toFixed(0), cx: +(cx / n).toFixed(0), cz: +(cz / n).toFixed(0), n };
  m.player.position.x = cx / n + 10;
  m.player.position.z = cz / n;
  return { before, members, afterSet: { px: +m.player.position.x.toFixed(0), pz: +m.player.position.z.toFixed(0) } };
});
await new Promise((r) => setTimeout(r, 1500));
const after = await page.evaluate(() => {
  const m = window.__ppMode(), s = window.__swarm;
  const q = [...s.squads.all()].find((x) => x.type === 'ranged');
  let cx = 0, cz = 0, n = 0;
  for (const mm of q.members.values()) { cx += mm.x; cz += mm.z; n++; }
  return { px: +m.player.position.x.toFixed(0), pz: +m.player.position.z.toFixed(0), cx: +(cx / n).toFixed(0), cz: +(cz / n).toFixed(0), d: +Math.hypot(cx / n - m.player.position.x, cz / n - m.player.position.z).toFixed(1) };
});
console.log(JSON.stringify({ d, after }, null, 2));
await browser.close();
