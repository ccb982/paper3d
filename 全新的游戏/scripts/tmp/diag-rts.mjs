// RTS 蜂群行为诊断：进世界 → 定时打印 指挥器/小队命令/代理位置/回收计数
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
  executablePath: 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe',
  headless: 'new', protocolTimeout: 3e5, args: ['--no-sandbox', '--disable-gpu-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errs = [];
page.on('pageerror', (e) => errs.push('[pageerror] ' + String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text().slice(0, 160)); });
await page.goto('http://localhost:5175/?seed=4242&x=60&z=-40', { waitUntil: 'domcontentloaded', timeout: 120000 });

const probe = () => page.evaluate(() => {
  try {
    const w = window.__rts; const sw = w?.swarm; const c = sw?.commander;
  const squads = [];
  let n = 0;
  for (const s of sw.squads.all()) {
    const st = sw.tactics.board.get(s.id);
    const o = st?.order;
    let cx = 0, cz = 0, m = 0;
    for (const mm of s.members.values()) { cx += mm.x; cz += mm.z; m++; }
    squads.push(`#${s.id}${s.builders ? 'B' : ''} n=${m} 位${(cx / m).toFixed(0)},${(cz / m).toFixed(0)} 令=${o?.kind ?? '-'}→${o?.target ? `${o.target.x | 0},${o.target.z | 0}` : '-'}`);
    if (++n >= 4) break;
  }
  return {
    pool: sw?.pool?.count ?? null, l3: w?.enemies?.length ?? null,
    recycled: sw?.stuckDbg?.recycled ?? null,
    stage: c?.stage ?? null, posture: c?.battlePosture ?? null,
    drops: sw?.orderDrops ?? null, recycled: sw?.stuckDbg?.recycled ?? null,
    clamps: c?.cmdLogRingClamps ?? null,
    decision: c?.lastDecision ? `${c.lastDecision.kind}@${c.lastDecision.at | 0}` : null,
    gain: sw?.commander?.terrainScore?.distGain ? +sw.commander.terrainScore.distGain.toFixed(1) : null,
    nav: sw?.navDbg ? { seg: sw.navDbg.seg, feasOk: sw.navDbg.feasOk, feasBlocked: sw.navDbg.feasBlocked, fail: sw.navDbg.fail } : null,
    band: c?.fortifyBand ? { minD: +c.fortifyBand.minD.toFixed(1), maxD: +c.fortifyBand.maxD.toFixed(1), frontP: +c.fortifyBand.frontP.toFixed(2) } : null,
    decision: c?.lastDecision ? `${c.lastDecision.kind}@${c.lastDecision.at | 0}` : null,
    plan: !!c?.plan,
    squads,
    agents: (() => {
      const p = sw.pool; const out = [];
      for (let i = 0; i < p.count && out.length < 2; i++) {
        out.push({
          uid: p.swarmUid[i], x: +p.x[i].toFixed(1), z: +p.z[i].toFixed(1), hp: p.hp[i],
          task: `${p.taskX[i] | 0},${p.taskZ[i] | 0}`,
          dirTgt: `${p.directiveTargetX[i] | 0},${p.directiveTargetZ[i] | 0}`,
          spd: +p.curSpeed[i].toFixed(2), mul: p.directiveSpeedMul[i],
          blocked: sw.commander.blockedAt(p.x[i], p.z[i]),
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
    let best = null, bd = -1;
    for (const s of w.swarm.squads.all()) {
      const st = w.swarm.tactics.board.get(s.id); const o = st?.order;
      if (!o || o.kind !== 'advance' || !o.target) continue;
      let cx = 0, cz = 0, n = 0;
      for (const m of s.members.values()) { cx += m.x; cz += m.z; n++; }
      if (n === 0) continue;
      const d = Math.hypot(o.target.x - cx / n, o.target.z - cz / n);
      if (d > bd) { bd = d; best = s; }
    }
    if (!best) return;
    let cx = 0, cz = 0, n = 0;
    for (const m of best.members.values()) { cx += m.x; cz += m.z; n++; }
    const st = w.swarm.tactics.board.get(best.id);
    window.__squadTrk.push({
      t: +(performance.now() / 1000).toFixed(1), sid: best.id,
      x: +(cx / n).toFixed(1), z: +(cz / n).toFixed(1), n,
      corr: st?.corridor?.length ?? 0,
      ok: st?.order?.kind ?? '-',
      otx: st?.order?.target?.x | 0, otz: st?.order?.target?.z | 0,
    });
  }, 500);
});
let elapsed = 0;
for (const t of [8000, 20000, 40000, 70000]) {
  await new Promise((r) => setTimeout(r, t - elapsed));
  elapsed = t;
  console.log(`T+${t / 1000}s`, JSON.stringify(await probe()));
  if (t === 2000) {
    await page.evaluate(() => { window.__rts.__setSpeed?.(8); });   // ★ 加速×8 采集
  }
  if (t === 8000) {
    // ★ 快进到总攻时段（t01=0.9）+ 相机对准舰船，验证"下午闸门收拢/第一波抵舰驻留"
    await page.evaluate(() => {
      const w = window.__rts;
      w.swarm.commander.scrubDay(0.5);   // ★ 第一波（commit=1，收到舰）
      w.cam.tx = 60; w.cam.tz = -40; w.cam.dist = 200; w.cam.pitch = 1.2;
    });
  }
  if (t === 20000) {
    const d = await page.evaluate(() => {
      const w = window.__rts; const sw = w.swarm; const p = sw.pool;
      const s = sw.squads.get(1); if (!s) return null;
      const uid = s.leaderUid;
      let i = -1; for (let k = 0; k < p.count; k++) if (p.swarmUid[k] === uid) { i = k; break; }
      const st = sw.tactics.board.get(1);
      return {
        leaderUid: uid, inPool: i >= 0,
        task: i >= 0 ? `${p.taskX[i] | 0},${p.taskZ[i] | 0}` : null,
        dirTgt: i >= 0 ? `${p.directiveTargetX[i] | 0},${p.directiveTargetZ[i] | 0}` : null,
        dKind: i >= 0 ? p.directiveKind[i] : null,
        pos: i >= 0 ? `${p.x[i].toFixed(1)},${p.z[i].toFixed(1)}` : null,
        spd: i >= 0 ? +p.curSpeed[i].toFixed(2) : null, mul: i >= 0 ? +p.directiveSpeedMul[i].toFixed(2) : null,
        blocked: i >= 0 ? sw.commander.blockedAt(p.x[i], p.z[i]) : null,
        order: st ? `${st.order.kind}@${st.order.target?.x | 0},${st.order.target?.z | 0}` : null,
        corr: st?.corridor?.map((q) => `${q.x | 0},${q.z | 0}`).join('→') ?? null,
        pathFrom: `${st?.pathFromX | 0},${st?.pathFromZ | 0}`,
      };
    });
    console.log('队1队长 dump =', JSON.stringify(d));
  }
  if (t === 40000) {
    await page.evaluate(() => { window.__rts.swarm.commander.scrubDay(0.75); });   // ★ 甜甜圈（60/180）
  }
  if (t === 70000) {
    await page.evaluate(() => { window.__rts.swarm.commander.scrubDay(0.95); });   // ★ 总攻（点 0/0）
    await page.evaluate(() => { window.__rts.navMap.open(null); });   // ★ 打开全览小地图截图
  }
  if (t === 20000) {
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
}
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
  let path = 0, stall = 0;
  for (let i = 1; i < a.length; i++) { const d = Math.hypot(a[i].x - a[i - 1].x, a[i].z - a[i - 1].z); path += d; if (d < 0.3) stall++; }
  const net = Math.hypot(a[a.length - 1].x - a[0].x, a[a.length - 1].z - a[0].z);
  sums.push(`#${sid} n=${a.length} 路径${path.toFixed(0)}/净${net.toFixed(0)}=${(path / Math.max(net, 0.5)).toFixed(1)} 停滞${stall}/${a.length - 1}`);
}
const built = await page.evaluate(() => {
  const c = window.__rts.swarm.commander;
  return { built: c.corps.built.size, pieces: c.corps.pieces.length, injected: c.fortify.dbg.injected, sweeps: c.fortify.dbg.sweeps };
});
console.log('工事计时', JSON.stringify(built));
console.log('全队汇总', sums.join(' | '));
console.log('队轨迹', JSON.stringify({
    sid: trk[0].sid, samples: trk.length, path: +path.toFixed(0), net: +net.toFixed(0),
    ratio: +(path / Math.max(net, 0.5)).toFixed(1), stall, reversals: rev,
    cmdChanges, corrChanges,
    head: trk.slice(0, 6).map((e) => `${e.t}:${e.x},${e.z}c${e.corr}${e.ok}@${e.otx},${e.otz}`),
    tail: trk.slice(-4).map((e) => `${e.t}:${e.x},${e.z}c${e.corr}${e.ok}@${e.otx},${e.otz}`),
  }));
}
await page.screenshot({ path: '../rts/diag-world.png' });
console.log('errors =', errs.length ? errs.slice(0, 4).join('\n') : '(none)');
await browser.close();
