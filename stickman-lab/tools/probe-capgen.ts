// probe-capgen —— 捕获点控制器的**基因组版**能不能走？（决定 ES 的种子够不够好）
//
// ★ 为什么要做这个：手写控制器（tools/probe-capture.ts）能走 0.625 m / 4 步 / 4.32 s，
//   但它是"状态机 + IK"，塞不进 4228 个权重。把它的核心降维成
//   "线性反馈 + 相位锁定振荡"（phaseSeed.captureGenome）之后，
//   就能问一个关键问题：**纯线性近似能保住多少性能？**
//   如果保得住，ES 就有个好起点；如果保不住（走不动），说明
//   "手写会走、但学不会" 的差距在**非线性**上，奖励/ES 的问题就板上钉钉了。

import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildSkeleton, DEFAULT_CONFIG } from '../src/core/skeleton';
import { Sim, DEFAULT_SIM } from '../src/core/sim';
import { shapeForJoints } from '../src/core/brain';
import {
  CAPTURE_GENOME_0, captureGenome, type CaptureGenomeSpec,
} from '../src/core/phaseSeed';

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
    { instance?: { exports: unknown }; exports: unknown };
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(
    r.instance ? r.instance.exports : r.exports,
  );
}

const sk = buildSkeleton(DEFAULT_CONFIG);
const shape = shapeForJoints(sk.joints.length);
const DUR = 8;

function run(s: CaptureGenomeSpec): { x: number; t: number; steps: number; alive: boolean } {
  const sim = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR });
  sim.begin(captureGenome(shape, s));
  let n = 0;
  while (!sim.finished) { sim.advance(1); n++; }
  return { x: sim.distance, t: n / 120, steps: sim.terms.altCount ?? 0, alive: !sim.fallen };
}

let FAILS = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) FAILS++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
};

const b0 = run(CAPTURE_GENOME_0);
console.log(`  初值: 位移 ${b0.x.toFixed(3)}m 存活 ${b0.t.toFixed(2)}s 换脚 ${b0.steps}`);

// 手写捕获点控制器的成绩（tools/probe-capture.ts 的实测），作对照
const HAND = { x: 0.625, t: 4.32, steps: 4 };
// 手写捕获点控制器的成绩（tools/probe-capture.ts 的实测），作对照
console.log('  对照｜手写捕获点控制器: 位移 0.625 m / 存活 4.32 s / 真实换脚 4（IK + 状态机）');

interface Res { hi: number; x: number; t: number; steps: number; alive: boolean }
/** 跑一次并顺带量"脚抬多高"（区分"抬腿"和"整体蹦跳"） */
function liftOf(s: CaptureGenomeSpec): Res {
  const sim = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR });
  sim.begin(captureGenome(shape, s));
  let hi = 0, n = 0;
  while (!sim.finished) {
    sim.advance(1); n++;
    hi = Math.max(hi, sim.doll.soleY('l'), sim.doll.soleY('r'));
  }
  return { hi, x: sim.distance, t: n / 120, steps: sim.terms.altCount ?? 0, alive: !sim.fallen };
}
const score = (r: Res): number =>
  (r.steps >= 2 ? 10 : r.steps >= 1 ? 4 : -10) + (r.alive ? 5 : 0) + r.x + 0.5 * r.t;

// ★ 直接量"摆动幅度 × Raibert 落脚增益"——比让坐标下降自己猜靠谱（它两次都收敛到"站着不动"）
console.log('');
console.log('  摆动幅度 × Raibert 落脚增益 → 脚最高点 / 换脚 / 位移 / 存活');
console.log('  抬腿幅度（符号已翻正）× 落脚增益 → 脚离地 / 换脚 / 位移 / 存活');
console.log('    amp    kRaib   脚最高(m)  换脚   位移     存活');
let bw: CaptureGenomeSpec | null = null, bs = -1e9;
for (const amp of [0.5, 1.0, 1.5, 2.0]) {
  for (const kRaib of [0, -1.5, -3, -6]) {
    const sp: CaptureGenomeSpec = { ...CAPTURE_GENOME_0, amp, kneeAmp: 0.35, kneeBias: -0.05, kLoad: 0, kRaib };
    const r = liftOf(sp);
    if (score(r) > bs) { bs = score(r); bw = sp; }
    console.log('   ' + amp.toFixed(2).padStart(5) + '  ' + kRaib.toFixed(2).padStart(6) +
      '    ' + r.hi.toFixed(3) + '     ' + String(r.steps).padStart(3) +
      '  ' + r.x.toFixed(3).padStart(6) + '  ' + r.t.toFixed(2) + 's');
  }
}

console.log('');
if (bw) {
  const r = liftOf(bw);
  console.log('  ★ 扫描最优: ' + JSON.stringify(bw));
  console.log('  ★ 位移 ' + r.x.toFixed(3) + ' m / 存活 ' + r.t.toFixed(2) + ' s / 换脚 ' + r.steps +
    ' / 脚最高 ' + r.hi.toFixed(3) + ' m');
  check('基因组版能踩出单腿支撑（不是滑行、不是整体蹦跳）', r.steps >= 1, '换脚 ' + r.steps);
  check('基因组版方向为正', r.x > 0, r.x.toFixed(3) + ' m');
  check('存活不短于零输出基线（1.83 s）', r.t >= 1.83, r.t.toFixed(2) + 's');
}
console.log('');
console.log(FAILS === 0 ? '★ capgen 全绿' : '★ capgen 有 ' + FAILS + ' 条 FAIL');
