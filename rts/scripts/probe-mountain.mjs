// ============================================================
// probe-mountain —— 山地寻路探针（用户手测口：高原舰船 ← 低地敌军，强制移动令）
// 用法：npm run probe:mountain              （扫种子挑地形 → 进世界实测）
//       SCAN_ONLY=1 npm run probe:mountain  （只扫地形，打印候选）
//   环境：RTS_URL / CHROME_PATH / SEEDS（默认一串）/ SEED（指定则跳过扫描）/ LOW=x,z / ENTER=x,z
//         SPEED / NEST / ARRIVE_R / TIMEOUT_SIM
// 口径：
//   · 扫描在选点阶段（raster 纯生成，无素材/3D）——每种子找"高+平"点与"低+平"点，距 110~200m
//   · 进世界入口 = 高原（舰船/世界中心）；敌军 placeEnemyAt 低地放 NEST 窝 → 选中 → forceMoveSelectionTo(舰船)
//   · 到达 = 距舰 < ARRIVE_R；回收 = 账本 recalled 增量 + stuckDbg.recycled 累计（含现场原因）
//   · 时间 = 模拟秒（sim ≈ wall × SPEED）
// ============================================================
import puppeteer from 'puppeteer-core';

const RTS_URL = process.env.RTS_URL ?? 'http://localhost:5175/';
const CHROME_PATH = process.env.CHROME_PATH ?? 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe';
const SEEDS = (process.env.SEEDS ?? '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,42,99,123,777,2024').split(',').map(Number);
const FIXED_SEED = process.env.SEED ? Number(process.env.SEED) : null;
const LOW = process.env.LOW ? process.env.LOW.split(',').map(Number) : null;      // 低地 x,z（配合 SEED 跳过扫描）
const ENTER = process.env.ENTER ? process.env.ENTER.split(',').map(Number) : null; // 入口 x,z（默认=高原）
const SPEED = Math.max(1, Number(process.env.SPEED ?? 8));
const NEST = Math.max(1, Number(process.env.NEST ?? 3));
const SCAN_ONLY = process.env.SCAN_ONLY === '1';
const SCAN_HALF = Number(process.env.SCAN_HALF ?? 1500);   // 全局粗扫半径（找世界最高点）
const SCAN_STEP = Number(process.env.SCAN_STEP ?? 30);
const ZOOM_HALF = Number(process.env.ZOOM_HALF ?? 240);    // 山顶附近缩放半径
const ARRIVE_R = Number(process.env.ARRIVE_R ?? 12);
const TIMEOUT_SIM = Number(process.env.TIMEOUT_SIM ?? 400);

const CAMFAR = process.env.CAMFAR === '1';
const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: 'new', protocolTimeout: 3e5, args: ['--no-sandbox', '--disable-gpu-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errs = [];
page.on('pageerror', (e) => errs.push('[pageerror] ' + String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text().slice(0, 160)); });
console.log(`[装载] ${RTS_URL}（选点阶段扫地形）`);
await page.goto(RTS_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__rts?.phase === 'select' && window.__rts?.raster, { timeout: 180000, polling: 500 });

