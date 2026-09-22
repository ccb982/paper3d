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
    drops: sw.orderDrops | 0,
    pStack: (() => { let m = 0; const g = new Map(); for (const t of sw.commander.protectAssign.values()) { const k = `${t.x | 0},${t.z | 0}`; const n = (g.get(k) ?? 0) + 1; g.set(k, n); if (n > m) m = n; } return m; })(),
    pObj: sw.commander.protectAssign.size,
    pri: priBuilt.join(' '), passes: c.digPasses.size,
    builders, ranged, coverHolders: c.coverHolders.size,
    // ★ L3 兵种分分化（重构 P1）：特征冠军格×四兵种矩阵 + 与 scoreAt parity
    strat: (() => {
      const t = c.terrainScore, px = pm.x, pz = pm.z;
      const types = ['defense', 'assault', 'ranged', 'logistics'];
      const bx = c.plan.cx + c.plan.approachX * 20, bz = c.plan.cz + c.plan.approachZ * 20;
      const cells = [];
      for (let dz = -70; dz <= 70; dz += 4) for (let dx = -70; dx <= 70; dx += 4) {
        const x = bx + dx, z = bz + dz;
        const f = t.featsAt(x, z, px, pz);
        if (f && f.pass) cells.push({ x, z, f });
      }
      const champ = (key, better) => {
        let best = null;
        for (const e of cells) {
          const v = key(e.f);
          if (best === null || better(v, key(best.f))) best = e;
        }
        return best;
      };
      const CH = champ((f) => f.choke, (a, b) => a > b);
      const HH = champ((f) => f.h, (a, b) => a > b);
      const CO = champ((f) => f.cover, (a, b) => a > b);
      const RR = champ((f) => f.playerD, (a, b) => a > b);   // 后区 := 远离接敌处（设计 §1.4）
      const heroes = [['关', CH], ['高', HH], ['掩', CO], ['远敌', RR]];
      const matrix = {};
      for (const ty of types) {
        matrix[ty] = heroes.map(([, e]) => (e ? +c.scoreForType(ty, e.x, e.z, px, pz).toFixed(2) : null));
      }
      const d = (ty, i) => matrix[ty][i];
      const diffI = (a, b, i) => { const v = d(a, i) - d(b, i); return `${v >= 0 ? '✓' : '✗'}${v.toFixed(1)}`; };
      const chk = {
        盾突关: diffI('defense', 'assault', 0),
        远突高: diffI('ranged', 'assault', 1),
        盾突掩: diffI('defense', 'assault', 2),
        后突远: diffI('logistics', 'assault', 3),
      };
      let dPar = 0, dFresh = 0, worst = null;
      for (let i = 0; i < cells.length; i += 5) {
        const e = cells[i];
        const s0 = t.scoreAt(e.x, e.z);
        const sPar = c.scoreMixedAt(e.x, e.z, px, pz);
        if (s0 !== null && sPar !== null) {
          const dd = Math.abs(s0 - sPar);
          if (dd > dPar) { dPar = dd; worst = { x: e.x, z: e.z, s0, sPar, f: e.f }; }
        }
        if (s0 !== null) dFresh = Math.max(dFresh, Math.abs(s0 - c.scoreForType('mixed', e.x, e.z, px, pz)));
      }
      const feat = (e) => (e ? `${e.x | 0},${e.z | 0}${e.f.choke ? 'K' : ''}${e.f.cover >= 1 ? 'C' : ''}${e.f.trench ? 'T' : ''}W${e.f.width.toFixed(2)}h${e.f.h.toFixed(1)}` : '-');
      return {
        n: cells.length, dPar: +dPar.toFixed(4), dFresh: +dFresh.toFixed(2),
        heroes: heroes.map(([nm, e]) => `${nm}[${feat(e)}]`).join(' '),
        matrix, chk,
        w: t.weightsSnapshot(),
        worst: worst ? {
          x: +worst.x.toFixed(1), z: +worst.z.toFixed(1),
          s0: +worst.s0.toFixed(3), sPar: +worst.sPar.toFixed(3),
          h: +worst.f.h.toFixed(2), shipD: +worst.f.shipD.toFixed(2), nearF: +worst.f.nearF.toFixed(2),
          th: +worst.f.threatN.toFixed(2), cv: +worst.f.cover.toFixed(2), wd: +worst.f.width.toFixed(2),
          ch: worst.f.choke, tr: worst.f.trench, ct: +worst.f.constTerm.toFixed(2),
          dP: +worst.f.playerD.toFixed(1),
        } : null,
      };
    })(),
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
    console.log(`   命令台账 引擎=${c.engine} 队长=${c.leader} 唯一=${c.unique}/${c.total} 比=${c.engine ? (c.unique / c.engine).toFixed(2) : '-'} 种类[${kinds}]`);
    // ★ 事态闸门核验：任何命令目标不得比允许离舰半径更近（稳步推进、不一上来冲家）
    let over = 0;
    for (const e of s.cmdAll) {
      const d = Math.hypot(e.tx - s.shX, e.tz - s.shZ);
      if (d < s.fg.minD - 0.5) over++;
    }
    console.log(`   事态闸门 frontP=${+s.fg.frontP.toFixed(3)} 允许离舰=${+s.fg.minD.toFixed(1)}m 越界命令=${over}/队 实体停滞=${s.entStillMax}s 到期回落=${s.drops} 保护堆挤=${s.pStack}/锚(对象${s.pObj})`);
    for (const e of s.cmdRear) console.log(`   cmd #${e.squadId} ${e.kind}${e.mission ? '(' + e.mission + ')' : ''} @${+e.tx.toFixed(0)},${+e.tz.toFixed(0)} ${e.source} ttl=${e.ttl} (x${e.n})`);
    console.log(`        工兵: ${B || '(无)'}`);
    console.log(`        远程: ${R || '(无)'}`);
    if (k === 3) {
      const st = s.strat;
      console.log(`   L3 窗内=${st.n}格 parityΔ=${st.dPar}(快照权重,断言<0.01) 态势陈旧Δ=${st.dFresh}`);
      if (st.worst) console.log(`   最差格 ${JSON.stringify(st.worst)} w=${JSON.stringify(st.w)}`);
      console.log(`   冠军格 ${st.heroes}`);
      console.log(`   矩阵(关高掩后) 盾[${st.matrix.defense}] 突[${st.matrix.assault}] 远[${st.matrix.ranged}] 后[${st.matrix.logistics}]`);
      console.log(`   判定 ${Object.entries(st.chk).map(([k2, v]) => `${k2}=${v}`).join('  ')}`);
    }
  }
  await page.close();
}
await browser.close();
