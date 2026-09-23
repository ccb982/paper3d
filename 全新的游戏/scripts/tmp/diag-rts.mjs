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
let elapsed = 0;
for (const t of [8000, 20000, 40000, 70000]) {
  await new Promise((r) => setTimeout(r, t - elapsed));
  elapsed = t;
  console.log(`T+${t / 1000}s`, JSON.stringify(await probe()));
  if (t === 8000) {
    // ★ 相机对准人数最多的队（验证"视野内升格"）
    await page.evaluate(() => {
      const w = window.__rts; const sw = w.swarm;
      let best = null, bn = 0;
      for (const s of sw.squads.all()) if (s.members.size > bn) { bn = s.members.size; best = s; }
      if (!best) return;
      let cx = 0, cz = 0, n = 0;
      for (const m of best.members.values()) { cx += m.x; cz += m.z; n++; }
      w.cam.tx = cx / n; w.cam.tz = cz / n; w.cam.dist = 120;
    });
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
await page.screenshot({ path: '../rts/diag-world.png' });
console.log('errors =', errs.length ? errs.slice(0, 4).join('\n') : '(none)');
await browser.close();