// ---------- 阶段 1：全局找山（粗扫最高点 → 缩放配对「山顶 ↔ 低地」） ----------
const scanOne = (seed) => page.evaluate(({ seed, half, step, zoomHalf, zoomStep }) => {
  const w = window.__rts;
  if (w.phase !== 'select') return { err: 'phase=' + w.phase };
  w.select.onSeed(seed);
  const r = window.__rts.raster;
  const CH = 60;
  const ensure = (x0, z0, h) => {
    for (let cx = Math.floor((x0 - h) / CH); cx <= Math.floor((x0 + h) / CH); cx++) {
      for (let cz = Math.floor((z0 - h) / CH); cz <= Math.floor((z0 + h) / CH); cz++) r.ensureData(cx, cz);
    }
  };
  const H = (x, z) => r.heightAt(x, z);
  const walk = (x, z) => { const role = r.tileDefAt(x, z).genRole; return role !== 'pit' && role !== 'liquid'; };
  // 粗扫：世界最高点
  ensure(0, 0, half);
  let mx = -1e9, mxAt = [0, 0];
  for (let x = -half; x <= half; x += step) for (let z = -half; z <= half; z += step) {
    const h = H(x, z); if (h > mx) { mx = h; mxAt = [x, z]; }
  }
  // 缩放：山顶附近找「顶（高+平）↔ 低地（低+平+可站）」
  const [mx0, mz0] = mxAt;
  ensure(mx0, mz0, zoomHalf);
  const cells = [];
  for (let x = mx0 - zoomHalf; x <= mx0 + zoomHalf; x += zoomStep) {
    for (let z = mz0 - zoomHalf; z <= mz0 + zoomHalf; z += zoomStep) {
      const h = H(x, z);
      let mn = h, mxh = h;
      for (let dx = -zoomStep; dx <= zoomStep; dx += zoomStep) for (let dz = -zoomStep; dz <= zoomStep; dz += zoomStep) {
        const v = H(x + dx, z + dz); if (v < mn) mn = v; if (v > mxh) mxh = v;
      }
      cells.push({ x, z, h, rel: mxh - mn, ok: walk(x, z) });
    }
  }
  const peakH = Math.max(...cells.map((c) => c.h));
  const minH = Math.min(...cells.filter((c) => c.ok).map((c) => c.h));
  const plateaus = cells.filter((c) => c.h >= peakH - 2.5 && c.rel <= 8);   // 锥顶 10m 内落差大，放宽
  const lows = cells.filter((c) => c.ok && c.h <= 0.5 && c.rel <= 2.5);    // 低地 = 近海平面平地
  const cands = [];
  for (const p of plateaus) for (const l of lows) {
    const d = Math.hypot(p.x - l.x, p.z - l.z);
    if (d < 110 || d > 200) continue;
    const dh = p.h - l.h;
    if (dh < 8) continue;
    const n = Math.max(2, Math.round(d / 5));
    let maxGrade = 0, wallSeg = 0, sumG = 0, prev = H(l.x, l.z);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const h = H(l.x + (p.x - l.x) * t, l.z + (p.z - l.z) * t);
      const g = Math.abs(h - prev) / 5;
      sumG += g; if (g > maxGrade) maxGrade = g; if (Math.abs(h - prev) > 3) wallSeg++;
      prev = h;
    }
    cands.push({
      lx: l.x, lz: l.z, lh: l.h, px: p.x, pz: p.z, ph: p.h, d: +d.toFixed(0), dh: +dh.toFixed(0),
      maxGrade: +maxGrade.toFixed(2), avgGrade: +(sumG / n).toFixed(3), wallSeg,
    });
  }
  cands.sort((a, b) => (b.dh - b.maxGrade * 5) - (a.dh - a.maxGrade * 5));
  const picked = [];
  for (const c of cands) {
    if (picked.some((p) => Math.hypot(p.px - c.px, p.pz - c.pz) < 40 || Math.hypot(p.lx - c.lx, p.lz - c.lz) < 40)) continue;
    picked.push(c);
    if (picked.length >= 3) break;
  }
  const profile = (c) => {
    const out = []; const n = Math.max(2, Math.round(c.d / 10));
    for (let i = 0; i <= n; i++) { const t = i / n; out.push(Math.round(H(c.lx + (c.px - c.lx) * t, c.lz + (c.pz - c.lz) * t))); }
    return out;
  };
  return { seed, peakAt: mxAt, peakH: +peakH.toFixed(1), lowH: +minH.toFixed(1), picked: picked.map((c) => ({ ...c, prof: profile(c) })) };
}, { seed, half: SCAN_HALF, step: SCAN_STEP, zoomHalf: ZOOM_HALF, zoomStep: 10 });

