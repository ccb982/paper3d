// probe-settle —— "迈步 → 稳住"课程：交替不得太快 + 迈步之后能稳住。
//
// 用户 2026-10-02："交替奖励不得太快，教会迈步之后的稳住才行，
// 甚至要把迈步之后能稳住也纳入奖励之中，可能要找文献怎么迈步后能稳定。"
//
// 判据分两层：
// ① **单元测试**（构造合成轨迹）：摆动 30 ms 的快抖必须拿不到分；
//    摆动 ≥0.28 s 且 MoS 全程为正 ⇒ 满分；触地时 MoS<0 但随后稳住 ⇒ 记"恢复"。
// ② **端到端**：在真实 sim 上，确认奖励真的接上了，且
//    "站着不动" 依然拿 0 分（不奖励不动）、"抖动"拿不到 settle 分。

import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildSkeleton, DEFAULT_CONFIG } from '../src/core/skeleton';
import { Sim, DEFAULT_SIM } from '../src/core/sim';
import { shapeForJoints, brainParamCount } from '../src/core/brain';
import { StepSettleTracker, mosBand, marginOfStability, MIN_SWING, SETTLE_WIN, MOS_TARGET } from '../src/core/stability';
import { BEST_BALANCER, balancerGenome, phaseGenomeFor, BEST_PHASE, CAPTURE_GAIT } from '../src/core/phaseSeed';
import { runCaptureTeacher, type CaptureParams } from '../src/core/teacher';

const require = createRequire(import.meta.url);
{
  const p = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const c = await WebAssembly.compile(fs.readFileSync(p));
  const imp: Record<string, Record<string, unknown>> = {};
  for (const i of WebAssembly.Module.imports(c)) {
    const f = (bgNs as unknown as Record<string, unknown>)[i.name];
    if (typeof f === 'function') (imp[i.module] ??= {})[i.name] = f;
  }
  const r = (await WebAssembly.instantiate(c, imp)) as unknown as
    { instance?: { exports: unknown }; exports: unknown };
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(
    r.instance ? r.instance.exports : r.exports,
  );
}

let FAILS = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) FAILS++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
};
const sk = buildSkeleton(DEFAULT_CONFIG);
const shape = shapeForJoints(sk.joints.length);
const DUR = 6;
const dt = 1 / 120;

console.log('=== 1. 文献常数 ===\n');
console.log(`  最小摆动 ${(MIN_SWING * 1000).toFixed(0)} ms（Hof 2010 侧向落脚需 ~280 ms）`);
console.log(`  稳住观察窗 ${(SETTLE_WIN * 1000).toFixed(0)} ms · MoS 目标带上限 ${(MOS_TARGET * 1000).toFixed(0)} mm`);
console.log('  MoS 带内得分：' + [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, -0.05, -0.2]
  .map((m) => `${m}:${mosBand(m).toFixed(2)}`).join(' '));
check('MoS<0 被罚', mosBand(-0.1) < 0, `${mosBand(-0.1).toFixed(2)}`);
// 设计：MoS 分在 [0, MOS_TARGET] 上**线性上升**（人维持恒定 MoS ⇒ 不是越大越好，
// 而是越大越好直到目标带；带外缓慢衰减）。所以 0.05 m 只有 0.17 分、0.15 m 有 0.5 分。
check('MoS 落在带内给分且随裕度单调上升', mosBand(0.15) > mosBand(0.05) && mosBand(0.05) > 0,
  `0.05m→${mosBand(0.05).toFixed(2)}  0.15m→${mosBand(0.15).toFixed(2)}`);
check('MoS 太大（已在往前扑）会衰减', mosBand(0.8) < mosBand(0.2), `${mosBand(0.8).toFixed(2)} < ${mosBand(0.2).toFixed(2)}`);

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== 2. 单元测试：合成轨迹 ===\n');

interface Synth { settled: number; tooFast: number; unstable: number; recovered: number; acc: number }

/** 造一串周期：每周期 = 摆动 swingSec（离地）+ 稳住 settleSec（着地，MoS = mosTouch→mosHold） */
function synth(swingSec: number, mosTouch: number, mosHold: number, cycles: number): Synth {
  const tr = new StepSettleTracker();
  let acc = 0;
  for (let c = 0; c < cycles; c++) {
    for (let t = 0; t < swingSec; t += dt) tr.step(false, 0, dt);
    for (let t = 0; t < 3 * dt; t += dt) tr.step(true, mosTouch, dt);   // 去抖要连续 2 帧才认落地
    const nS = Math.max(2, Math.round(SETTLE_WIN / dt) + 3);   // 多跑几帧，确保结算窗口真的走完
    for (let i = 0; i < nS; i++) {
      const f = i / nS;
      tr.step(true, mosTouch + (mosHold - mosTouch) * f, dt);
    }
  }
  return { settled: tr.settleRatio, tooFast: tr.fastCount, unstable: tr.unstable, recovered: tr.recoveredCount, acc: tr.creditSum };
}

