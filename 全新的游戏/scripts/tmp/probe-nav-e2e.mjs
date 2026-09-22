// 手动发令 e2e v3：不冻结大队（保留增援）；2s 重发手动令压过周期令；追到达/轨迹
// 用法：node scripts/tmp/probe-nav-e2e.mjs [seed]
import puppeteer from 'puppeteer-core';
const seed = +(process.argv[2] || 4242);
const grid = (r, c) => Array.from({ length: r }, () => Array(c).fill(null));
const makeSession = (seed) => ({ meta: { version: '0.2.0', day: 1, seed, totalDaysSurvived: 0, deaths: 0, createdAt: '', lastSavedAt: '' }, player: { hp: 100, maxHp: 100, attackPower: 10, defense: 2, ammo: { default: 150 }, slots: Array(12).fill(null) }, inventories: { base: grid(30, 30), ship: grid(8, 10), player: grid(4, 6) }, ship: { hp: 1e6, maxHp: 1e6, shield: 2e5, armor: 999, fuel: 60, fuelMax: 60, position: { x: 30, z: 30 }, techTree: [], turrets: [] }, gacha: { pityCounter: 0, totalPulls: 0, bossPity: 0 }, dayProgress: { hasDepartedToday: false }, outOfRun: { owned: {} }, story: { flags: {}, events: {} } });
const browser = await puppeteer.launch({ executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 6e5, args: ['--no-sandbox', '--disable-gpu-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 160)));
await page.evaluateOnNewDocument((s) => localStorage.setItem('arknights_rogue_save', JSON.stringify(s)), makeSession(seed));
await page.goto(`http://localhost:5173/?perf=1&swarmdbg=1&seed=${seed}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('!!window.__ppEnterWorld', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2000));
await page.evaluate(() => window.__ppEnterWorld());
await new Promise((r) => setTimeout(r, 4000));
await page.evaluate(() => window.__ppMode().finishDock());
await page.waitForFunction('!!window.__commander', { timeout: 120000 });
await new Promise((r) => setTimeout(r, 20000));   // 等编制成型

const setup = await page.evaluate(() => {
  const c = window.__commander, sw = window.__swarm;
  const plan = c.plan;
  if (!plan) return { tasks: [], nSquads: 0, nHighs: 0, note: 'plan 未就绪' };
  const highs = plan.highGround.map((g) => ({ x: +g.x.toFixed(0), z: +g.z.toFixed(0), h: +g.h.toFixed(1) }));
  const cent = (s) => { let x = 0, z = 0, n = 0; for (const m of s.members.values()) { x += m.x; z += m.z; n++; } return n ? { x: x / n, z: z / n } : null; };
  const squads = [...sw.squads.all()].filter((s) => s.type !== 'flyer' && s.members.size >= 3);
  const tasks = [];
  for (const s of squads.slice(0, 3)) {
    const c0 = cent(s);
    if (!c0) continue;
    let best = null, bd = 1e9;
    for (const g of highs) {
      const d = Math.hypot(g.x - c0.x, g.z - c0.z);
      if (d >= 30 && d <= 110 && d < bd) { bd = d; best = g; }
    }
    if (best) tasks.push({ id: s.id, uid0: [...s.members.keys()][0], sx: +c0.x.toFixed(0), sz: +c0.z.toFixed(0), tx: best.x, tz: best.z, th: best.h });
  }
  return { tasks, nSquads: squads.length, nHighs: highs.length };
});
console.log(`\n== 手动发令 e2e v3 seed=${seed} ==`);
console.log(`   队=${setup.nSquads} 高地=${setup.nHighs} ${setup.note ?? ''}`);
for (const t of setup.tasks) console.log(`   命令 #${t.id}: (${t.sx},${t.sz}) → 高地(${t.tx},${t.tz}) h=${t.th}`);
// ★ 测试保真：封大队所有周期发令（issueChecked 门挡），手动令走 issueOrder 直发；
//   大队其余（增援/工兵/掩体/结算）照常
await page.evaluate(() => { window.__commander.issueChecked = () => false; });

const reissue = () => page.evaluate((tasks) => {
  for (const t of tasks) window.__swarm.issueOrder(t.id, { kind: 'advance', target: { x: t.tx, z: t.tz }, seq: 0 }, 30);
}, setup.tasks);
const run = async (ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) await page.evaluate((a, b) => window.__ppRun(a, b), 8, 0.05); };
const trace = [];
const traj = setup.tasks.map(() => []);
for (let k = 0; k < 12; k++) {
  for (let j = 0; j < 2; j++) { await reissue(); await run(3000); }
  const st = await page.evaluate((tasks) => {
    const sw = window.__swarm;
    const rows = tasks.map((t) => {
      const s = sw.squads.get(t.id);
      if (!s) {
        const sq2 = sw.squads.squadOf(t.uid0);
        return { id: t.id, gone: true, to: sq2 ? `并入#${sq2.id}` : '离场' };
      }
      let x = 0, z = 0, n = 0;
      for (const m of s.members.values()) { x += m.x; z += m.z; n++; }
      if (!n) return { id: t.id, gone: true, to: '空' };
      const d = Math.hypot(t.tx - x / n, t.tz - z / n);
      const b = sw.tactics.board.get(t.id);
      return { id: t.id, x: +(x / n).toFixed(1), z: +(z / n).toFixed(1), d: +d.toFixed(0), sym: s.members.size, path: b?.order.path?.length ?? 0, kind: b?.order.kind ?? '-' };
    });
    const L = sw.ledger;
    return { rows, blocked: sw.feasDbg.blocked, adj: sw.cmdLog.adjustedUnreachable, L: { kills: L.kills, recalled: L.recalled } };
  }, setup.tasks);
  trace.push(st);
  st.rows.forEach((r, i) => { if (!r.gone) traj[i].push([r.x, r.z]); });
  console.log(
    `T+${(k + 1) * 6}s ` + st.rows.map((r) => r.gone ? `#${r.id}→${r.to}` : `#${r.id} d=${r.d}m sym=${r.sym} path=${r.path} ${r.kind}`).join(' | ')
    + ` ‖ blocked=${st.blocked} 调账=${st.adj} | killed=${st.L.kills} recall=${st.L.recalled}`,
  );
}
const last = trace[trace.length - 1];
const arr = last.rows.filter((r) => !r.gone && r.d <= 8).length;
console.log(`\n== 到达(≤8m) ${arr}/${setup.tasks.length} ==`);
for (let i = 0; i < setup.tasks.length; i++) {
  const p = traj[i];
  let len = 0, stall = 0;
  for (let k = 1; k < p.length; k++) {
    const ds = Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]);
    len += ds;
    if (ds < 0.5) stall++;
  }
  const net = p.length > 1 ? Math.hypot(p[p.length - 1][0] - p[0][0], p[p.length - 1][1] - p[0][1]) : 0;
  const mins = Math.min(...trace.map((t) => { const r = t.rows[i]; return r.gone ? 1e9 : r.d; }));
  const end = last.rows[i];
  console.log(`   #${setup.tasks[i].id} 最近=${mins === 1e9 ? '未达' : mins + 'm'} 终态=${end.gone ? end.to : end.d + 'm'} | 轨迹 路径=${len.toFixed(0)}m 净移=${net.toFixed(0)}m 比=${net > 0.5 ? (len / net).toFixed(1) : '∞'} 停滞=${stall}/${p.length}`);
}
await page.close();
await browser.close();