let best = null;
if (FIXED_SEED !== null && LOW && ENTER) {
  best = { seed: FIXED_SEED, lx: LOW[0], lz: LOW[1], px: ENTER[0], pz: ENTER[1] };
  console.log(`[指定] seed=${FIXED_SEED} 低(${LOW}) 山顶/入口(${ENTER})`);
} else {
  const seeds = FIXED_SEED !== null ? [FIXED_SEED] : SEEDS;
  for (const seed of seeds) {
    const s = await scanOne(seed);
    if (s.err) { console.log(`  seed ${seed} 跳过（${s.err}）`); continue; }
    if (!s.picked.length) { console.log(`  seed ${seed}: 峰(${s.peakAt}) 高${s.peakH}m 低${s.lowH}m · 无 110~200m 配对`); continue; }
    const top = s.picked[0];
    console.log(`  seed ${seed}: 峰(${s.peakAt}) 高${s.peakH}m 低${s.lowH}m · 配对 高差${top.dh}m 距${top.d}m 最大坡${top.maxGrade} 断崖段${top.wallSeg} · 低(${top.lx},${top.lz})${top.lh}m → 顶(${top.px},${top.pz})${top.ph}m`);
    const score = top.dh - top.maxGrade * 5;
    if (!best || score > best.score) best = { ...top, seed, score };
  }
  if (!best) { console.log('未找到候选（换 SEEDS）'); await browser.close(); process.exit(1); }
  console.log(`[选定] seed ${best.seed} · 低(${best.lx},${best.lz}) ${best.lh}m → 山顶(${best.px},${best.pz}) ${best.ph}m · 距${best.d}m 高差${best.dh}m · 最大坡${best.maxGrade} 断崖段${best.wallSeg}`);
  console.log(`  剖面 ${best.prof.join('/')}`);
}
if (SCAN_ONLY) { await browser.close(); process.exit(0); }

// ---------- 阶段 2：进世界（入口 = 高原） ----------
console.log(`[进世界] seed=${best.seed} 入口(${best.px},${best.pz})`);
await page.evaluate(({ seed, px, pz }) => {
  window.__rts.select.onSeed(seed);
  window.__rts.select.onConfirm(px, pz);
}, { seed: best.seed, px: best.px, pz: best.pz });
await page.waitForFunction(() => window.__rts?.phase === 'world' && window.__rts?.swarm, { timeout: 240000, polling: 500 });
console.log('[进世界] 就绪');

// ---------- 阶段 3：布场（舰船 = 高原中心 + 低地放敌 + 玩家强制令） ----------
const setup = await page.evaluate(({ px, pz, lx, lz, nest, camFar }) => {
  window.__camFar = camFar;
  const w = window.__rts;
  w.swarm.ledger.canSpawn = () => false;          // ★ 饿死引擎（手动放置走 force 不受限）
  w.swarm.commander.clampToRing = (x, z) => ({ x, z });   // ★ 关事态环夹取（隔离山地寻路）
  w.spawn.x = px; w.spawn.z = pz;
  if (window.__camFar) { w.cam.tx = px + 210; w.cam.tz = pz + 210; w.cam.dist = 60; w.cam.pitch = 1.05; }
  else { w.cam.tx = px; w.cam.tz = pz; w.cam.dist = 240; w.cam.pitch = 1.05; }
  if (w.ship) w.ship.position.set(px, w.raster.surfaceHeightAtFor(px, pz, 0), pz);
  const before = new Set(w.enemyMgr.list().map((h) => h.uid));
  let nests = 0;
  for (let i = 0; i < nest; i++) {
    const a = (i / nest) * Math.PI * 2;
    if (w.placeEnemyAt(lx + Math.cos(a) * 7, lz + Math.sin(a) * 7)) nests++;
  }
  const fresh = w.enemyMgr.list().filter((h) => !before.has(h.uid));
  w.__mt = { uids: fresh.map((h) => h.uid), t0: performance.now() / 1000 };
  w.enemyMgr.select(fresh, false);
  const squads = w.forceMoveSelectionTo(px, pz);
  const tiers = fresh.reduce((a, h) => { a[h.tier] = (a[h.tier] ?? 0) + 1; return a; }, {});
  return { placed: fresh.length, nests, squads, tiers, uids: fresh.map((h) => h.uid), speed: w.speed };
}, { px: best.px, pz: best.pz, lx: best.lx, lz: best.lz, nest: NEST, camFar: CAMFAR });
console.log(`[布场] 低地(${best.lx},${best.lz}) 投放 ${setup.placed} 只（${setup.nests} 窝 · ${JSON.stringify(setup.tiers)}）· 发令队数 ${setup.squads} · 目标舰船(${best.px},${best.pz})`);
if (setup.placed === 0 || setup.squads === 0) { console.log('布场失败'); await browser.close(); process.exit(1); }

