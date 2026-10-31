import puppeteer from 'puppeteer-core';
const seed = 4242;
const grid = (r, c) => Array.from({ length: r }, () => Array(c).fill(null));
const makeSession = (s) => ({ meta: { version: '0.2.0', day: 1, seed: s, totalDaysSurvived: 0, deaths: 0, createdAt: '', lastSavedAt: '' }, player: { hp: 100, maxHp: 100, attackPower: 10, defense: 2, ammo: { default: 150 }, slots: Array(12).fill(null) }, inventories: { base: grid(30, 30), ship: grid(8, 10), player: grid(4, 6) }, ship: { hp: 1e6, maxHp: 1e6, shield: 2e5, armor: 999, fuel: 60, fuelMax: 60, position: { x: 30, z: 30 }, techTree: [], turrets: [] }, gacha: { pityCounter: 0, totalPulls: 0, bossPity: 0 }, dayProgress: { hasDepartedToday: false }, outOfRun: { owned: {} }, story: { flags: {}, events: {} } });
const browser = await puppeteer.launch({ executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 6e5, args: ['--no-sandbox', '--disable-gpu-sandbox'] });
const page = await browser.newPage();
await page.evaluateOnNewDocument((s) => localStorage.setItem('arknights_rogue_save', JSON.stringify(s)), makeSession(seed));
await page.evaluateOnNewDocument(() => { let s = 987654321; Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; });
await page.goto(`http://localhost:5173/?perf=1&swarmdbg=1&seed=${seed}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('!!window.__ppEnterWorld', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2000));
await page.evaluate(() => window.__ppEnterWorld());
await new Promise((r) => setTimeout(r, 4000));
await page.evaluate(() => window.__ppMode().finishDock());
await page.waitForFunction('!!window.__commander', { timeout: 120000 });
let engUids = null;
const mov = new Map();
const stdiPts = [];
const run = async (n, s) => {
  const snap = await page.evaluate(() => {
    const c = window.__commander;
    const uids = new Set();
    for (const sq of c.swarm.squads.all()) if (sq.builders) for (const u of sq.members.keys()) uids.add(u);
    const p = c.swarm.pool, out = [];
    for (let i = 0; i < p.count; i++) if (uids.has(p.swarmUid[i])) out.push([p.swarmUid[i], p.x[i], p.z[i]]);
    return { uids: [...uids], out };
  });
  if (!engUids) engUids = snap.uids;
  for (const [u, x, z] of snap.out) {
    const e = mov.get(u) ?? { tot: 0, moved: 0, lx: x, lz: z, r2: 0, cx: x, cz: z, n: 0, still: 0 };
    const d = Math.hypot(x - e.lx, z - e.lz);
    if (d > 0.4) { e.moved++; e.tot += d; } else e.still++;
    e.r2 = Math.max(e.r2, (x - e.cx) ** 2 + (z - e.cz) ** 2);
    e.lx = x; e.lz = z; e.n++;
    mov.set(u, e);
  }
  stdiPts.push(snap);
  await page.evaluate((ss, st) => window.__ppRun(ss, st), n, s);
};
const t0 = Date.now();
for (let k = 0; k < 50 && Date.now() - t0 < 55000; k++) await run(6, 0.1);
const res = await page.evaluate(() => {
  const c = window.__commander;
  return { built: c.builtSlots.size, pieces: c.buildPieces.length, log: c.buildLog.slice(-20),
    kinds: c.buildPieces.filter(p => !c.builtSlots.has(p.x + ',' + p.z)).slice(0,6).map(p => p.kind + '@' + p.x.toFixed(0) + ',' + p.z.toFixed(0)) };
});
console.log('已建', res.built, '/', res.pieces, '  未建样', res.kinds.join(' '));
console.log('uid | 采样 | 移动% | 站定% | 路径m | 半径m');
for (const [u, e] of [...mov.entries()].sort((a, b) => b[1].moved - a[1].moved))
  console.log(u, '|', e.n, '|', Math.round((e.moved / e.n) * 100), '|', Math.round((e.still / e.n) * 100), '|', e.tot.toFixed(1), '|', Math.sqrt(e.r2).toFixed(1));
const mid = Math.floor(stdiPts.length / 2);
console.log('--- 中点窗口 连续10帧 工兵坐标 (uid:x,z) ---');
for (const s of stdiPts.slice(mid, mid + 10)) {
  console.log(s.out.map(([u, x, z]) => u + ':' + x.toFixed(1) + ',' + z.toFixed(1)).join('  '));
}
console.log('--- 最近20个施工动作 ---');
for (const x of res.log) console.log(x.join(' | '));
await browser.close();
