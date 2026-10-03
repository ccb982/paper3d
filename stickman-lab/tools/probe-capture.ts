// 手写"捕获点行走控制器"：摆动脚落到 ξ（捕获点）附近，而不是按正弦摆。
// 用户 2026-10-01："压根走不起来" ⇒ 先证明这个骨架物理上能不能走。
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildSkeleton, DEFAULT_CONFIG } from '../src/core/skeleton';
import { Sim, DEFAULT_SIM } from '../src/core/sim';
import { shapeForJoints } from '../src/core/brain';
import { CAPTURE_GAIT } from '../src/core/phaseSeed';
import { CAPTURE_DEFAULT, runCaptureTeacher, type CaptureParams } from '../src/core/teacher';

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

const sk = buildSkeleton(DEFAULT_CONFIG);
const SH = shapeForJoints(sk.joints.length);

type Params = CaptureParams;

/** 跑一段 teacher（实现已搬到 src/core/teacher.ts，那里是单一真源，克隆探针也用它采数据） */
function run(p: Params, dur = 8): { x: number; alive: boolean; steps: number; t: number } {
  const sim = new Sim(sk, SH, { ...DEFAULT_SIM, mode: 'walk', duration: dur });
  sim.begin(new Float32Array(sim.params.length));
  const r = runCaptureTeacher(sk, sim, p, { dur });
  // ★ 顺带报 Sim 自己的换脚检测器数（altEvent）——teacher 内部的"换支撑脚"次数
  //   和"物理上真的出现单腿支撑"不是一回事，必须分开看。
  // ★ teacher 的**适应度**：用来标定奖励权重 —— 目标很明确：
  //   "会走的手写控制器"必须是适应度冠军，否则权重配得再漂亮也没用
  //   （实测 ES 的最优解是"站着扭关节"，jointMove=2.81，而走路项最多 ~0.3）。
  console.log(`    ↳ teacher 适应度 ${sim.fitness.toFixed(2)}`
    + ` · lift=${(sim.terms.lift ?? 0).toFixed(2)} single=${(sim.terms.single ?? 0).toFixed(2)}`
    + ` velTrack=${(sim.terms.velTrack ?? 0).toFixed(2)} jointMove=${(sim.terms.jointMove ?? 0).toFixed(2)}`);
  console.log(`    ↳ teacher 内部换脚 ${r.steps} 次 · Sim 的 altEvent 检测到 ${sim.terms.altCount ?? 0} 次`
    + ` · 单腿支撑时间占比 ${sim.walkStat.singleRatio.toFixed(3)}`);   // ⚠ 字段在 walkStat 上，不在 terms 上（我先写错过）
  return { x: r.x, alive: r.alive, steps: r.steps, t: r.t };
}

// ── 阶段 1：俯仰反馈的**符号**（之前坐标下降选到 +1.24，而 trace 显示它在放大前扑）──
// ★ 参数真源 = phaseSeed.CAPTURE_GAIT（探针搜出来的，UI/训练共用同一份）
/** // ★ 参数来自 core/teacher.ts 的 CAPTURE_DEFAULT（唯一真源）。
//   此前每个探针各内联一份 FB，实测互不相同：probe-capture 的 kLat=0（侧向全关）
//   与 probe-arch 的 kLat=3.5 是两个不同的控制器，却一直被当成同一个在比。
 */
