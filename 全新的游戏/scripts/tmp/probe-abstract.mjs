// 短局观察（每局 ~1 分钟自然推进）：工兵分工/施工 vs 远程驻守是否"抽象"
// 用法：node scripts/tmp/probe-abstract.mjs [seed1 seed2 ...]
import puppeteer from 'puppeteer-core';
const SEEDS = process.argv.slice(2).map(Number).filter((n) => n > 0);
const seeds = SEEDS.length ? SEEDS : [4242, 7, 99];
const grid = (r, c) => Array.from({ length: r }, () => Array(c).fill(null));
const makeSession = (seed) => ({ meta: { version: '0.2.0', day: 1, seed, totalDaysSurvived: 0, deaths: 0, createdAt: '', lastSavedAt: '' }, player: { hp: 100, maxHp: 100, attackPower: 10, defense: 2, ammo: { default: 150 }, slots: Array(12).fill(null) }, inventories: { base: grid(30, 30), ship: grid(8, 10), player: grid(4, 6) }, ship: { hp: 1e6, maxHp: 1e6, shield: 2e5, armor: 999, fuel: 60, fuelMax: 60, position: { x: 30, z: 30 }, techTree: [], turrets: [] }, gacha: { pityCounter: 0, totalPulls: 0, bossPity: 0 }, dayProgress: { hasDepartedToday: false }, outOfRun: { owned: {} }, story: { flags: {}, events: {} } });
const browser = await puppeteer.launch({ executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe', headless: 'new', protocolTimeout: 6e5, args: ['--no-sandbox', '--disable-gpu-sandbox'] });

const snapPage = (page) => page.evaluate(() => {
  const c = window.__commander, sw = window.__swarm;
  const key = (p) => p.x + ',' + p.z;
  const pieceKindNear = (x, z) => {
    let best = '?', bd = 36;
    for (const p of c.buildPieces) {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) { bd = d; best = p.kind; }
    }
    return best;
  };
  const priBuilt = [0, 0, 0, 0].map((_, pri) => {
    const list = c.buildPieces.filter((p) => p.pri === pri);
    return `${list.filter((p) => c.builtSlots.has(key(p))).length}/${list.length}`;
  });
  const builders = [];
  for (const s of sw.squads.all()) {
    if (!s.builders) continue;
    let tc = 0, tt = 0, tn = 0;
    for (const uid of s.members.keys()) {
      const t = c.memberTasks.taskOf(uid);
      if (!t) { tn++; continue; }
      const k = pieceKindNear(t.x, t.z);
      if (k === 'cover') tc++; else if (k === 'trench') tt++; else tn++;
    }
    const fidx = c.corps.focus.get(s.id);
    builders.push({
      id: s.id, role: c.builderRoles.get(s.id) ?? '?', n: s.members.size,
      focus: fidx !== undefined && c.buildPieces[fidx] ? c.buildPieces[fidx].kind : '-',
      taskCover: tc, taskTrench: tt, taskNone: tn,
    });
  }
  const front = { x: c.plan.cx + c.plan.approachX * 40, z: c.plan.cz + c.plan.approachZ * 40 };
  const pm = window.__ppMode().player.position;
  const ranged = [];
  for (const s of sw.squads.all()) {
    if (s.type !== 'ranged' || s.builders || s.members.size === 0) continue;
    let cx = 0, cz = 0, n = 0;
    for (const m of s.members.values()) { cx += m.x; cz += m.z; n++; }
    cx /= n; cz /= n;
    const st = sw.tactics.board.get(s.id);
    ranged.push({
      id: s.id, kind: st?.order.kind ?? '-',
      src: c.protectAssign.get(s.id)?.source ?? 'none',
      dPlayer: +Math.hypot(cx - pm.x, cz - pm.z).toFixed(0),
      dFront: +Math.hypot(cx - front.x, cz - front.z).toFixed(0),
    });
  }
  return {
    stage: c.stage, posture: c.battlePosture, p: +c.postureP.toFixed(2),
    alive: sw.ledger.alive, recalled: sw.ledger.recalled,
    ent: window.__ppMode().enemies.length, pool: sw.pool.count,
    dbgR: sw.stuckDbg.recycled, dbgT: sw.stuckDbg.tracked,
    cmd: sw.cmdLog.snap(), cmdRear: sw.cmdLog.latestPerSquad(10), cmdAll: sw.cmdLog.latestPerSquad(80),
    fg: sw.commander.frontGate, shX: 30, shZ: 30,
    entStillMax: window.__entStillMax | 0,
    pri: priBuilt.join(' '), passes: c.digPasses.size,
    builders, ranged, coverHolders: c.coverHolders.size,
  };
});

for (const seed of seeds) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log(`[seed ${seed} pageerror]`, String(e).slice(0, 160)));
  await page.evaluateOnNewDocument((s) => localStorage.setItem('arknights_rogue_save', JSON.stringify(s)), makeSession(seed));
  await page.goto(`http://localhost:5173/?perf=1&swarmdbg=1&seed=${seed}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction('!!window.__ppEnterWorld', { timeout: 120000 });
  await new Promise((r) => setTimeout(r, 2000));
  await page.evaluate(() => window.__ppEnterWorld());
  await new Promise((r) => setTimeout(r, 4000));
  await page.evaluate(() => window.__ppMode().finishDock());
  await page.waitForFunction('!!window.__commander', { timeout: 120000 });
  const run = async (ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) await page.evaluate((a, b) => window.__ppRun(a, b), 8, 0.1);
  };
  console.log(`\n===== seed ${seed} =====`);
  for (let k = 0; k < 4; k++) {
    await run(15000);
    const s = await snapPage(page);
    const B = s.builders.map((b) => `${b.id}:${b.role}[f=${b.focus},tc=${b.taskCover},tt=${b.taskTrench},tn=${b.taskNone}]`).join(' ');
    const R = s.ranged.map((r) => `#${r.id}:${r.kind}/${r.src} dP=${r.dPlayer} dF=${r.dFront}`).join(' ');
    const c = s.cmd; const kinds = Object.entries(c.kinds).map(([k, v]) => `${k}:${v}`).join(' ');
    console.log(`T+${(k + 1) * 15}s stage=${s.stage} ${s.posture} p=${s.p} alive=${s.alive} recalled=${s.recalled} ent=${s.ent} pool=${s.pool} 回收=${s.dbgR}/追踪=${s.dbgT} pri=${s.pri} passes=${s.passes} holders=${s.coverHolders}`);
    console.log(`   命令台账 引擎=${c.engine} 队长=${c.leader} 唯一=${c.unique}/${c.total} 种类[${kinds}]`);
    // ★ 事态闸门核验：任何命令目标不得比允许离舰半径更近（稳步推进、不一上来冲家）
    let over = 0;
    for (const e of s.cmdAll) {
      const d = Math.hypot(e.tx - s.shX, e.tz - s.shZ);
      if (d < s.fg.minD - 0.5) over++;
    }
    console.log(`   事态闸门 frontP=${+s.fg.frontP.toFixed(3)} 允许离舰=${+s.fg.minD.toFixed(1)}m 越界命令=${over}/队 实体停滞=${s.entStillMax}s`);
    for (const e of s.cmdRear) console.log(`   cmd #${e.squadId} ${e.kind}${e.mission ? '(' + e.mission + ')' : ''} @${+e.tx.toFixed(0)},${+e.tz.toFixed(0)} ${e.source} ttl=${e.ttl} (x${e.n})`);
    console.log(`        工兵: ${B || '(无)'}`);
    console.log(`        远程: ${R || '(无)'}`);
  }
  await page.close();
}
await browser.close();
