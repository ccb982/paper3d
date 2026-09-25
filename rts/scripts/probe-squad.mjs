// ============================================================
// probe-squad —— 单小队全路径追踪 + 卡死归因
// 用法：npm run probe:squad（前置 dev server；SEED / PICK=defense|assault|... / N=样本数）
//   1) 取一个小队（默认第一个工兵队），2Hz 采样：成员位置/速度/指令/任务/挡格 + 队令/走廊/锚 + 队长
//   2) 检测停滞段（质心连续 5 拍位移 < 0.5m）→ 打印该段现场上下文
//   3) 结算：路径/停滞占比/回收事件/各段原因归类
// ============================================================
import puppeteer from 'puppeteer-core';

const RTS_URL = process.env.RTS_URL ?? 'http://localhost:5175/';
const CHROME_PATH = process.env.CHROME_PATH ?? 'C:/Users/22641/AppData/Local/Google/Chrome/Application/chrome.exe';
const SEED = Number(process.env.SEED ?? 4242);
const PICK = process.env.PICK ?? 'defense';
const N = Number(process.env.N ?? 180);

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH, headless: 'new', protocolTimeout: 3e5, args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.goto(`${RTS_URL}${RTS_URL.includes('?') ? '&' : '?'}seed=${SEED}&x=60&z=-40`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__rts?.phase === 'world' && window.__rts?.swarm, { timeout: 240000, polling: 500 });
await new Promise((r) => setTimeout(r, 15000));

const sid = await page.evaluate((pick) => {
  const sw = window.__rts.swarm;
  let best = -1, bn = 0;
  for (const s of sw.squads.all()) {
    const match = pick === 'any' || s.type === pick || (pick === 'defense' && s.builders);
    if (match && s.members.size > bn) { bn = s.members.size; best = s.id; }
  }
  return best;
}, PICK);
console.log(`[选定] 追踪小队 #${sid}（${PICK}），采样 ${N}×500ms…`);

const samples = [];
for (let t = 0; t < N; t++) {
  await new Promise((r) => setTimeout(r, 500));
  const s = await page.evaluate((sid) => {
    const w = window.__rts; const sw = w.swarm;
    const sq = sw.squads.get(sid); if (!sq) return null;
    const st = sw.tactics.board.get(sid);
    const p = sw.pool;
    const mem = [];
    for (const [uid, m] of sq.members) {
      let i = -1; for (let j = 0; j < p.count; j++) if (p.swarmUid[j] === uid) { i = j; break; }
      let d = null;
      if (i >= 0) {
        d = {
          uid, x: +p.x[i].toFixed(1), z: +p.z[i].toFixed(1), tier: p.tier[i],
          spd: +p.curSpeed[i].toFixed(2), mul: p.directiveSpeedMul[i], atom: p.atomMove[i],
          dk: p.directiveKind[i], dt: +Math.hypot(p.directiveTargetX[i] - p.x[i], p.directiveTargetZ[i] - p.z[i]).toFixed(1),
          task: p.taskX[i] !== 0 || p.taskZ[i] !== 0 ? 1 : 0,
          blk: sw.commander.blockedAt(p.x[i], p.z[i]) ? 1 : 0,
        };
      } else {
        const e = w.enemies.find((q) => q.swarmUid === uid && !q.dead);
        d = e ? { uid, x: +e.position.x.toFixed(1), z: +e.position.z.toFixed(1), tier: 'L3', spd: 0, mul: 0, atom: -1, dk: 0, dt: 0, task: 0, blk: 0 } : { uid, gone: 1 };
      }
      mem.push(d);
    }
    return {
      wall: +(performance.now() / 1000).toFixed(1),
      order: st ? `${st.order.kind}/${st.order.mission ?? '-'}@${st.order.target ? `${st.order.target.x | 0},${st.order.target.z | 0}` : '-'} ${st.source}` : '-',
      corr: st?.corridor ? st.corridor.slice(0, 4).map((q) => `${q.x | 0},${q.z | 0}${q.climb ? '⛰' : ''}`).join('>') : '-',
      corrN: st?.corridor?.length ?? -1,
      pathFrom: st ? `${st.pathFromX | 0},${st.pathFromZ | 0}` : '-',
      anch: st ? `${st.anchorX | 0},${st.anchorZ | 0}` : '-',
      lead: sq.leaderUid,
      mem,
      led: sw.ledger.snapshot(),
      stuckLast: window.__rts?.shadowBridge?.timers?.dbg?.last ?? '-',
      recycled: window.__rts?.shadowBridge?.timers?.dbg?.stuckTotal ?? 0,
    };
  }, sid);
  if (!s) { console.log('小队消失'); break; }
  samples.push(s);
}

