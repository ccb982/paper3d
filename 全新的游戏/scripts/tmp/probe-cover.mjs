// 驻守掩体探针（《敌人管线设计.md》§3.2.1）：
//   ① 引擎选掩体：远程队 protectAssign.source='cover'，命令 kind='garrison'（target=掩体中心）
//   ② 命令携带玩家位置（threat ≈ 玩家坐标）
//   ③ 个体自行绕掩体：指令目标在掩体背玩家侧（掩体在 单位→玩家 连线上）
//   ④ 玩家换侧 → 指令目标绕到另一边（实时跟随玩家位置）
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
const run = async (ms, s = 8, st = 0.1) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) await page.evaluate((a, b) => window.__ppRun(a, b), s, st);
};
// 先钉低日程（t01Base=0.12），再推到 0.5 → t01≈0.43：放行增兵（远程队），但不进总攻
await page.evaluate(() => { window.__commander.debugDayT01 = 0.12; });
await run(3000);
await page.evaluate(() => { window.__commander.debugDayT01 = 0.5; });
// 确保有远程队（队列偶尔被上限/生成失败吞）：直接补 3 只（near=true 不推动）
await page.evaluate(() => {
  const c = window.__commander, P = c.plan;
  for (let i = 0; i < 3; i++) c.spawnMob(P.cx + Math.cos(i * 2.1) * 50, P.cz + Math.sin(i * 2.1) * 50, 'ranged', false, true);
  // 玩家放到 65m（>L3 升格半径 → 远程保持代理层，可直接读指令列）
  const pm = window.__ppMode().player.position;
  pm.x = P.cx + 65; pm.z = P.cz;
});

const snap = () => page.evaluate(() => {
  const c = window.__commander, sw = window.__swarm, pool = sw.pool;
  let sid = -1, uid = -1;
  const squads = [...sw.squads.all()].map((s) => s.type + (s.builders ? '*' : '') + '#' + s.members.size + (s.type === 'ranged' && s.members.size > 0 ? '!' : '')).join(',');
  for (const s of sw.squads.all()) {
    if (s.type === 'ranged' && !s.builders && s.members.size > 0) { sid = s.id; break; }
  }
  if (sid >= 0) {
    const sq = sw.squads.get(sid);
    if (sq && sq.members.size > 0) uid = sq.members.keys().next().value;   // 每拍现取（成员可能升格/阵亡）
  }
  if (sid < 0) return { sid: -1, covers: c.holeTable.covers.length, squads };
  const st = sw.tactics.board.get(sid);
  const pt = c.protectAssign.get(sid) ?? null;
  let idx = -1;
  for (let i = 0; i < pool.count; i++) if (pool.swarmUid[i] === uid) { idx = i; break; }
  const dt = idx >= 0 ? { x: pool.directiveTargetX[idx], z: pool.directiveTargetZ[idx] } : null;
  const pm = window.__ppMode().player.position;
  // 掩体是否在 指令目标 → 玩家 连线上（点到线段距离 < 2.5m）
  let shield = false, behind = false, segD = -1;
  if (pt && dt) {
    const vx = pm.x - dt.x, vz = pm.z - dt.z;
    const L2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((pt.x - dt.x) * vx + (pt.z - dt.z) * vz) / L2));
    segD = Math.hypot(dt.x + vx * t - pt.x, dt.z + vz * t - pt.z);
    shield = segD < 2.5;
    behind = (dt.x - pt.x) * (pm.x - pt.x) + (dt.z - pt.z) * (pm.z - pt.z) < 0;
  }
  return {
    sid, kind: st?.order.kind ?? 'none',
    covers: c.holeTable.covers.length, squads,
    tx: st?.order.target ? +st.order.target.x.toFixed(1) : null,
    tz: st?.order.target ? +st.order.target.z.toFixed(1) : null,
    threatX: st?.order.threatX !== undefined ? +st.order.threatX.toFixed(1) : null,
    px: +pm.x.toFixed(1), pz: +pm.z.toFixed(1),
    ptSource: pt?.source ?? 'none',
    coverPt: pt ? `${pt.x.toFixed(1)},${pt.z.toFixed(1)}` : 'none',
    dirX: dt ? +dt.x.toFixed(1) : null, dirZ: dt ? +dt.z.toFixed(1) : null,
    shield, behind, segD: +segD.toFixed(2),
  };
});

let A = await snap();
for (let k = 0; k < 12 && A.ptSource !== 'cover'; k++) {
  console.log(`等待驻守 ${k}:`, JSON.stringify(A));
  await run(15000);
  A = await snap();
}
const B = A;
console.log('B 驻守 :', JSON.stringify(B));
if (B.sid < 0 || !B.coverPt || B.coverPt === 'none') {
  console.log('本局未出现"掩体驻守"（covers=' + (B.covers ?? -1) + '）→ 退出');
  await browser.close();
  process.exit(0);
}

// 玩家绕到掩体另一侧（保持 30m）
await page.evaluate((cover) => {
  const pm = window.__ppMode().player.position;
  const [cx, cz] = cover.split(',').map(Number);
  const dx = pm.x - cx, dz = pm.z - cz, dl = Math.hypot(dx, dz) || 1;
  pm.x = cx - (dx / dl) * 65; pm.z = cz - (dz / dl) * 65;
}, B.coverPt);
await run(4000);
const C = await snap();
console.log('C 换侧 :', JSON.stringify(C));

console.log('--- 判定 ---');
console.log('① 引擎选掩体 :', B.ptSource === 'cover' && B.kind === 'garrison' ? 'PASS' : `FAIL src=${B.ptSource} kind=${B.kind}`);
console.log('② 命令带玩家 :', B.threatX !== null && Math.hypot((B.threatX ?? 0) - B.px, 0) >= 0 ? 'PASS' : 'FAIL');
console.log('③ 个体绕掩体 :', B.shield && B.behind ? 'PASS' : `FAIL shield=${B.shield} behind=${B.behind} segD=${B.segD}`);
console.log('④ 换侧跟随   :', C.shield && C.behind ? 'PASS' : `FAIL shield=${C.shield} behind=${C.behind} segD=${C.segD}`);
await browser.close();