const FB: Params = CAPTURE_DEFAULT;
console.log('  阶段 1：俯仰反馈符号 × 落地吸能');
console.log('   kPitch  kRate  absorb   位移     存活   换脚');
let best = { ...FB }, bs = run(best);
console.log(`   ${FB.kPitch.toFixed(2).padStart(5)}  ${FB.kRate.toFixed(2).padStart(5)}  ${FB.absorb.toFixed(2).padStart(5)}   ${bs.x.toFixed(3)}m  ${bs.t.toFixed(2)}s  ${bs.steps}  (基准)`);
for (const kPitch of [-2, -1, -0.4, 0.4, 1, 2]) {
  for (const absorb of [0, 0.2, 0.4]) {
    const p: Params = { ...FB, kPitch, absorb };
    const r = run(p);
    const better = r.t > bs.t + 1e-9 || (Math.abs(r.t - bs.t) <= 1e-9 && r.x > bs.x);
    if (better) { best = p; bs = r; }
    console.log(`   ${kPitch.toFixed(2).padStart(5)}  ${FB.kRate.toFixed(2).padStart(5)}  ${absorb.toFixed(2).padStart(5)}   ${r.x.toFixed(3)}m  ${r.t.toFixed(2)}s  ${r.steps}${better ? '  ←' : ''}`);
  }
}
console.log(`
  阶段 1 结果: kPitch=${best.kPitch} absorb=${best.absorb} → 位移 ${bs.x.toFixed(3)}m 存活 ${bs.t.toFixed(2)}s 换脚 ${bs.steps}`);

// ── 阶段 2：在阶段 1 最好的基础上补齐其余参数 ──
console.log('');
console.log('  阶段 2：其余参数细化');
// ★ 目标必须是"活着 **且** 往前走 **且** 真的迈步"，否则搜索会买最便宜的稳定：
//   只按存活搜的话，"永远不迈步"能拿满分（实测 thresh=0.45 → 0 次换脚、活满 8 s）。
const RANGE: Partial<Record<keyof Params, [number, number]>> = {
  T: [0.5, 2.5], vDes: [0.2, 1.0], lift: [0.02, 0.15], kv: [-0.6, 0.6],
  kRate: [-1.5, 1.5], absorbTau: [0.1, 0.8], thresh: [0.02, 0.12],
  kPitch: [-3, 3], absorb: [0, 0.6],
};
const scoreOf = (r: { x: number; alive: boolean; steps: number; t: number }): number =>
  (r.alive ? 20 : 0) + r.x + 0.6 * r.steps + 0.5 * r.t;
const clampP = (p: Params): Params => {
  const q = { ...p };
  for (const k of Object.keys(RANGE) as (keyof Params)[]) {
    const r = RANGE[k]!;
    q[k] = Math.max(r[0], Math.min(r[1], q[k]));
  }
  return q;
};
let step2 = 0.2;
for (let it = 0; it < 250 && step2 > 5e-3; it++) {
  let improved = false;
  for (const key of ['T', 'vDes', 'lift', 'kv', 'kRate', 'kPitch', 'absorb', 'absorbTau', 'thresh'] as (keyof Params)[]) {
    for (const d of [step2, -step2]) {
      const p = clampP({ ...best, [key]: best[key] + d });
      const r = run(p);
      if (scoreOf(r) > scoreOf(bs) + 1e-9) { best = p; bs = r; improved = true; }
    }
  }
  if (!improved) step2 *= 0.6;
}
console.log(`  ★ 参数 ${JSON.stringify(best, (k, v) => (typeof v === 'number' ? +v.toFixed(4) : v))}`);
console.log(`  ★ 结果: 位移 ${bs.x.toFixed(3)} m · 存活 ${bs.t.toFixed(2)} s · 换脚 ${bs.steps} · 活满=${bs.alive}`);

const zero = run({ ...best, T: 0, thresh: 1e9, lift: 0, kv: 0, vDes: 0, kPitch: 0, kRate: 0, absorb: 0 }, 8);
let FAILS = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) FAILS++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
};
console.log(`  零输出基线: 位移 ${zero.x.toFixed(3)} m · 存活 ${zero.t.toFixed(2)} s · 换脚 ${zero.steps}`);
check('★ 捕获点控制器能踩出单腿支撑（不是滑行）', bs.steps >= 3, `换脚 ${bs.steps} 次`);
check('★ 前进方向为正（CoM 真的在往前移）', bs.x > 0.3, `${bs.x.toFixed(3)} m`);
check('★ 比零输出基线活得久', bs.t > zero.t, `${bs.t.toFixed(2)}s vs ${zero.t.toFixed(2)}s`);
console.log(FAILS === 0 ? '★ capture 全部通过' : `★ capture 有 ${FAILS} 条 FAIL`);
