// ============================================================
// probe-rts —— RTS 蜂群行为探针 + 基线断言（移植自 全新的游戏/scripts/tmp/diag-rts.mjs，2026-09-24）
// 用法：npm run probe
//   前置：dev server 已启动（默认 http://localhost:5175/；Vite 端口被占会自动 +1，用 RTS_URL 覆盖）
//   环境：RTS_URL / CHROME_PATH / SEED
// 输出：T+8/20/40/70 诊断 + 队轨迹 + 全队汇总 + 末行「基线断言 n/n」
//   断言失败退出码 = 1（可接 CI/手动四关）
// ============================================================
import puppeteer from 'puppeteer-core';

const RTS_URL = process.env.RTS_URL ?? 'http://localhost:5175/';
const CHROME_PATH = process.env.CHROME_PATH ?? 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe';
const SEED = Number(process.env.SEED ?? 4242);

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: 'new', protocolTimeout: 3e5, args: ['--no-sandbox', '--disable-gpu-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errs = [];
page.on('pageerror', (e) => errs.push('[pageerror] ' + String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text().slice(0, 160)); });
await page.goto(`${RTS_URL}${RTS_URL.includes('?') ? '&' : '?'}seed=${SEED}&x=60&z=-40`, { waitUntil: 'domcontentloaded', timeout: 120000 });

