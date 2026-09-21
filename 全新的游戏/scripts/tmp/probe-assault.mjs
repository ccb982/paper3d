// 总攻工兵语义探针（《工兵架构.md》§8）：
//   ① 方向恒定（玩家贴近 + 总攻 → 朝轴不变，旧 reface 会转向玩家）
//   ② 总攻停挖壕（战壕件作废、digPasses 冻结）
//   ③ 总攻掩体继续增长
//   ④ 掩体尽（S2）→ 工兵转护栏最近远程小队（距离 < 15m）
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

const snap = () => page.evaluate(() => {
  const c = window.__commander, sw = window.__swarm;
  const pieces = c.buildPieces;
  const trench = pieces.filter((p) => p.kind === 'trench').length;
  const cover = pieces.filter((p) => p.kind === 'cover').length;
  const centro = (sq) => {
    let x = 0, z = 0, n = 0;
    for (const m of sq.members.values()) { x += m.x; z += m.z; n++; }
    return n ? [x / n, z / n] : null;
  };
  const all = [...sw.squads.all()];
  const builders = all.filter((s) => s.builders).map(centro).filter(Boolean);
  const ranged = all.filter((s) => s.type === 'ranged').map(centro).filter(Boolean);
  let engToRanged = Infinity;
  for (const b of builders) for (const r of ranged) {
    engToRanged = Math.min(engToRanged, Math.hypot(b[0] - r[0], b[1] - r[1]));
  }
  const bs = c.decideCtx.buildSite;
  return {
    ax: +c.plan.approachX.toFixed(2), az: +c.plan.approachZ.toFixed(2),
    posture: c.battlePosture, stage: c.stage,
    trench, cover, built: c.builtSlots.size, passes: c.digPasses.size,
    squads: all.map((s) => s.type + (s.builders ? '*' : '')).join(','),
    nBuilder: builders.length, nRanged: ranged.length,
    engToRanged: Number.isFinite(engToRanged) ? +engToRanged.toFixed(1) : -1,
    siteToRanged: bs && ranged.length ? +Math.min(...ranged.map((r) => Math.hypot(bs.x - r[0], bs.z - r[1]))).toFixed(1) : -1,
  };
});

const run = async (ms, s = 8, st = 0.1) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) await page.evaluate((a, b) => window.__ppRun(a, b), s, st);
};

// A：正常施工一段时间（应有战壕在建/建成）
await run(35000);
const A = await snap();
console.log('A 施工中 :', JSON.stringify(A));

// 玩家贴近 + 强制总攻 → 方向应恒定（不再朝玩家重排）、战壕件作废
await page.evaluate(() => {
  const c = window.__commander;
  const pm = window.__ppMode();
  pm.player.position.x = c.plan.cx + 80;
  pm.player.position.z = c.plan.cz;
  c.setPosture('assault');
});
await run(3000);
const B = await snap();
console.log('B 总攻初 :', JSON.stringify(B));

// 总攻持续：掩体应继续增长；无新挖痕
await run(25000);
const C = await snap();
console.log('C 总攻中 :', JSON.stringify(C));
console.log('--- 判定 ---');
console.log('① 方向恒定     :', A.ax === C.ax && A.az === C.az ? 'PASS' : `FAIL (${A.ax},${A.az})→(${C.ax},${C.az})`);
console.log('② 停挖壕       :', B.trench === 0 && C.passes === 0 ? 'PASS' : `FAIL trench=${C.trench} passes=${C.passes}`);
console.log('③ 掩体续增长   :', C.built > B.built ? 'PASS' : `WARN built ${B.built}→${C.built}（可能已建完）`);

// D：掩体全部封顶 → S2 → 工兵转护栏射手
await page.evaluate(() => {
  const c = window.__commander;
  for (const p of c.buildPieces) c.builtSlots.add(p.x + ',' + p.z);
});
await run(12000);
const D = await snap();
console.log('D 掩体尽S2 :', JSON.stringify(D));
console.log('④ 护栏射手     :', D.stage === 'S2' && D.nRanged > 0 && D.engToRanged >= 0 && D.engToRanged < 15 ? 'PASS' : `FAIL stage=${D.stage} dist=${D.engToRanged} ranged=${D.nRanged}`);
await browser.close();
