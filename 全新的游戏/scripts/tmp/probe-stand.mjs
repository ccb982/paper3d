import puppeteer from 'puppeteer-core';
const seed = 4242;
const grid = (r, c) => Array.from({ length: r }, () => Array(c).fill(null));
const makeSession = (s) => ({ meta: { version: '0.2.0', day: 1, seed: s, totalDaysSurvived: 0, deaths: 0, createdAt: '', lastSavedAt: '' }, player: { hp: 100, maxHp: 100, attackPower: 10, defense: 2, ammo: { default: 150 }, slots: Array(12).fill(null) }, inventories: { base: grid(30, 30), ship: grid(8, 10), player: grid(4, 6) }, ship: { hp: 1e6, maxHp: 1e6, shield: 2e5, armor: 999, fuel: 60, fuelMax: 60, position: { x: 30, z: 30 }, techTree: [], turrets: [] }, gacha: { pityCounter: 0, totalPulls: 0, bossPity: 0 }, dayProgress: { hasDepartedToday: false }, outOfRun: { owned: {} }, story: { flags: {}, events: {} } });
const browser = await puppeteer.launch({ executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 6e5, args: ['--no-sandbox', '--disable-gpu-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.evaluateOnNewDocument((s) => localStorage.setItem('arknights_rogue_save', JSON.stringify(s)), makeSession(seed));
await page.goto(`http://localhost:5173/?perf=1&swarmdbg=1&seed=${seed}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('!!window.__ppEnterWorld', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2000));
await page.evaluate(() => window.__ppEnterWorld());
await new Promise((r) => setTimeout(r, 4000));
await page.evaluate(() => window.__ppMode().finishDock());
await page.waitForFunction('!!window.__commander', { timeout: 120000 });
const mov = new Map();
const run = async (n, s) => {
  const snap = await page.evaluate(() => {
    const p = window.__commander.swarm.pool;
    const out = [];
    for (let i = 0; i < p.count; i++) if (p.role[i] === 1) out.push([p.swarmUid[i], p.x[i], p.z[i]]);
    return out;
  });
  for (const [u, x, z] of snap) {
    const e = mov.get(u) ?? { tot: 0, moved: 0, lx: x, lz: z, r2: 0, cx: x, cz: z, n: 0 };
    const d = Math.hypot(x - e.lx, z - e.lz);
    if (d > 0.4) { e.moved++; e.tot += d; }
    e.r2 = Math.max(e.r2, (x - e.cx) ** 2 + (z - e.cz) ** 2);
    e.lx = x; e.lz = z; e.n++;
    mov.set(u, e);
  }
  await page.evaluate((ss, st) => window.__ppRun(ss, st), n, s);
};
const t0 = Date.now();
for (let k = 0; k < 50 && Date.now() - t0 < 55000; k++) await run(8, 0.1);
const res = await page.evaluate(() => {
  const c = window.__commander;
  return { built: c.builtSlots.size, pieces: c.buildPieces.length, log: c.buildLog.slice(-20) };
});
console.log('已建', res.built, '/', res.pieces);
console.log('uid | 条数 | 移动占比% | 路径长 | 绕圈半径');
const rows = [...mov.entries()].sort((a, b) => b[1].moved - a[1].moved);
for (const [u, e] of rows) console.log(u, '|', e.n, '|', Math.round((e.moved / e.n) * 100), '|', e.tot.toFixed(1), '|', Math.sqrt(e.r2).toFixed(1));
console.log('--- 最近20个施工/挖建动作(真实秒 | 队伍 | 焦点 | C/D | 目标) ---');
for (const x of res.log) console.log(x.join(' | '));
await browser.close();
