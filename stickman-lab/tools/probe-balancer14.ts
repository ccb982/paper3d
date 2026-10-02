// probe-balancer14 —— 按 **14 关节**（踝开启）重跑镇定器搜索。
//
// 为什么必须重跑（用户 2026-10-02）：`BEST_BALANCER` 是在**踝关闭的 12 关节**几何上搜出来的
// （kComX=−3.102 等）。踝一开就是 14 关节，网络的输出映射全变 ⇒ 旧镇定器 1.9 s 必倒，
// 而且踝的 kP/kD 怎么调都没用（25 个组合全部恰好 1.9 s ⇒ 与马达刚度无关）。
// 几何本身已经中性（脚底 y=0、躯干高相同、CoM 差 5.7 mm），所以这一轮只搜反馈增益。
//
// 搜法：坐标下降（与当初找 BEST_BALANCER 同一手法），目标 =
//   存活时长（优先活满 8 s）+ 躯干高度 + 倾角小 + CoM 在支撑域内

import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildSkeleton, DEFAULT_CONFIG } from '../src/core/skeleton';
import { Sim, DEFAULT_SIM } from '../src/core/sim';
import { shapeForJoints } from '../src/core/brain';
import { balancerGenome, BEST_BALANCER, type BalancerSpec } from '../src/core/phaseSeed';

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

const DUR = 8;
const sk14 = buildSkeleton({ ...DEFAULT_CONFIG, ankleEnabled: true } as never);
const shape14 = shapeForJoints(sk14.joints.length);
const sk12 = buildSkeleton(DEFAULT_CONFIG);
const shape12 = shapeForJoints(sk12.joints.length);
console.log(`12 关节（踝关） vs 14 关节（踝开）：shape ${shape12.inputs}→${shape14.inputs} 输入，`
  + `${shape12.outputs}→${shape14.outputs} 输出\n`);

interface R { t: number; y: number; tilt: number; fell: boolean }
function evalSpec(s: BalancerSpec, ankle: boolean): R {
  const sk = ankle ? sk14 : sk12;
  const shape = ankle ? shape14 : shape12;
  const sim = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR } as never);
  sim.begin(balancerGenome(shape, s));
  let n = 0;
  while (!sim.finished) { sim.advance(1); n++; }
  return {
    t: n / 120, y: sim.doll.torso().translation().y, tilt: sim.doll.tiltOf(sim.doll.torso()),
    fell: sim.fallen,
  };
}
/** 目标：活得久 + 站得高 + 站得直 */
const cost = (r: R): number => r.t * 3 + r.y * 2 - Math.abs(r.tilt) * 4 + (r.fell ? -5 : 0);

console.log('=== 起点：12 关节搜出来的 BEST_BALANCER 直接搬到 14 关节 ===\n');
const r0 = evalSpec(BEST_BALANCER, false);
const r1 = evalSpec(BEST_BALANCER, true);
console.log(`  12 关节: 存活 ${r0.t.toFixed(2)}s 躯干 ${r0.y.toFixed(3)}m 倾角 ${(r0.tilt * 180 / Math.PI).toFixed(1)}°`);
console.log(`  14 关节: 存活 ${r1.t.toFixed(2)}s 躯干 ${r1.y.toFixed(3)}m 倾角 ${(r1.tilt * 180 / Math.PI).toFixed(1)}°  ← 搬过来就倒`);
check('复现"踝一开就倒"', r1.t < r0.t - 1 || r1.fell, `${r1.t.toFixed(2)}s vs ${r0.t.toFixed(2)}s`);

console.log('\n=== 坐标下降重搜（14 关节）===\n');
let best: BalancerSpec = { ...BEST_BALANCER };
let bc = cost(evalSpec(best, true));
console.log(`  起点 cost=${bc.toFixed(3)}`);
// ★★ 先搜**踝自身的反馈**：矢状面踝策略（俯仰→踝 pitch）+ 额状面把 CoP 推向 CoM。
//   此前踝的输出恒为 0（纯被动关节），对平衡零贡献 —— 这是踝开启时站不住的直接原因之一。
const KEYS: (keyof BalancerSpec)[] =
  ['kAnkPitch', 'kAnkRoll', 'kAnkRate', 'kComX', 'kPitch', 'kRate', 'knee', 'bias', 'osc'];
const RANGE: Record<keyof BalancerSpec, [number, number]> = {
  kPitch: [-0.2, 0.2], kRate: [-0.2, 0.2], kComX: [-6, 2],
  bias: [-0.3, 0.3], knee: [-0.3, 0.3], osc: [0, 0.3],
  kAnkPitch: [-0.4, 0.4], kAnkRate: [-0.4, 0.4], kAnkRoll: [-0.8, 0.8],
};
let stall = 0;
for (let step = 0.4, it = 0; it < 300 && step > 5e-4; it++, step *= 0.985) {
  let improved = false;
  for (const k of KEYS) {
    for (const d of [step, -step]) {
      const cand: BalancerSpec = { ...best };
      cand[k] = Math.max(RANGE[k][0], Math.min(RANGE[k][1], cand[k] + d));
      const c = cost(evalSpec(cand, true));
      if (c > bc) { bc = c; best = cand; improved = true; }
    }
  }
  if (improved) stall = 0; else if (++stall > 8) break;   // 连续 8 轮无改进就停
}
const rb = evalSpec(best, true);
console.log('');
console.log(`  ★ 14 关节最优: { ${KEYS.map((k) => `${k}: ${best[k].toFixed(3)}`).join(', ')} }`);
console.log(`    存活 ${rb.t.toFixed(2)}s 躯干 ${rb.y.toFixed(3)}m 倾角 ${(rb.tilt * 180 / Math.PI).toFixed(1)}° 倒=${rb.fell}`);
console.log('');
console.log('  kComX=−3.1 → ' + best.kComX.toFixed(3) + '（旧值是按 12 关节几何标定的）');
check('★ 踝开启时也能站满 8 s（14 关节镇定器找到了）', rb.t >= 7.5 && !rb.fell, `${rb.t.toFixed(2)}s`);
console.log('');
console.log('  ⇒ 把这组参数写进 phaseSeed.BEST_BALANCER_ANKLE（与 12 关节那份并存），');
console.log('    之后踝的 kP/kD 扫描才会开始有区别（此前 25 个组合全是同一个 1.9 s）。');

console.log('');
console.log(FAILS === 0 ? '★ balancer14 全绿' : `★ balancer14 有 ${FAILS} 条 FAIL`);
if (FAILS > 0) process.exitCode = 1;