const probe = () => page.evaluate(() => {
  try {
    const w = window.__rts; const sw = w?.swarm; const c = sw?.data;
  const views = new Map((w?.engineView?.squads() ?? []).map((v) => [v.id, v]));
  const squads = [];
  let n = 0;
  for (const s of sw.squads.all()) {
    const v = views.get(s.id);
    const o = v?.order;
    let cx = 0, cz = 0, m = 0;
    for (const mm of s.members.values()) { cx += mm.x; cz += mm.z; m++; }
    squads.push(`#${s.id}${s.builders ? 'B' : ''} n=${m} 位${(cx / m).toFixed(0)},${(cz / m).toFixed(0)} 令=${o?.kind ?? '-'}→${o?.target ? `${o.target.x | 0},${o.target.z | 0}` : '-'}`);
    if (++n >= 4) break;
  }
  return {
    pool: sw?.pool?.count ?? null, l3: w?.enemies?.length ?? null,
    squadsN: sw?.squads?.size ?? null,
    recycled: w?.shadowBridge?.timers?.dbg?.stuckTotal ?? null,
    stage: c?.stage ?? null, posture: c?.battlePosture ?? null,
    drops: sw?.orderDrops ?? null,
    clamps: c?.cmdLogRingClamps ?? null,
    decision: c?.lastDecision ? `${c.lastDecision.kind}@${c.lastDecision.at | 0}` : null,
    gain: sw?.data?.terrainScore?.distGain ? +sw.data.terrainScore.distGain.toFixed(1) : null,
    nav: sw?.navDbg ? { seg: sw.navDbg.seg, feasOk: sw.navDbg.feasOk, feasBlocked: sw.navDbg.feasBlocked, fail: sw.navDbg.fail } : null,
    band: c?.fortifyBand ? { minD: +c.fortifyBand.minD.toFixed(1), maxD: +c.fortifyBand.maxD.toFixed(1), frontP: +c.fortifyBand.frontP.toFixed(2) } : null,
    plan: !!c?.plan,
    squads,
    /** ★ 销毁率采样（用户定 2026-09-25）：账本离场 + 新引擎计时销毁判决（累计值，窗口差分算率） */
    destroy: {
      spawned: sw?.ledger?.spawned ?? null,
      alive: sw?.ledger?.alive ?? null,
      kills: sw?.ledger?.kills ?? null,
      recalled: sw?.ledger?.recalled ?? null,
      removed: sw?.ledger?.removed ?? null,
      timerTotal: w?.shadowBridge?.timers?.dbg?.expiredTotal ?? null,
      timerStuck: w?.shadowBridge?.timers?.dbg?.stuckTotal ?? null,
    },
    agents: (() => {
      const p = sw.pool; const out = [];
      for (let i = 0; i < p.count && out.length < 2; i++) {
        out.push({
          uid: p.swarmUid[i], x: +p.x[i].toFixed(1), z: +p.z[i].toFixed(1), hp: p.hp[i],
          task: '-',
          dirTgt: `${p.directiveTargetX[i] | 0},${p.directiveTargetZ[i] | 0}`,
          spd: +p.curSpeed[i].toFixed(2), mul: p.directiveSpeedMul[i],
          blocked: sw.data.blockedAt(p.x[i], p.z[i]),
        });
      }
      return out;
    })(),
    trace: (() => {
      const t = w?.aiTrace; if (!t) return null;
      const dump = t.dump();
      const cnt = (ev) => dump.split('\n').filter((l) => l.includes(`"ev":"${ev}"`)).length;
      return { orders: cnt('order'), dirs: cnt('directive'), paths: cnt('path'), kills: cnt('kill'), digest: t.digest(6) };
    })(),
  };
  } catch (e) { return { err: String(e).slice(0, 200) }; }
});
await page.evaluate(() => {
  window.__squadTrk = [];
  window.__allTrk = new Map();   // sid → [{t,x,z}]
  setInterval(() => {
    const w = window.__rts; if (!w?.swarm) return;
    // 全队采样
    for (const s of w.swarm.squads.all()) {
      if (s.members.size < 2) continue;
      let cx = 0, cz = 0, n = 0;
      for (const m of s.members.values()) { cx += m.x; cz += m.z; n++; }
      let a = window.__allTrk.get(s.id); if (!a) { a = []; window.__allTrk.set(s.id, a); }
      a.push({ t: +(performance.now() / 1000).toFixed(1), x: +(cx / n).toFixed(1), z: +(cz / n).toFixed(1) });
    }
    // 行军队（advance 令 + 目标最远）
    const views = new Map((w.engineView?.squads() ?? []).map((v) => [v.id, v]));
    let best = null, bd = -1;
    for (const s of w.swarm.squads.all()) {
      const o = views.get(s.id)?.order;
      if (!o || (o.kind !== 'advance' && o.kind !== 'act' && o.kind !== 'march') || !o.target) continue;
      let cx = 0, cz = 0, n = 0;
      for (const m of s.members.values()) { cx += m.x; cz += m.z; n++; }
      if (n === 0) continue;
      const d = Math.hypot(o.target.x - cx / n, o.target.z - cz / n);
      if (d > bd) { bd = d; best = s; }
    }
    if (!best) return;
    let cx = 0, cz = 0, n = 0;
    for (const m of best.members.values()) { cx += m.x; cz += m.z; n++; }
    const bv = views.get(best.id);
    window.__squadTrk.push({
      t: +(performance.now() / 1000).toFixed(1), sid: best.id,
      x: +(cx / n).toFixed(1), z: +(cz / n).toFixed(1), n,
      corr: bv?.corridor?.length ?? 0,
      ok: bv?.order?.kind ?? '-',
      otx: bv?.order?.target?.x | 0, otz: bv?.order?.target?.z | 0,
    });
  }, 500);
});
const samples = [];
let elapsed = 0;
for (const t of [8000, 20000, 40000, 70000, 90000]) {
  await new Promise((r) => setTimeout(r, t - elapsed));
  elapsed = t;
  const s = await probe();
  samples.push(s);
  console.log(`T+${t / 1000}s`, JSON.stringify(s));
  if (t === 40000) {
    // ★ S1 施工窗：0~68s 不拨日程（工兵 ~2m/s 到件 + 6s/10s 施工；实测 T+65 建成）→ 68s 第一波；70s 总攻
    await page.evaluate(() => {
      const w = window.__rts;
      setTimeout(() => w.swarm.data.scrubDay(0.5), 28000);   // T+68：第一波（收到舰）
      w.cam.tx = 60; w.cam.tz = -40; w.cam.dist = 200; w.cam.pitch = 1.2;
    });
  }
  if (t === 20000) {
    const d = await page.evaluate(() => {
      const w = window.__rts; const sw = w.swarm; const p = sw.pool;
      const s = sw.squads.get(1); if (!s) return null;
      const uid = s.leaderUid;
      let i = -1; for (let k = 0; k < p.count; k++) if (p.swarmUid[k] === uid) { i = k; break; }
      const st = (w.engineView?.squads() ?? []).find((v) => v.id === 1);
      return {
        leaderUid: uid, inPool: i >= 0,
        task: null,
        dirTgt: i >= 0 ? `${p.directiveTargetX[i] | 0},${p.directiveTargetZ[i] | 0}` : null,
        dKind: i >= 0 ? p.directiveKind[i] : null,
        pos: i >= 0 ? `${p.x[i].toFixed(1)},${p.z[i].toFixed(1)}` : null,
        spd: i >= 0 ? +p.curSpeed[i].toFixed(2) : null, mul: i >= 0 ? +p.directiveSpeedMul[i].toFixed(2) : null,
        blocked: i >= 0 ? sw.data.blockedAt(p.x[i], p.z[i]) : null,
        order: st?.order ? `${st.order.kind}@${st.order.target ? `${st.order.target.x | 0},${st.order.target.z | 0}` : '-'}` : null,
        corr: st?.corridor?.map((q) => `${q.x | 0},${q.z | 0}`).join('→') ?? null,
        pathFrom: `${st?.pathFromX | 0},${st?.pathFromZ | 0}`,
      };
    });
    console.log('队1队长 dump =', JSON.stringify(d));
    // ★ 快车道验证：相机中心 18m 内 15 伤害（代理直扣）
    const r = await page.evaluate(() => {
      const w = window.__rts;
      return w.fastLane.damageArea(w.cam.tx, w.cam.tz, 18, 15);
    });
    console.log('快车道伤害 =', JSON.stringify(r));
    // ★ 快车道·代理致死验证（对池代理位置 999 伤害）
    const kill = await page.evaluate(() => {
      const w = window.__rts; const p = w.swarm.pool;
      if (p.count === 0) return null;
      return { at: [p.x[0] | 0, p.z[0] | 0], r: w.fastLane.damageArea(p.x[0], p.z[0], 4, 999) };
    });
    console.log('快车道致死 =', JSON.stringify(kill));
  }
  if (t === 70000) {
    await page.evaluate(() => { window.__rts.swarm.data.scrubDay(0.95); });   // ★ 总攻（点 0/0）
    await page.evaluate(() => { window.__rts.navMap.open(null); });   // ★ 打开全览小地图截图
  }
}
// ★ 工事计时（断言也读）：新引擎 EngineerManager（旧工事链已销毁）
const built = await page.evaluate(() => {
  const c = window.__rts.swarm.data;
  const ne = globalThis.__rts?.newEngine?.() ?? null;
  const eng = ne?.engineer ?? {};
  return { built: eng.built ?? 0, spots: eng.spots ?? 0, working: eng.working ?? 0, sweeps: c.fortify.dbg.sweeps };
});
console.log('工事计时', JSON.stringify(built));
// ★ 队轨迹分析
const trk = await page.evaluate(() => window.__squadTrk ?? []);
if (trk.length > 4) {
  let path = 0, stall = 0, rev = 0, cmdChanges = 0, corrChanges = 0;
  let px = null, pz = null, lastSign = 0, lastCmd = '', lastCorr = -1;
  for (const e of trk) {
    if (px !== null) {
      const dx = e.x - px, dz = e.z - pz;
      const d = Math.hypot(dx, dz);
      path += d;
      if (d < 0.3) stall++;
      const sign = Math.sign(dx);
      if (sign !== 0 && lastSign !== 0 && sign !== lastSign) rev++;
      if (sign !== 0) lastSign = sign;
    }
    const cmd = `${e.ok}@${e.otx},${e.otz}`;
    if (cmd !== lastCmd) { cmdChanges++; lastCmd = cmd; }
    if (e.corr !== lastCorr) { corrChanges++; lastCorr = e.corr; }
    px = e.x; pz = e.z;
  }
  const net = Math.hypot(trk[trk.length - 1].x - trk[0].x, trk[trk.length - 1].z - trk[0].z);
  const allTrk = await page.evaluate(() => [...(window.__allTrk ?? new Map())].map(([sid, a]) => [sid, a]));
  const sums = [];
  for (const [sid, a] of allTrk) {
    if (a.length < 6) continue;
    let p2 = 0, st2 = 0;
    for (let i = 1; i < a.length; i++) { const d = Math.hypot(a[i].x - a[i - 1].x, a[i].z - a[i - 1].z); p2 += d; if (d < 0.3) st2++; }
    const net2 = Math.hypot(a[a.length - 1].x - a[0].x, a[a.length - 1].z - a[0].z);
    sums.push(`#${sid} n=${a.length} 路径${p2.toFixed(0)}/净${net2.toFixed(0)}=${(p2 / Math.max(net2, 0.5)).toFixed(1)} 停滞${st2}/${a.length - 1}`);
  }
  console.log('全队汇总', sums.join(' | '));
  console.log('队轨迹', JSON.stringify({
    sid: trk[0].sid, samples: trk.length, path: +path.toFixed(0), net: +net.toFixed(0),
    ratio: +(path / Math.max(net, 0.5)).toFixed(1), stall, reversals: rev,
    cmdChanges, corrChanges,
    head: trk.slice(0, 6).map((e) => `${e.t}:${e.x},${e.z}c${e.corr}${e.ok}@${e.otx},${e.otz}`),
    tail: trk.slice(-4).map((e) => `${e.t}:${e.x},${e.z}c${e.corr}${e.ok}@${e.otx},${e.otz}`),
  }));

  // ---------- ★ §6 验收指标（量化；《蜂群重写计划.md》） ----------
  const m6 = await page.evaluate(() => {
    const w = window.__rts; const sw = w?.swarm;
    const byRole = new Map();
    for (const v of w?.engineView?.squads() ?? []) {
      if (v.role === 'engineer') continue;   // 工兵走 EngineerManager（间距指标只量战斗兵种）
      const t = v.order?.target;
      if (!t || (t.x === 0 && t.z === 0)) continue;
      const role = String(v.role ?? 'melee');
      if (!byRole.has(role)) byRole.set(role, []);
      byRole.get(role).push({ id: v.id, x: t.x, z: t.z });
    }
    let minSame = null, pair = '';
    for (const [role, arr] of byRole) {
      for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
        const d = Math.hypot(arr[i].x - arr[j].x, arr[i].z - arr[j].z);
        if (minSame === null || d < minSame) { minSame = d; pair = `${role} #${arr[i].id}/#${arr[j].id}`; }
      }
    }
    // ★ 成员空转（不读旧 OrderGate）：有指令但目标≈自身 <1.5m 的成员占比
    let idle = 0, decided = 0;
    const p = sw?.pool;
    if (p) for (let i = 0; i < p.count; i++) {
      if (p.directiveKind[i] === 0) continue;   // 'none'：无指令
      decided++;
      if (Math.hypot(p.directiveTargetX[i] - p.x[i], p.directiveTargetZ[i] - p.z[i]) < 1.5) idle++;
    }
    return {
      idle, decided,
      minSame: minSame === null ? null : +minSame.toFixed(1), pair,
    };
  });
  const durMin = 62 / 60;   // 采样窗 8s→70s（≈62 模拟秒）
  const idlePct = m6.decided ? (m6.idle / m6.decided) * 100 : null;
  // ★ 销毁率（窗口差分；用户定 2026-09-25）：账本离场 = 击杀/回收/其他；计时判决 = TimerManager 卡死回收
  const dA = samples[0]?.destroy ?? null;
  const dB = samples[samples.length - 1]?.destroy ?? null;
  const dd = (a, b) => (a === null || a === undefined || b === null || b === undefined) ? null : b - a;
  const dKill = dd(dA?.kills, dB?.kills), dRecall = dd(dA?.recalled, dB?.recalled), dRemoved = dd(dA?.removed, dB?.removed);
  const dTimer = dd(dA?.timerTotal, dB?.timerTotal), dTStuck = dd(dA?.timerStuck, dB?.timerStuck);
  const destroyRate = (dKill !== null && dRecall !== null && dRemoved !== null)
    ? (dKill + dRecall + dRemoved) / durMin : null;
  const timerRate = dTimer === null ? null : dTimer / durMin;
  const stuckRate = dTStuck === null ? null : dTStuck / durMin;
  const rows = [
    ['成员空转 <5%', idlePct === null ? '-' : idlePct.toFixed(1) + '%', idlePct !== null && idlePct < 5],
    ['同兵种目标间距 ≥40m', m6.minSame === null ? '-' : m6.minSame + 'm ' + m6.pair, m6.minSame !== null && m6.minSame >= 40],
    ['卡死回收 ≤10/min', stuckRate === null ? '-' : stuckRate.toFixed(1) + '/min', stuckRate !== null && stuckRate <= 10],
    ['cmdChanges ≤5', String(cmdChanges), cmdChanges !== null && cmdChanges <= 5],
    ['销毁率（信息）', destroyRate === null ? '-' : `${destroyRate.toFixed(1)}/min（杀 ${dKill} / 回收 ${dRecall} / 他 ${dRemoved}）`, true],
    ['计时销毁（信息）', timerRate === null ? '-' : `${timerRate.toFixed(1)}/min（卡死 ${dTStuck}）`, true],
  ];
  if (destroyRate !== null || timerRate !== null) {
    const alive = dB?.alive, spawned = dB?.spawned;
    console.log(`销毁率: 场内存活=${alive ?? '-'} 累计生成=${spawned ?? '-'} ｜ 离场=${destroyRate === null ? '-' : destroyRate.toFixed(1) + '/min'} ｜ 计时判决=${timerRate === null ? '-' : timerRate.toFixed(1) + '/min'}`);
  }
  console.log('');
  console.log('★ §6 验收指标（量化）');
  for (const [name, val, okr] of rows) console.log(`  ${okr ? 'PASS' : 'FAIL'} ${name}: ${val}`);
}
await page.screenshot({ path: 'diag-world.png' });
const pageErrs = errs.filter((e) => e.startsWith('[pageerror]'));
console.log('errors =', errs.length ? errs.slice(0, 4).join('\n') : '(none)');

