// probe-closed —— 回答用户 2026-10-01 的问题：
//   "训练出来的究竟是什么东西？是一段参数记录着运动状态，换个环境就处理不了了？甚至无法和外界交互？"
//
// 做法不是讲道理，是**做消融实验**：
//   ① 完整观测           → 基准轨迹
//   ② 只留时钟（其余置零）→ 如果轨迹**几乎不变**，说明网络其实是个开环振荡器（纯回放）
//   ③ 去掉关节反馈        → 轨迹变化 = 关节角真的被用了
//   ④ 去掉躯干姿态/速度    → 轨迹变化 = 平衡信息真的被用了
//   ⑤ 训练完的基因组 + 侧向推一把 → 轨迹变化 = 真的有反馈（不是死板的回放）
//
// 结论判据：任一消融让轨迹明显改变 ⇒ 那一路观测是活的（闭环）；完全不变 ⇒ 那一路是摆设。

import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildSkeleton, DEFAULT_CONFIG, JOINT_ORDER } from '../src/core/skeleton';
import { Sim, DEFAULT_SIM } from '../src/core/sim';
import { shapeForJoints, brainParamCount } from '../src/core/brain';
import { Trainer, DEFAULT_TRAINER, type TrainerConfig } from '../src/core/evolution';
import { BEST_PHASE, phaseGenomeFor } from '../src/core/phaseSeed';

const require = createRequire(import.meta.url);
{
  const p = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const compiled = await WebAssembly.compile(fs.readFileSync(p));
  const bg = bgNs as unknown as Record<string, (...a: unknown[]) => unknown>;
  const imports: WebAssembly.Imports = {};
  for (const imp of WebAssembly.Module.imports(compiled)) {
    const f = bg[imp.name];
    if (typeof f === 'function') (imports[imp.module] ??= {})[imp.name] = f;
  }
  const r = (await WebAssembly.instantiate(compiled, imports)) as unknown as
    { instance?: { exports: unknown }; exports?: unknown };
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(
    r.instance ? r.instance.exports : r.exports,
  );
}

const sk = buildSkeleton(DEFAULT_CONFIG);
const shape = shapeForJoints(sk.joints.length);
console.log(`\n══ 训练出来的到底是什么 ══`);
console.log(`  网络：${shape.inputs} 输入 → ${shape.hidden} 隐层 → ${shape.outputs} 输出`
  + ` ＝ ${brainParamCount(shape)} 个浮点数`);
console.log(`  输入构成：时钟(2) + 躯干四元数(4) + 线速度(3) + 角速度(3) + 高度(1) + 侧向位置(1)`);
console.log(`          + CoM 相对支撑域(2) + CoM 速度(2) + DCM(2) + 脚底高度(2)`
  + ` + 每关节角(3×${shape.outputs / 3}) + 每关节角速度(3×${shape.outputs / 3})`);
console.log(`  输出：每个关节 3 个数 = 目标**关节角**（PD 控制器去追），不是力矩、不是回放序列。`);

// 训练几代，拿一个真训出来的基因组
const cfg: TrainerConfig = { ...DEFAULT_TRAINER, population: 48, seedGait: true };
const tr = new Trainer(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 6 }, cfg, 20261001);
for (let g = 1; g <= 8; g++) { let guard = 0; while (tr.history.length < g && guard++ < 200000) tr.tick(2400); }
const trained = tr.bestEver.slice();
console.log(`\n  训练 8 代后的最优基因组：${trained.length} 个数`);

interface Traj { x: number; z: number; tilt: number; knees: number[]; path: number[] }
function run(g: Float32Array, obsMask?: { clock?: boolean; quat?: boolean; vel?: boolean; joint?: boolean },
  pushAt = -1, pushZ = 0, pushX = 0): Traj {
  const sim = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 4, obsMask });
  sim.begin(g);
  const knees: number[] = [];
  const path: number[] = [];
  let i = 0;
  const body = sim.doll.bodies[sk.bodies.findIndex((b) => b.key === 'torso')];
  while (!sim.finished && i < 4 * 120) {
    sim.advance(2);
    i++;
    if (i === pushAt) body.applyImpulse({ x: pushX, y: 0, z: pushZ }, true);
    if (i % 12 === 0) {
      const t = body.translation();
      path.push(t.x);
      if (knees.length < 4) {
        knees.push(sim.doll.jointAngle(JOINT_ORDER.indexOf('knee_l')));
      }
    }
  }
  const t = body.translation();
  return { x: t.x, z: t.z, tilt: sim.doll.tiltOf(body), knees, path };
}

const dist = (a: number[], b: number[]): number => {
  let s = 0, n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { s += (a[i] - b[i]) ** 2; n++; }
  return Math.sqrt(s / Math.max(1, n));
};

console.log(`\n  消融                          终点x    终点z   躯干倾角  与基准的轨迹偏差`);
const base = run(trained);
const rows: [string, Traj][] = [
  ['① 完整观测（基准）', base],
  ['② 只留时钟（关节+姿态全置零）', run(trained, { joint: true, quat: true, vel: true })],
  ['③ 去掉关节反馈', run(trained, { joint: true })],
  ['④ 去掉躯干姿态+角速度', run(trained, { quat: true, vel: true })],
  ['⑤a 侧向推 30 N·s @0.25s', run(trained, undefined, 30, 30)],
  ['⑤b 侧向推 30 N·s @0.50s', run(trained, undefined, 60, 30)],
  ['⑤c 前后推 30 N·s @0.50s', run(trained, undefined, 60, 0, 30)],
];
for (const [name, t] of rows) {
  console.log(`  ${name.padEnd(24)} ${t.x.toFixed(3).padStart(6)}  ${t.z.toFixed(3).padStart(6)}`
    + `  ${(t.tilt * 57.3).toFixed(1).padStart(6)}°  ${dist(base.path, t.path).toFixed(4).padStart(8)}`);
}
console.log(`\n  判读：偏差 ≈ 0 ⇒ 那一路观测没被用（网络是开环振荡器）；偏差明显 ⇒ 是活的闭环反馈。`);
console.log(`  另：种子手工步态作对照（它是纯时钟驱动的开环基因组）`);
const seed = phaseGenomeFor(sk.joints.length, { ...BEST_PHASE, scale: 0.15, legPhase: 1 });
const sBase = run(seed);
const sClock = run(seed, { joint: true, quat: true, vel: true });
console.log(`     手工种子：完整 ${sBase.x.toFixed(3)}m / 只留时钟 ${sClock.x.toFixed(3)}m`
  + `  偏差 ${dist(sBase.path, sClock.path).toFixed(4)}`);