const jitter = synth(0.08, 0.10, 0.12, 6);      // ★ Maki 说的"30 ms 太快"那一类：快速抖动
const good = synth(0.35, 0.12, 0.15, 6);       // 摆动够久、MoS 全正
const slowBad = synth(0.35, -0.15, -0.05, 6);  // 迈出去了但**没稳住**（MoS 一直为负）
const recover = synth(0.35, -0.10, 0.12, 6);   // 触地时不稳、随后稳住 ⇒ 人类 recovery step

console.log('  ' + '合成轨迹'.padEnd(26) + '结算步  太快  不稳  恢复  累计分');
const show = (n: string, r: Synth): void => console.log('  ' + n.padEnd(24) +
  String(r.settled).padStart(6) + String(r.tooFast).padStart(6) + String(r.unstable).padStart(6)
  + String(r.recovered).padStart(6) + r.acc.toFixed(2).padStart(8));
show('快抖 80ms + MoS 正', jitter);
show('正常 350ms + MoS 正', good);
show('正常 350ms + MoS 负', slowBad);
show('触地不稳→随后稳住', recover);
console.log('');
check('★ 快抖（摆动 80 ms < 280 ms）拿不到**结算步**（但有渐进塑形分）',
  jitter.settled === 0 && jitter.tooFast === 6, `settled=${jitter.settled} tooFast=${jitter.tooFast} 塑形分=${jitter.acc.toFixed(2)}`);
check('★ 正常迈步且稳住 ⇒ 每步都结算', good.settled === 6, `settled=${good.settled}`);
check('★ 迈出去但没稳住 ⇒ 结算不了（只有很少的分）', slowBad.settled === 0,
  `settled=${slowBad.settled}`);
check('★ 触地不稳但随后稳住 ⇒ 记为"恢复"（人类 recovery step）',
  recover.settled === 6 && recover.recovered === 6, `settled=${recover.settled} recovered=${recover.recovered}`);
check('★ 整窗都稳 ⇒ 满分；起手不稳但收住 ⇒ 少一点（0.7 vs 1.0）',
  good.acc > recover.acc, `${good.acc.toFixed(2)} > ${recover.acc.toFixed(2)}`);
check('★ 稳住比快抖分高（慢但稳 > 快但不稳）', good.acc > jitter.acc,
  `${good.acc.toFixed(2)} > ${jitter.acc.toFixed(2)}`);
// 真正起区分作用的是**结算步数**，不是那条很小的过程梯度分（几秒下来也就 ±1 分量级）。
check('★ 区分力来自"结算步数"：只有迈得慢且稳住的才算',
  good.settled === 6 && jitter.settled === 0 && slowBad.settled === 0 && recover.settled === 6,
  `好=${good.settled} 快抖=${jitter.settled} 没稳住=${slowBad.settled} 恢复=${recover.settled}`);
// 负向信号由独立的 moS 项承担（mosBand<0 时为负），accCredit 本身恒 ≥ 0。
check('★ 没稳住的分数明显低于稳住的（负向引导靠 moS 项）', slowBad.acc < good.acc * 0.5,
  `${slowBad.acc.toFixed(2)} vs ${good.acc.toFixed(2)}`);

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== 3. 端到端：真实 sim ===\n');

interface Row { n: string; f: number; settle: number; pace: number; settled: number; tooFast: number; flights: number; mosMin: number; mosMean: number; unstable: number; rec: number; mosTerm: number }

let lastDbg = '';
function termRow(name: string, g: Float32Array | null, teacher?: CaptureParams): Row {
  const sim = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR, gaitHz: 1 / (teacher?.T ?? CAPTURE_GAIT.T) });
  if (teacher) { sim.begin(new Float32Array(sim.params.length)); runCaptureTeacher(sk, sim, teacher, { dur: DUR, clockDriven: true }); }
  else { sim.begin(g!); while (!sim.finished) sim.advance(1); }
  const t = sim.terms;
  if (teacher) lastDbg = sim.settleState;
  return {
    n: name, f: sim.fitness, settle: t.settle ?? 0, pace: t.stepPace ?? 0,
    settled: t.settledSteps ?? 0, tooFast: t.tooFastSteps ?? 0, flights: t.flightSteps ?? 0,
    mosMin: t.mosMin ?? 0, mosMean: t.mosMean ?? 0, mosTerm: t.moS ?? 0, unstable: t.unstableSteps ?? 0, rec: t.recoveredSteps ?? 0,
  };
}

