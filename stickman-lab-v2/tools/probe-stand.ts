/**
 * probe-stand.ts —— 站立验收（平衡控制器版）
 *
 * 模式：
 *   · `stand`（默认）：重力补偿 + 姿势张力 + 踝策略 + 矢状/侧向 CoM 控制
 *   · `passive`：关驱动（纯被动塌倒对照）
 *
 * 用法：node tools/run.mjs probe-stand [seconds] [stand|passive]
 */
import './_boot';
import { World } from '../src/core/world';
import { BalanceController } from '../src/core/balance';

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const SECONDS = Number(ARGS[0] ?? 10);
const MODE = (ARGS[1] ?? 'stand') as 'stand' | 'passive';

const w = new World();
const chest = w.body.indexByKey.get('spine4') ?? 0;
if (MODE === 'stand') {
  const bal = new BalanceController(w, {
    gravityComp: true, comKp: 12, comKd: 5, maxForceFrac: 0.35,
    postureTone: 8, lateralControl: true,
  });
  w.controller = bal;
} else {
  w.driveEnabled = false;
}
w.reset();

const weight = w.sk.massTotal * 9.81;
const y0 = w.body.bodies[chest]!.translation().y;
console.log('════ 站立验收（平衡控制器）════');
console.log(`模式=${MODE}  ${SECONDS}s @${Math.round(1 / w.dt)}Hz  胸 y0=${y0.toFixed(4)} m  体重=${weight.toFixed(0)}N`);

let peakW = 0;
const N = Math.round(SECONDS / w.dt);
for (let s = 0; s < N; s++) {
  w.advance(1);
  const sw = w.totalRelVel();
  if (sw > peakW) peakW = sw;
  if (s % Math.round(1 / w.dt) === 0) {
    const y = w.body.bodies[chest]!.translation().y;
    const fz = w.body.footNormalForce('l', w.dt) + w.body.footNormalForce('r', w.dt);
    console.log(`  t=${(s * w.dt).toFixed(0)}s  胸y=${y.toFixed(4)}  ΣFz=${(fz / weight * 100).toFixed(0)}%体重  Σ|ω|=${sw.toFixed(2)}`);
  }
}
const y1 = w.body.bodies[chest]!.translation().y;
const fz = w.body.footNormalForce('l', w.dt) + w.body.footNormalForce('r', w.dt);
console.log('');
console.log(`末态：胸 y=${y1.toFixed(4)}（Δ=${((y1 - y0) * 1000).toFixed(0)}mm）  ΣFz=${(fz / weight * 100).toFixed(0)}%体重`);
console.log(`Σ|ω| 峰值=${peakW.toFixed(2)}  执行器不变量：${w.executor.checkInvariants().length === 0 ? '通过' : '失败'}`);
console.log(`判定：${y1 > 1.3 && fz > 0.8 * weight ? '站住' : '未站住'}`);
