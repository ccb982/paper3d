// 保护 / 巡逻探针（《小队战术与命令.md》§2.1 保护语义）：
//   ① 无接触：保护位巡逻（目标在锚的 guardDist+patrolR 邻域内）
//   ② 巡逻态：连续采样目标点在动（游弋）
//   ③ 接触：玩家贴近锚 → advance 且目标截断在 leash 内（不越缰绳）
//   ④ 撤退：玩家远离锚 → 回保护位（不追）
//   ⑤ 工兵保护动作 = 造工事（spreadBuilders 派件）
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
await page.evaluate(() => { window.__commander.debugDayT01 = 0.12; });   // 锁 fortify
const run = async (ms, s = 8, st = 0.1) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) await page.evaluate((a, b) => window.__ppRun(a, b), s, st);
};
await run(35000);

// 锁定一个非工兵的地面护卫小队
const pick = await page.evaluate(() => {
  const c = window.__commander, sw = window.__swarm;
  const list = [...sw.squads.all()];
  for (const s of list) {
    if (s.builders || s.type === 'flyer' || s.type === 'logistics') continue;
    const st = sw.tactics.board.get(s.id);
    if (st && st.order.kind === 'protect') return { id: s.id, type: s.type, uid: s.members.keys().next().value };
  }
  return null;
});
if (!pick) { console.log('未找到保护小队'); await browser.close(); process.exit(1); }
console.log('目标小队 #' + pick.id, pick.type);

const snap = () => page.evaluate(({ id, uid }) => {
  const c = window.__commander, sw = window.__swarm;
  const st = sw.tactics.board.get(id);
  const s = sw.squads.get(id);
  const anchor = c.decideCtx.protect ?? c.decideCtx.post.get(id) ?? c.decideCtx.front;
  const t = st?.order.target;
  const mission = c.missionAssign.get(id)?.mission;
  let engD = -1;
  for (const b of sw.squads.all()) {
    if (!b.builders) continue;
    let x = 0, z = 0, n = 0;
    for (const m of b.members.values()) { x += m.x; z += m.z; n++; }
    if (!n) continue;
    const d = Math.hypot(x / n - anchor.x, z / n - anchor.z);
    engD = engD < 0 ? d : Math.min(engD, d);
  }
  const task = c.memberTasks.taskOf(uid);
  return {
    mission, kind: st?.order.kind ?? 'none',
    engDist: +engD.toFixed(1),
    tkx: task ? +task.x.toFixed(1) : null, tkz: task ? +task.z.toFixed(1) : null,
    ax: +anchor.x.toFixed(1), az: +anchor.z.toFixed(1),
    tx: t ? +t.x.toFixed(1) : null, tz: t ? +t.z.toFixed(1) : null,
    dAnchor: t ? +Math.hypot(t.x - anchor.x, t.z - anchor.z).toFixed(1) : -1,
    n: s ? s.members.size : 0,
  };
}, pick);

const B = await snap();
console.log('B 无接触 :', JSON.stringify(B));
// 巡逻态：4 次采样看目标点在动
const moves = [];
for (let k = 0; k < 4; k++) { moves.push(await snap()); await run(2500); }
let maxD = 0;
for (const a of moves) for (const b of moves) {
  if (a.tx === null || b.tx === null) continue;
  maxD = Math.max(maxD, Math.hypot(a.tx - b.tx, a.tz - b.tz));
}
console.log('C 巡逻态 : 目标最大位移', maxD.toFixed(1), 'm  样本半径', moves.map((m) => m.dAnchor).join(','));

// 接触：玩家贴到锚旁 8m
await page.evaluate((id) => {
  const c = window.__commander, pm = window.__ppMode();
  const a = c.decideCtx.protect ?? c.decideCtx.post.get(id) ?? c.decideCtx.front;
  pm.player.position.x = a.x + 8; pm.player.position.z = a.z;
}, pick);
await run(6000);
const D = await snap();
console.log('D 接触   :', JSON.stringify(D));
// 撤退：玩家远离锚 200m
await page.evaluate((id) => {
  const c = window.__commander, pm = window.__ppMode();
  const a = c.decideCtx.protect ?? c.decideCtx.post.get(id) ?? c.decideCtx.front;
  pm.player.position.x = a.x + 200; pm.player.position.z = a.z;
}, pick);
await run(8000);
const E = await snap();
console.log('E 撤退   :', JSON.stringify(E));

// 工兵保护动作：spreadBuilders 白盒（返回 true 且任务点在 40m 内）
const F = await page.evaluate(() => {
  const c = window.__commander, sw = window.__swarm;
  const b = [...sw.squads.all()].find((s) => s.builders);
  if (!b) return { ok: false, why: 'no builder' };
  let cx = 0, cz = 0, n = 0;
  for (const m of b.members.values()) { cx += m.x; cz += m.z; n++; }
  if (!n) return { ok: false, why: 'empty' };
  cx /= n; cz /= n;
  const wrote = c.corps.spreadBuilders(b, cx, cz);
  let maxTask = -1;
  for (const uid of b.members.keys()) {
    const t = c.memberTasks.taskOf(uid);
    if (t) maxTask = Math.max(maxTask, Math.hypot(t.x - cx, t.z - cz));
  }
  return { ok: wrote, maxTask: +maxTask.toFixed(1), pieces: c.buildPieces.length };
});
console.log('F 工兵派件 :', JSON.stringify(F));

console.log('--- 判定 ---');
const taskMoves = moves.filter((m) => m.tkx !== null);
let maxTaskMove = 0;
for (const a of taskMoves) for (const b of taskMoves) {
  if (a.tkx === null || b.tkx === null) continue;
  maxTaskMove = Math.max(maxTaskMove, Math.hypot(a.tkx - b.tkx, a.tkz - b.tkz));
}
console.log('① 护锚=工程队 :', B.engDist >= 0 && B.engDist < 6 ? 'PASS' : `CHECK engDist=${B.engDist}`);
console.log('② 扇区稳定   : 任务点最大位移', maxTaskMove.toFixed(1), 'm');
console.log('③ 保护位邻域 :', B.dAnchor >= 0 && B.dAnchor <= 22 ? 'PASS' : `CHECK d=${B.dAnchor} kind=${B.kind}`);
console.log('④ 巡逻态(令) :', maxD > 0.5 ? 'PASS' : `CHECK maxD=${maxD}`);
console.log('⑤ 缰绳截断   :', D.kind === 'advance' ? (D.dAnchor <= 15 ? 'PASS' : `FAIL d=${D.dAnchor}`) : `CHECK kind=${D.kind} d=${D.dAnchor}`);
console.log('⑥ 撤退不追   :', E.kind !== 'advance' || E.dAnchor <= 15 ? 'PASS' : `FAIL kind=${E.kind} d=${E.dAnchor}`);
console.log('⑦ 工兵造工事 :', F.ok ? 'PASS' : 'CHECK（附近无工件，回落站岗）');
// ⑧ 全部 guard 任务队：不再走 flank/press（chase 旁路已修）
const kinds = await page.evaluate(() => {
  const c = window.__commander, sw = window.__swarm, out = [];
  for (const s of sw.squads.all()) {
    if (c.missionAssign.get(s.id)?.mission !== 'guard') continue;
    out.push(s.type + ':' + (sw.tactics.board.get(s.id)?.order.kind ?? '?'));
  }
  return out.join(' ');
});
console.log('⑧ 护工队命令 :', kinds);
console.log('⑨ 无 flank 旁路 :', /:(flank|press)/.test(kinds) ? 'FAIL ' + kinds : 'PASS');
await browser.close();