// ---------- 分析 ----------
let path = 0, stalls = [];
let prevC = null, streak = 0;
const memStat = new Map();
for (let k = 0; k < samples.length; k++) {
  const s = samples[k];
  const alive = s.mem.filter((m) => !m.gone);
  const cx = alive.reduce((a, m) => a + m.x, 0) / Math.max(1, alive.length);
  const cz = alive.reduce((a, m) => a + m.z, 0) / Math.max(1, alive.length);
  if (prevC) {
    const d = Math.hypot(cx - prevC.x, cz - prevC.z);
    path += d;
    if (d < 0.25) streak++; else streak = 0;
    if (streak === 5) stalls.push(k);   // 连续 5 拍（2.5s）几乎没动
  }
  prevC = { x: cx, z: cz };
  for (const m of alive) {
    let a = memStat.get(m.uid);
    if (!a) { a = { n: 0, spd: 0, dt: 0, task: 0, blk: 0, gone: false, last: null, move: 0 }; memStat.set(m.uid, a); }
    a.n++; a.spd += m.spd; a.dt += m.dt; a.task += m.task; a.blk += m.blk;
    if (a.last) a.move += Math.hypot(m.x - a.last.x, m.z - a.last.z);
    a.last = m;
  }
}
console.log(`\n样本 ${samples.length}（${(samples.length * 0.5).toFixed(0)}s）· 队质心路径 ${path.toFixed(0)}m · 停滞段 ${stalls.length}`);
console.log(`回收：ledger recalled ${samples[samples.length - 1].led.recalled - samples[0].led.recalled}（计时器卡死累计 ${samples[samples.length - 1].recycled}）`);
console.log('\n成员：uid 样本 平均速 平均指令距 任务% 挡格% 位移m');
for (const [uid, a] of memStat) {
  console.log(`  ${uid} ${a.n} ${(a.spd / a.n).toFixed(2)} ${(a.dt / a.n).toFixed(1)} ${((a.task / a.n) * 100).toFixed(0)}% ${((a.blk / a.n) * 100).toFixed(0)}% ${a.move.toFixed(0)}`);
}
console.log('\n停滞段现场（每段首尾各 1 拍）：');
for (const k of stalls.slice(0, 6)) {
  for (const idx of [k - 1, Math.min(k + 4, samples.length - 1)]) {
    const s = samples[idx];
    if (!s) continue;
    const alive = s.mem.filter((m) => !m.gone);
    const mem = alive.slice(0, 3).map((m) => `${m.uid}(${m.x},${m.z}) 速${m.spd} 指令${m.dk}距${m.dt} 任务${m.task} 挡${m.blk}`).join(' | ');
    console.log(`  [${idx}] 令 ${s.order} | 走廊${s.corrN} [${s.corr}] 锚${s.anch} 起点${s.pathFrom} | ${mem}`);
  }
  console.log('  ---');
}
console.log('最近卡死现场:', samples[samples.length - 1].stuckLast || '(无)');

// ★ 新引擎（唯一指挥链）健全性（重写 P4；G9 调试口契约）
{
  const ne = await page.evaluate(() => globalThis.__rts?.newEngine?.() ?? null);
  const okNe = !!ne && ne.ticks > 0 && ne.squads.count > 0 && ne.writer.issued + ne.writer.kept > 0;
  console.log(`新引擎健全性: ${okNe ? 'PASS' : 'FAIL'} ` + (ne ? JSON.stringify({ ticks: ne.ticks, squads: ne.squads.count, writer: ne.writer }) : '(无 newEngine 调试口)'));
  if (!okNe) process.exitCode = 1;
}

await browser.close();
