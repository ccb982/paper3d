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
    const tks = [];
    for (const [uid, m2] of s.members) {
      const t = c.memberTasks.taskOf(uid);
      if (!t) { tn++; tks.push('-'); continue; }
      const k = pieceKindNear(t.x, t.z);
      if (k === 'cover') tc++; else if (k === 'trench') tt++; else tn++;
      tks.push(`${Math.round(t.x)},${Math.round(t.z)}`);
    }
    const fidx = c.corps.focus.get(s.id);
    const aidx = c.corps.assign.get(s.id);
    builders.push({
      id: s.id, role: c.builderRoles.get(s.id) ?? '?', n: s.members.size,
      focus: fidx !== undefined && c.buildPieces[fidx] ? c.buildPieces[fidx].kind : '-',
      assign: aidx !== undefined && aidx >= 0 && c.buildPieces[aidx]
        ? `${aidx}:${c.buildPieces[aidx].kind}${c.corps.built.has(`${c.buildPieces[aidx].x},${c.buildPieces[aidx].z}`) ? '*built' : ''}${c.corps.gated(c.buildPieces[aidx]) ? '*gated' : ''}` : '-',
      taskCover: tc, taskTrench: tt, taskNone: tn,
      tasks: tks.join('|'),
    });
  }
  // ★ 施工可达证据：成员→自己任务距离 / 成员→最近未建未锁件距离（<5m construct 才动手）
  const reach = { dTMax: 0, dTMean: 0, dPMean: 0, dPMin: 1e9, n: 0 };
  {
    let tSum = 0, tN = 0, pSum = 0, pN = 0;
    for (const s of sw.squads.all()) {
      if (!s.builders) continue;
      for (const [uid, m2] of s.members) {
        const t = c.memberTasks.taskOf(uid);
        if (t) {
          const d = Math.hypot(t.x - m2.x, t.z - m2.z);
          tSum += d; tN++;
          if (d > reach.dTMax) reach.dTMax = d;
        }
        let bp = 1e9;
        for (const q of c.buildPieces) {
          if (c.corps.built.has(`${q.x},${q.z}`)) continue;
          if (c.corps.gated(q)) continue;
          const d2 = Math.hypot(q.x - m2.x, q.z - m2.z);
          if (d2 < bp) bp = d2;
        }
        pSum += bp; pN++;
        if (bp < reach.dPMin) reach.dPMin = bp;
      }
    }
    reach.dTMean = tN ? +(tSum / tN).toFixed(1) : 0;
    reach.dTMax = +reach.dTMax.toFixed(1);
    reach.dPMean = pN ? +(pSum / pN).toFixed(1) : 0;
    reach.dPMin = reach.dPMin > 1e8 ? -1 : +reach.dPMin.toFixed(1);
    reach.n = tN;
  }
  const cds = [];
  for (const s of sw.squads.all()) {
    if (!s.builders) continue;
    cds.push(`${s.id}:${(c.buildCds.get(s.id) ?? 0).toFixed(1)}`);
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
    coarse: { ...sw.commander.coarseDbg, ledgerAdj: sw.cmdLog.adjustedUnreachable | 0 },
    navDbg: sw.navDbg ?? null,
    taskNavDbg: sw.memberNavDbg ?? null,
    stepDbg: sw.leaderAI?.stepDbg ?? null,
    fg: sw.commander.frontGate, shX: 30, shZ: 30,
    entStillMax: window.__entStillMax | 0,
    drops: sw.orderDrops | 0,
    pStack: (() => { let m = 0; const g = new Map(); for (const t of sw.commander.protectAssign.values()) { const k = `${t.x | 0},${t.z | 0}`; const n = (g.get(k) ?? 0) + 1; g.set(k, n); if (n > m) m = n; } return m; })(),
    pObj: sw.commander.protectAssign.size,
    pri: priBuilt.join(' '), passes: c.digPasses.size,
    builders, ranged, coverHolders: c.coverHolders.size,
    reach, cds: cds.join(' '), monFlips: window.__taskMonFlips | 0,
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
      // ★ P1-3 寻路亲和：同格同掩体，只差兵种亲和 → 关格 defense 应比 assault 便宜、高格 ranged 应比 assault 便宜
      if (CH && HH) {
        const pd = c.pathMulFor('defense', CH.x, CH.z), pa = c.pathMulFor('assault', CH.x, CH.z);
        const pr = c.pathMulFor('ranged', HH.x, HH.z), pa2 = c.pathMulFor('assault', HH.x, HH.z);
        chk.寻路关 = `${pd < pa ? '✓' : '✗'}D${pd.toFixed(2)}<A${pa.toFixed(2)}`;
        chk.寻路高 = `${pr < pa2 ? '✓' : '✗'}R${pr.toFixed(2)}<A${pa2.toFixed(2)}`;
      }
      let dPar = 0, dFresh = 0, worst = null;
      for (let i = 0; i < cells.length; i += 5) {
        const e = cells[i];
        const s0 = t.scoreAt(e.x, e.z);
        const sPar = c.scoreMixedAt(e.x, e.z);
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
          lp: { x: +t.bakedPlayer().x.toFixed(1), z: +t.bakedPlayer().z.toFixed(1) },
          pm: { x: +px.toFixed(1), z: +pz.toFixed(1) },
        } : null,
      };
    })(),
    // ★ L3 接线后观察：各兵种站位质心特征（h̄/玩家距̄/隘口率——分化肉眼项）
    byType: (() => {
      const t = c.terrainScore, px = pm.x, pz = pm.z;
      const acc = {};
      for (const s of sw.squads.all()) {
        if (s.members.size === 0) continue;
        let cx = 0, cz = 0, n = 0;
        for (const m of s.members.values()) { cx += m.x; cz += m.z; n++; }
        const f = t.featsAt(cx / n, cz / n, px, pz);
        if (!f) continue;
        const a = (acc[s.type] ||= { n: 0, h: 0, dP: 0, ch: 0 });
        a.n++; a.h += f.h; a.dP += f.playerD; a.ch += f.choke;
      }
      for (const k2 of Object.keys(acc)) {
        const a = acc[k2];
        a.h = +(a.h / a.n).toFixed(1); a.dP = +(a.dP / a.n).toFixed(0); a.ch = +(a.ch / a.n).toFixed(2);
      }
      return acc;
    })(),
    // ★ 掩体校验（队长真源 debugHasCover）：防守/驻守队成员"真被遮挡"比例
    covCheck: (() => {
      const px = pm.x, pz = pm.z;
      let gar = 0, tot = 0, cov = 0;
      for (const s of sw.squads.all()) {
        if (s.members.size === 0) continue;
        const st2 = sw.tactics.board.get(s.id);
        const kind = st2?.order?.kind ?? '';
        if (kind !== 'garrison' && kind !== 'protect') continue;
        gar++;
        for (const m of s.members.values()) {
          tot++;
          if (c.debugHasCover(px, pz, m.x, m.z)) cov++;
        }
      }
      return { gar, tot, cov };
    })(),
    // ★ 转圈指数（工兵）：跨快照累计路径长/净位移 + 成员任务目标翻转次数
    bTrack: (() => {
      const trk = window.__bTrk || (window.__bTrk = new Map());
      let pathSum = 0, netSum = 0, flips = 0, n = 0;
      for (const s of sw.squads.all()) {
        if (!s.builders || s.members.size === 0) continue;
        for (const [uid, m] of s.members) {
          const t = c.memberTasks.taskOf(uid);
          const tk = t ? `${t.x},${t.z}` : '-';
          let o = trk.get(uid);
          if (!o) { trk.set(uid, { x: m.x, z: m.z, sx: m.x, sz: m.z, path: 0, tk, flips: 0, snaps: 0 }); continue; }
          o.path += Math.hypot(m.x - o.x, m.z - o.z);
          o.x = m.x; o.z = m.z; o.snaps++;
          if (tk !== o.tk) { o.flips++; o.tk = tk; }
          if (o.snaps >= 3) {
            pathSum += o.path;
            netSum += Math.hypot(o.x - o.sx, o.z - o.sz);
            flips += o.flips;
            n++;
          }
        }
      }
      return n ? { n, path: +pathSum.toFixed(1), net: +netSum.toFixed(1), ratio: +(pathSum / Math.max(netSum, 0.1)).toFixed(1), flips } : null;
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
  // ★ 高频任务翻转监控（400ms；15s 快照会漏掉 2s 级抖动）
  await page.evaluate(() => {
    window.__taskMonFlips = 0;
    const c = window.__commander, sw = window.__swarm;
    const prev = new Map();
    setInterval(() => {
      for (const s of sw.squads.all()) {
        if (!s.builders) continue;
        for (const [uid] of s.members) {
          const t = c.memberTasks.taskOf(uid);
          const k = t ? `${t.x},${t.z}` : '-';
          if (prev.has(uid) && prev.get(uid) !== k) window.__taskMonFlips++;
          prev.set(uid, k);
        }
      }
    }, 400);
  });
  const run = async (ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) await page.evaluate((a, b) => window.__ppRun(a, b), 8, 0.1);
  };
  console.log(`\n===== seed ${seed} =====`);
  for (let k = 0; k < 4; k++) {
    await run(15000);
    const s = await snapPage(page);
    const B = s.builders.map((b) => `${b.id}:${b.role}[f=${b.focus},a=${b.assign},tc=${b.taskCover},tt=${b.taskTrench},tn=${b.taskNone}]t=[${b.tasks}]`).join(' ');
    const R = s.ranged.map((r) => `#${r.id}:${r.kind}/${r.src} dP=${r.dPlayer} dF=${r.dFront}`).join(' ');
    const c = s.cmd; const kinds = Object.entries(c.kinds).map(([k, v]) => `${k}:${v}`).join(' ');
    console.log(`T+${(k + 1) * 15}s stage=${s.stage} ${s.posture} p=${s.p} alive=${s.alive} recalled=${s.recalled} ent=${s.ent} pool=${s.pool} 回收=${s.dbgR}/追踪=${s.dbgT} pri=${s.pri} passes=${s.passes} holders=${s.coverHolders}`);
    console.log(`   命令台账 引擎=${c.engine} 队长=${c.leader} 唯一=${c.unique}/${c.total} 比=${c.engine ? (c.unique / c.engine).toFixed(2) : '-'} 进度=${c.progress} 种类[${kinds}]`);
    const sd = s.stepDbg;
    if (sd) {
      const last = Object.entries(sd.last ?? {}).map(([sid, e]) => `#${sid}:${e.ev} ${e.k}/${e.n} dS=${e.dS} dA=${e.dA}`).join(' ');
      console.log(`   队长拆步 发步=${sd.issued} 到点=${sd.reached} 完成=${sd.done} 选格失败=${sd.pickFail} | ${last}`);
    }
    const cg = s.coarse;
    if (cg) console.log(`   可达核验(P2) checked=${cg.checked} 调账=${cg.adjusted}(台账${cg.ledgerAdj}) 拦截=${cg.skipped} 预热放行=${cg.unknown}`);
    const nd = s.navDbg, md = s.taskNavDbg;
    if (nd && md) console.log(`   重规划(白名单P4) 队路径=${nd.solves}(HPA${nd.hpa}/A*${nd.astar}/coarse${nd.coarse}/失败${nd.fail}) 任务走廊=${md.solves}(偏离重解${md.deviations}/直行复核${md.rechecks}/失败${md.fails})`);
    // ★ 事态闸门核验：任何命令目标不得比允许离舰半径更近（稳步推进、不一上来冲家）
    let over = 0;
    for (const e of s.cmdAll) {
      const d = Math.hypot(e.tx - s.shX, e.tz - s.shZ);
      if (d < s.fg.minD - 0.5) over++;
    }
    console.log(`   事态闸门 frontP=${+s.fg.frontP.toFixed(3)} 允许离舰=${+s.fg.minD.toFixed(1)}m 越界命令=${over}/队 实体停滞=${s.entStillMax}s 到期回落=${s.drops} 保护堆挤=${s.pStack}/锚(对象${s.pObj})`);
    for (const e of s.cmdRear) console.log(`   cmd #${e.squadId} ${e.kind}${e.mission ? '(' + e.mission + ')' : ''} @${+e.tx.toFixed(0)},${+e.tz.toFixed(0)} ${e.source} ttl=${e.ttl} (x${e.n})`);
    console.log(`        工兵: ${B || '(无)'}`);
    console.log(`        可达 dT均=${s.reach.dTMean}m dTmax=${s.reach.dTMax}m dP均=${s.reach.dPMean}m dPmin=${s.reach.dPMin}m(施工<5m) cd=[${s.cds}] 高频翻转=${s.monFlips}`);
    if (s.bTrack) console.log(`        转圈 n=${s.bTrack.n} 路径=${s.bTrack.path}m 净移=${s.bTrack.net}m 比=${s.bTrack.ratio} 任务翻转=${s.bTrack.flips}`);
    console.log(`        远程: ${R || '(无)'}`);
    if (k === 3) {
      const st = s.strat;
      console.log(`   L3 窗内=${st.n}格 parityΔ=${st.dPar}(快照权重,断言<0.01) 态势陈旧Δ=${st.dFresh}(陈旧度指标:lastW+player vs 实时liveWeights+实时player,非parity口径,仅观测不断言)`);
      if (st.worst) console.log(`   最差格 ${JSON.stringify(st.worst)} w=${JSON.stringify(st.w)}`);
      console.log(`   冠军格 ${st.heroes}`);
      console.log(`   矩阵(关高掩后) 盾[${st.matrix.defense}] 突[${st.matrix.assault}] 远[${st.matrix.ranged}] 后[${st.matrix.logistics}]`);
      console.log(`   判定 ${Object.entries(st.chk).map(([k2, v]) => `${k2}=${v}`).join('  ')}`);
      const bt = Object.entries(s.byType).map(([k2, a]) => `${k2}×${a.n}[h̄${a.h} dP̄${a.dP} K̄${a.ch}]`).join(' ');
      console.log(`   站位 ${bt}`);
      const cc = s.covCheck;
      console.log(`   掩体校验(队长真源) 驻守/防守队=${cc.gar} 成员覆盖=${cc.cov}/${cc.tot}${cc.tot ? ` (${(cc.cov / cc.tot * 100).toFixed(0)}%)` : ''}`);
      const bt2 = s.bTrack;
      if (bt2) console.log(`   转圈指数(工兵) n=${bt2.n} 路径=${bt2.path}m 净移=${bt2.net}m 比=${bt2.ratio} 任务翻转=${bt2.flips}`);
    }
  }
  await page.close();
}
await browser.close();