const speedNow = await page.evaluate((speed) => {
  let s = 1;
  while (s < speed) { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Period' })); s *= 2; }
  return window.__rts.speed;
}, SPEED);
console.log(`[加速] speed=${speedNow}×（模拟秒 ≈ 墙钟 × ${speedNow}）`);

// ---------- 阶段 4：跟踪 ----------
const uids = setup.uids;
const state = new Map(uids.map((uid) => [uid, { uid, arrived: null, gone: null, lastD: null, minD: 1e9, tier: null }]));
let stuckTotal = 0, lastStuckStr = '', kills0 = null, recalled0 = null, removed0 = null;
const stuckReasons = [];
let simT = 0, stop = false, lastPrint = -4, t0 = 0;
console.log('[跟踪] 每 4 模拟秒采样（墙钟 0.5s）…');
while (!stop) {
  await new Promise((r) => setTimeout(r, 500));
  const s = await page.evaluate(() => {
    const w = window.__rts; const sw = w.swarm;
    const list = w.enemyMgr.list();
    const byUid = new Map(list.map((h) => [h.uid, h]));
    const units = [];
    for (const uid of w.__mt.uids) {
      const h = byUid.get(uid);
      if (!h) { units.push({ uid, gone: true }); continue; }
      units.push({ uid, d: +Math.hypot(h.x - w.spawn.x, h.z - w.spawn.z).toFixed(1), tier: h.tier, hp: h.hp });
    }
    // ★ 细节：前 3 只（池列 + 队令 + 走廊）
    const detail = [];
    const p = sw.pool;
    for (let k = 0; k < 3 && k < w.__mt.uids.length; k++) {
      const uid = w.__mt.uids[k];
      let i = -1; for (let j = 0; j < p.count; j++) if (p.swarmUid[j] === uid) { i = j; break; }
      // ★ L3 实体侧诊断（不在池里时）
      let ent = null;
      if (i < 0) {
        const e = w.enemies.find((q) => q.swarmUid === uid && !q.dead);
        if (e) {
          const held = e.locomotionHeld;
          ent = {
            x: +e.position.x.toFixed(0), z: +e.position.z.toFixed(0),
            ctl: e.controlSource, hp: e.hp,
            mt: e.moveTarget ? `${e.moveTarget.x | 0},${e.moveTarget.z | 0}` : '-',
            held: held ? `${held.x.toFixed(2)},${held.z.toFixed(2)}@${(held.until - performance.now() / 1000).toFixed(1)}` : '-',
          };
        }
      }
      if (i < 0) {
        if (ent) detail.push({ uid, gone: false, ent, x: ent.x, z: ent.z, spd: 0, mul: 0, atom: -1, dKind: 0, dTgt: 0, dAbs: '-', oTgt: '-', task: '-', blk: 0, tier: 'L3', mAcc: 0, order: '-', corr: -1, corrPts: '-', anch: '-', pathFrom: '-', lead: '-' });
        else detail.push({ uid, gone: true });
        continue;
      }
      const sq = sw.squads.squadOf(uid);
      const st = sq ? sw.tactics.board.get(sq.id) : undefined;
      let li = -1; if (sq) for (let j = 0; j < p.count; j++) if (p.swarmUid[j] === sq.leaderUid) { li = j; break; }
      detail.push({
        uid, sq: sq?.id ?? -1, x: +p.x[i].toFixed(0), z: +p.z[i].toFixed(0),
        spd: +p.curSpeed[i].toFixed(2), mul: p.directiveSpeedMul[i], atom: p.atomMove[i],
        dKind: p.directiveKind[i], dTgt: +Math.hypot(p.directiveTargetX[i] - p.x[i], p.directiveTargetZ[i] - p.z[i]).toFixed(1),
        dAbs: `${p.directiveTargetX[i] | 0},${p.directiveTargetZ[i] | 0}`,
        oTgt: `${p.orderTargetX[i] | 0},${p.orderTargetZ[i] | 0}`,
        task: `${p.taskX[i] | 0},${p.taskZ[i] | 0}`,
        blk: sw.commander.blockedAt(p.x[i], p.z[i]) ? 1 : 0, tier: p.tier[i], mAcc: +p.moveAcc[i].toFixed(2),
        order: st ? `${st.order.kind}/${st.order.mission ?? '-'}@${st.order.target ? `${st.order.target.x | 0},${st.order.target.z | 0}` : '-'} ${st.source} 剩${(st.until - performance.now() / 1000).toFixed(0)}s` : '-',
        corr: st?.corridor?.length ?? -1,
        corrPts: st?.corridor ? st.corridor.slice(0, 6).map((q) => `${q.x | 0},${q.z | 0}`).join('>') : '-',
        anch: st ? `${st.anchorX !== undefined ? st.anchorX | 0 : '-'},${st.anchorZ !== undefined ? st.anchorZ | 0 : '-'}` : '-',
        pathFrom: st ? `${st.pathFromX | 0},${st.pathFromZ | 0}` : '-',
        lead: li >= 0 ? `(${p.x[li] | 0},${p.z[li] | 0}) 指${p.directiveTargetX[li] | 0},${p.directiveTargetZ[li] | 0} 速${p.curSpeed[li].toFixed(1)} atom${p.atomMove[li]}` : '-',
      });
    }
    return {
      wall: performance.now() / 1000, units, t0: w.__mt.t0, detail,
      simT: (w.hooks?.dayT01 ?? 0) * 720000,
      led: sw.ledger.snapshot(),
      stuck: { recycled: sw.stuckDbg.recycled, last: sw.stuckDbg.last, tracked: sw.stuckDbg.tracked, exempt: sw.stuckDbg.exempt },
      pool: sw.pool.count, l3: w.enemies.length, speed: w.speed, orderDrops: sw.orderDrops,
      nav: sw.navDbg ? { seg: sw.navDbg.seg, feasOk: sw.navDbg.feasOk, feasBlocked: sw.navDbg.feasBlocked, fail: sw.navDbg.fail, escape: sw.navDbg.escape } : null,
      gate: sw.dirGateDbg ? { ...sw.dirGateDbg } : null,
    };
  });
  if (!t0) t0 = s.simT;
  simT = s.simT - t0;
  if (kills0 === null) { kills0 = s.led.kills; recalled0 = s.led.recalled; removed0 = s.led.removed; }
  if (s.stuck.recycled > 0) {
    stuckTotal += s.stuck.recycled;
    if (s.stuck.last && s.stuck.last !== lastStuckStr) { stuckReasons.push(s.stuck.last); lastStuckStr = s.stuck.last; }
  }
  for (const u of s.units) {
    const st = state.get(u.uid);
    if (u.gone) { if (!st.gone) st.gone = simT; continue; }
    st.tier = u.tier;
    if (u.d < st.minD) st.minD = u.d;
    st.lastD = u.d;
    if (st.arrived === null && u.d <= ARRIVE_R) st.arrived = simT;
  }
  if (simT - lastPrint >= 4) {
    lastPrint = simT;
    const alive = s.units.filter((u) => !u.gone);
    const dmin = alive.length ? Math.min(...alive.map((u) => u.d)).toFixed(0) : '-';
    const davg = alive.length ? (alive.reduce((a, u) => a + u.d, 0) / alive.length).toFixed(0) : '-';
    console.log(`  T+${simT.toFixed(0)}s 在途${alive.length} 最近${dmin}m 均距${davg}m · 回收${stuckTotal} 账本[recalled ${s.led.recalled - recalled0} removed ${s.led.removed - removed0} kills ${s.led.kills - kills0}] · 池${s.pool} L3 ${s.l3} · stuck[判${s.stuck.tracked} 免${s.stuck.exempt}] · nav ${JSON.stringify(s.nav)}
    门 ${JSON.stringify(s.gate)}`);
    for (const d of s.detail) {
      if (d.gone) { console.log(`     uid${d.uid} gone`); continue; }
      if (d.ent) { console.log(`     uid${d.uid} [L3] (${d.ent.x},${d.ent.z}) ctl=${d.ent.ctl} hp=${d.ent.hp} 移目标=${d.ent.mt} 持向=${d.ent.held}`); continue; }
      console.log(`     uid${d.uid} (${d.x},${d.z}) 速${d.spd}×${d.mul} atom${d.atom} 指令${d.dKind}→${d.dAbs}距${d.dTgt} 锚写${d.oTgt} 任务${d.task} 挡${d.blk}`);
      console.log(`        令 ${d.order} | 走廊${d.corr} [${d.corrPts}] 锚${d.anch} 起点${d.pathFrom} | 队长 ${d.lead}`);
    }
  }
  const done = [...state.values()].every((st) => st.arrived !== null || st.gone !== null);
  if (done) stop = true;
  if (simT > TIMEOUT_SIM) { stop = true; console.log(`  ⏱ 超时 ${TIMEOUT_SIM} 模拟秒`); }
}

// ---------- 阶段 5：结算 ----------
const vals = [...state.values()];
const arrived = vals.filter((v) => v.arrived !== null);
const gone = vals.filter((v) => v.gone !== null && v.arrived === null);
const lost = vals.filter((v) => v.arrived === null && v.gone === null);
const arrT = arrived.map((v) => v.arrived).sort((a, b) => a - b);
const med = arrT.length ? arrT[Math.floor(arrT.length / 2)] : null;
const final = await page.evaluate(() => {
  const w = window.__rts;
  return { led: w.swarm.ledger.snapshot(), orderDrops: w.swarm.orderDrops, l3: w.enemies.length, pool: w.swarm.pool.count };
});
console.log('');
console.log('════════════════ 山地强制行军结算 ════════════════');
console.log(`地形：低(${best.lx},${best.lz}) ${best.lh}m → 高原舰船(${best.px},${best.pz}) ${best.ph}m · 直线距离 ${best.d}m · 高差 ${best.dh}m`);
console.log(`投放 ${setup.placed} · 到达 ${arrived.length} · 回收消失 ${gone.length} · 超时未到 ${lost.length}`);
if (arrT.length) console.log(`到达用时(模拟秒)：最快 ${arrT[0].toFixed(0)} · 中位 ${med.toFixed(0)} · 最慢 ${arrT[arrT.length - 1].toFixed(0)}`);
console.log(`卡死回收(stuckDbg 累计) ${stuckTotal} · 账本 recalled ${final.led.recalled - recalled0} · removed ${final.led.removed - removed0} · kills ${final.led.kills - kills0}`);
if (stuckReasons.length) { console.log('回收现场：'); for (const r of stuckReasons.slice(0, 8)) console.log('  ' + r); }
console.log('逐只：');
for (const v of vals) {
  const tag = v.arrived !== null ? `到达@${v.arrived.toFixed(0)}s` : v.gone !== null ? `消失@${v.gone.toFixed(0)}s` : `未到(最近${v.minD.toFixed(0)}m)`;
  console.log(`  uid ${v.uid} [${v.tier ?? '-'}] ${tag} 末距${v.lastD ?? '-'}m`);
}
console.log(`池 ${final.pool} · L3 ${final.l3} · orderDrops ${final.orderDrops}`);
const pageErrs = errs.filter((e) => e.startsWith('[pageerror]'));
console.log('errors =', errs.length ? errs.slice(0, 4).join('\n') : '(none)');
await page.screenshot({ path: 'diag-mountain.png' });

// ★ 新引擎（唯一指挥链）健全性（重写 P4；G9 调试口契约）
{
  const ne = await page.evaluate(() => globalThis.__rts?.newEngine?.() ?? null);
  const okNe = !!ne && ne.ticks > 0 && ne.squads.count > 0 && ne.writer.issued + ne.writer.kept > 0;
  console.log(`新引擎健全性: ${okNe ? 'PASS' : 'FAIL'} ` + (ne ? JSON.stringify({ ticks: ne.ticks, squads: ne.squads.count, writer: ne.writer }) : '(无 newEngine 调试口)'));
  if (!okNe) process.exitCode = 1;
}

await browser.close();
if (pageErrs.length) process.exitCode = 1;
