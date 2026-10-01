// probe-fit —— 把"实际能做到的关节轨迹"用最小二乘拟到时钟基上，产出可直接粘进程序的系数。
//
// 为什么需要（用户 2026-10-01："精确控制各个关节"）：
//   程序的参考如果是"下发的命令角"，那是个**不可达**的目标 —— 马达力矩 + 地面 + 重力
//   让实际关节角只有命令的 1/3 左右，jt 项会是一个恒定的巨大误差，ES 只能把分往负里拉。
//   正确做法：先量"实际轨迹"，再把它写成程序。相位也不用猜 —— 用 sin/cos 两个自由度，
//   最小二乘自动把相位拟合进去。
//
// 用法：node tools/run.mjs probe-fit [scale] [legPhase]

import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildSkeleton, DEFAULT_CONFIG, JOINT_ORDER } from '../src/core/skeleton';
import { Sim, DEFAULT_SIM } from '../src/core/sim';
import { shapeForJoints } from '../src/core/brain';
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
const SHAPE = shapeForJoints(sk.joints.length);
const AXIS: Record<string, number> = {
  spine1: 0, spine2: 0, spine3: 0,
  shoulder_l: 2, shoulder_r: 2, elbow_l: 2, elbow_r: 2,
  hip_l: 2, hip_r: 2, knee_l: 2, knee_r: 2,
};
const nums = process.argv.map(Number).filter((n) => Number.isFinite(n) && n > 0);
const SC = nums[0] ?? BEST_PHASE.scale;
const LP = nums[1] ?? 1;

const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'walk', duration: 6 });
sim.begin(phaseGenomeFor(sk.joints.length, { ...BEST_PHASE, scale: SC, legPhase: LP }));

const names = Object.keys(AXIS);
const n = {}, sa = {}, ss = {}, cc = [], sas = {}, sac = {}, saa = {};
for (const j of names) { n[j] = 0; sa[j] = 0; sas[j] = 0; sac[j] = 0; saa[j] = 0; }
let Sss = 0, Scc = 0, Ssc = 0, Ss = 0, Sc = 0;
let g = 0;
const xArr = (sim as unknown as { x: Float32Array }).x;
while (g < 6 * DEFAULT_SIM.physicsHz && !sim.finished) {
  g += sim.advance(2);
  const ph = sim.clock.phase * Math.PI * 2;
  const s = Math.sin(ph), c = Math.cos(ph);
  Sss += s * s; Scc += c * c; Ssc += s * c; Ss += s; Sc += c;
  for (const j of names) {
    const a = xArr[20 + 3 * JOINT_ORDER.indexOf(j) + AXIS[j]];
    n[j]++; sa[j] += a; sas[j] += a * s; sac[j] += a * c; saa[j] += a * a;
  }
}
void cc;
// 3x3 正规方程（法方程用高斯消元解，n 很小，直接解）
const M = [[Sss, Ssc, Ss], [Ssc, Scc, Sc], [Ss, Sc, Sss > 0 ? n[names[0]] : 1]];
function solve3(A: number[][], B: number[]): number[] {
  const a = A.map((r, i) => [...r, B[i]]);
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let r = i + 1; r < 3; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r;
    [a[i], a[p]] = [a[p], a[i]];
    if (Math.abs(a[i][i]) < 1e-12) return [0, 0, 0];
    for (let r = 0; r < 3; r++) {
      if (r === i) continue;
      const f = a[r][i] / a[i][i];
      for (let c2 = i; c2 < 4; c2++) a[r][c2] -= f * a[i][c2];
    }
  }
  return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
}

console.log(`\n=== 时钟基最小二乘拟合（scale=${SC} legPhase=${LP}，${(g / DEFAULT_SIM.physicsHz).toFixed(2)} s，${n[names[0]]} 个控制周期）===\n`);
console.log('  关节        aSin      aCos      bias     幅度    残差RMS');
const rows: string[] = [];
for (const j of names) {
  const [b1, b2, b0] = solve3(M, [sas[j], sac[j], sa[j]]);
  let res = 0;
  for (let k = 0; k < 1; k++) void k;
  // 残差用 Σa² − 拟合解释量（正交基下成立）
  res = Math.max(0, saa[j] - b1 * sas[j] - b2 * sac[j] - b0 * sa[j]);
  const rms = Math.sqrt(res / Math.max(1, n[j]));
  console.log(`  ${j.padEnd(10)} ${b1.toFixed(4).padStart(8)} ${b2.toFixed(4).padStart(8)} ${b0.toFixed(4).padStart(8)}`
    + `  ${Math.hypot(b1, b2).toFixed(4).padStart(6)}  ${rms.toFixed(4).padStart(8)}`);
  rows.push(`  { joint: '${j}', axis: ${AXIS[j]}, aSin: ${b1.toFixed(4)}, aCos: ${b2.toFixed(4)}, bias: ${b0.toFixed(4)}, ... },`);
}
console.log('\n  可直接粘进 jointProgram.ts：\n' + rows.join('\n'));
console.log(`\n  实际位移 ${sim.distance.toFixed(2)} m，倒地=${sim.fallen}，分项 program=${(sim.terms.program ?? 0).toFixed(2)} altQ=${(sim.terms.altQ ?? 0).toFixed(2)}`);