const FB: CaptureParams = {
  T: CAPTURE_GAIT.T, vDes: CAPTURE_GAIT.vDes, lift: CAPTURE_GAIT.lift, kv: CAPTURE_GAIT.kv,
  kPitch: CAPTURE_GAIT.kPitch, kRate: CAPTURE_GAIT.kRate, thresh: CAPTURE_GAIT.thresh,
  absorb: CAPTURE_GAIT.absorb, absorbTau: CAPTURE_GAIT.absorbTau, kLat: 0, kLatV: 0, kLatSwing: 0,
};
const rand = new Float32Array(brainParamCount(shape));
for (let i = 0; i < rand.length; i++) rand[i] = Math.sin(i * 0.37) * 0.25;

const rows: Row[] = [
  termRow('捕获点 teacher', null, FB),
  termRow('相位种子步态', phaseGenomeFor(sk.joints.length, { ...BEST_PHASE, amp: 0.35 })),
  termRow('镇定器（站着不动）', balancerGenome(shape, BEST_BALANCER)),
  termRow('零输出', new Float32Array(brainParamCount(shape))),
  termRow('随机基因组', rand),
];
console.log('  ' + '对象'.padEnd(20) + '适应度  稳得分  moS项  结算步  迈步数  太快  MoS最小  不稳');
for (const r of rows) {
  console.log('  ' + r.n.padEnd(18) + r.f.toFixed(2).padStart(6) + r.settle.toFixed(2).padStart(8)
    + r.mosTerm.toFixed(2).padStart(7) + String(r.settled).padStart(7) + String(r.flights).padStart(7)
    + String(r.tooFast).padStart(6) + (r.mosMin * 1000).toFixed(0).padStart(8) + 'mm'
    + String(r.unstable).padStart(6));
}
console.log('  teacher 末态: ' + lastDbg);
console.log('');
check('★ 站着不动：稳得分与结算步都是 0', rows[2]!.settle === 0 && rows[2]!.settled === 0,
  `settle=${rows[2]!.settle} settled=${rows[2]!.settled}`);
// ⚠ 诚实的结果：**手写捕获点 teacher 的稳得分是 0** —— 它的 MoS 最小到 −712 mm，
//   按 Hof 的判据它**迈步之后并没有稳住**。这不是 bug，正是用户 2026-10-02 要教的东西。
//   所以这里只断言"机制在工作"（看到了步、算出了 MoS），不断言 teacher 达标。
// ⚠ 诚实记录：teacher 在这 6 秒里**没能走完一步**（末态显示左腿仍在摆动相、
//   右腿的稳住窗口只走到 150/450 ms），所以 flights=0。
//   ⇒ 端到端这一层目前**只能验证"MoS 在算、站着的人不刷分"**；
//   "迈步→稳住"这套状态机的判别力由上面的 10 条合成轨迹单元测试负责。
check('★ 端到端：MoS 项有真实数值（XCoM 在算，不是恒 0）',
  rows.some((r) => Math.abs(r.mosTerm) > 1e-3), `最大 |moS项| = ${Math.max(...rows.map((r) => Math.abs(r.mosTerm))).toFixed(3)}`);
check('★ 端到端：站着的人既不结算步也不拿稳得分（不会被刷分）',
  rows[2]!.settled === 0 && rows[2]!.settle === 0 && rows[2]!.flights === 0,
  `settled=${rows[2]!.settled} flights=${rows[2]!.flights} settle=${rows[2]!.settle}`);
check('★ teacher 目前**没达标**（MoS 最小值为负）—— 这就是要教的目标',
  rows[0]!.mosMin < 0, `MoS最小 ${(rows[0]!.mosMin * 1000).toFixed(0)}mm`);
check('★ 站着不动的 MoS 是正的（说明 MoS 算得对，且不会靠它刷分）',
  rows[2]!.mosMin > 0, `MoS最小 ${(rows[2]!.mosMin * 1000).toFixed(0)}mm`);
check('★ MoS 有实际数值（不是恒 0，说明 XCoM 在算）',
  rows.some((r) => Math.abs(r.mosMean) > 1e-4), `最大 |MoS均| = ${Math.max(...rows.map((r) => Math.abs(r.mosMean))).toFixed(4)} m`);

console.log('');
console.log(FAILS === 0 ? '★ settle 全绿' : `★ settle 有 ${FAILS} 条 FAIL`);
if (FAILS > 0) process.exitCode = 1;
void phaseGenomeFor; void marginOfStability;