// ---------- 基线断言（seed 4242 快照口径；失败退出码 1） ----------
const last = samples[samples.length - 1] ?? {};
const checks = [
  ['无 pageerror', pageErrs.length === 0],
  ['池代理 > 0', (last.pool ?? 0) > 0],
  ['小队数 > 0', (last.squadsN ?? 0) > 0],
  ['命令已下发（引擎+队长）', (last.trace?.orders ?? 0) > 0 && (last.trace?.dirs ?? 0) > 0],
  ['寻路已产出', (last.trace?.paths ?? 0) > 0],
  ['工事建成 > 0', built.built > 0],
];
// ★ 新引擎（唯一指挥链）：调试口契约 + 健全性（重写 P4；G9）
const ne = await page.evaluate(() => globalThis.__rts?.newEngine?.() ?? null);
checks.push(
  ['新引擎在跑（ticks>0）', !!ne && ne.ticks > 0],
  ['新引擎小队已登记', !!ne && ne.squads.count > 0],
  ['唯一发令器有台账', !!ne && ne.writer.issued + ne.writer.kept > 0],
  ['位置单源有玩家+舰船', !!ne && ne.pos.player === true && ne.pos.ship === true],
);
const pass = checks.filter(([, ok]) => ok).length;
for (const [name, ok] of checks) if (!ok) console.error(`  FAIL  ${name}`);
console.log(`基线断言: ${pass}/${checks.length} ${pass === checks.length ? 'PASS' : 'FAIL'}`);
if (pass !== checks.length) process.exitCode = 1;
await browser.close();
