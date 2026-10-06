/**
 * ══════════════════════════════════════════════════════════════════
 * probe-rescue.ts —— **救回窗口**：到底有没有"歪倒一定角度之前"这段窗口
 * ══════════════════════════════════════════════════════════════════
 *
 * 用户 2026-10-06：
 *   「现阶段是立刻倒地。我觉得在歪倒一定角度之前都可以尝试救回来，
 *     歪倒角度过大确实是没救了」
 *
 * ⇒ 本探针要回答：**从站立到"没救"，中间有多少毫秒、趋势长什么样**。
 *   没有这段窗口 ⇒ 救回律无从谈起；有窗口 ⇒ 记下它的长度与斜率，
 *   作为平衡系统"该往哪发力、还来不来得及"的标定依据。
 *
 * 判读口径（每拍）：
 *   worst  = 最歪那一段的倾角（deg，`rs.trends.worstTiltDeg`）
 *   rate   = 它的倾角速率（deg/s，正 = 越歪越狠）
 *   azim   = 它的倾斜方位（0=前 90=左 ±180=后 −90=右）
 *   rescuable = worst < rs.rescueMaxTiltDeg（状态机给的门槛判读）
 *   另外并排给出 CoM 的侧向/矢状位置与速度（救回律的输入量）
 *
 * 用法：node tools/run.mjs probe-rescue
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);
await import('../src/core/ragdoll');
{
  const p: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const c = await WebAssembly.compile(fs.readFileSync(p));
  const bg = bgNs as any;
  const im: any = {};
  for (const i of WebAssembly.Module.imports(c)) {
    const f = bg[i.name];
    if (typeof f !== 'function') throw new Error(i.name);
    (im[i.module] ??= {})[i.name] = f;
  }
  bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
}
const { buildSkeleton, DEFAULT_CONFIG } = await import('../src/core/skeleton');
const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { shapeForJoints } = await import('../src/core/brain');

const log = (s: string) => console.log(s);
const HZ = 120, DT = 1 / 60;

const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: 2.5 });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, {
  ...DEFAULT_CONTROLLER,
  gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' },
  balance: DEFAULT_CONTROLLER.balance,
});
const d = sim.doll;

log('══ 救回窗口：从站立到"越过门槛"有多少毫秒 ══');
log(`   门槛 rescueMaxTiltDeg = ${ctrl.rs.rescueMaxTiltDeg}°`);
log('   t(s)  state   worst段  倾角  速率°/s  方位°  可救  CoM.z  vz(mm/s)  CoM.x  vx(mm/s)  触地  越界');
let crossing: number | null = null;
let peak = 0;
for (let i = 0; i < 2.5 * HZ && !sim.finished; i++) {
  if (i % 2 === 0) d.setMotorTargets(ctrl.step(DT));
  sim.advance(1);
  if (i % 10 !== 0) continue;
  const rs = ctrl.rs;
  const tr = rs.trends;
  let w = tr.segs[0]!;
  for (const t of tr.segs) if (t.tiltDeg > w.tiltDeg) w = t;
  peak = Math.max(peak, tr.worstTiltDeg);
  const tSec = i / HZ;
  if (crossing === null && !tr.rescueable) crossing = tSec;
  const gc = rs.groundChain;
  const out = gc ? gc.distEdgeZ < 0 : false;
  log(`   ${tSec.toFixed(2).padStart(5)} ${rs.state.padEnd(7)} ${w.name.padEnd(4)}`
    + ` ${tr.worstTiltDeg.toFixed(1).padStart(6)}`
    + ` ${w.rateDeg.toFixed(0).padStart(7)}`
    + ` ${w.azimDeg.toFixed(0).padStart(6)}`
    + `  ${tr.rescueable ? '✓' : '✗'}`
    + `  ${(rs.com.z * 1000).toFixed(0).padStart(5)} ${(rs.com.vz * 1000).toFixed(0).padStart(7)}`
    + `  ${(rs.com.x * 1000).toFixed(0).padStart(5)} ${(rs.com.vx * 1000).toFixed(0).padStart(7)}`
    + `   ${[rs.grounded.l, rs.grounded.r].map((v) => (v ? 1 : 0)).join('')}`
    + `   ${out ? '⚠出界' : ''}`);
}

log('');
log('══ 结论 ══');
log(`   · 死亡原因：${sim.fallReason || '未倒'}　存活 ${(sim.ticksDone / HZ).toFixed(2)}s`);
log(`   · 峰值倾角 ${peak.toFixed(1)}°`);
if (crossing === null) {
  log('   · ✗ **从未越过门槛**（整段都在可救范围）⇒ 救回律有完整窗口');
} else {
  log(`   · 越门槛时刻 t=${crossing.toFixed(2)}s（存活 ${(sim.ticksDone / HZ).toFixed(2)}s）`);
  log(`   · ⇒ 救回窗口 ≈ ${Math.round(crossing * 1000)}ms（此前每一拍都是"还能救"的机会）`);
  log(`   · ⇒ 门槛后还剩 ${Math.round(((sim.ticksDone / HZ) - crossing) * 1000)}ms 才真正倒地`);
}
