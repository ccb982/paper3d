/**
 * probe-idle-drift —— ★ 关重力、零 τ、零控制器，静置过程中关节自己跑掉？
 *
 * 已发现（probe-foot-trace）：
 *   关重力 + V4MODE + 零 τ，静置 250ms 后
 *     foot_l/2 = +17.59°（上限位 18°！）
 *     foot_r/2 = −6.90°
 *   左右不对称，且左脚贴在限位上 ⇒ 有非重力、非 τ 的力矩源。
 *
 * 候选源：
 *   A. `primeVelocities()`（sim.advance 里调用）—— 有速度注入？
 *   B. `applySupportPoint` / `supportPointOn`
 *   C. `enforceLimits` 的限位冲量把轴推出去
 *   D. 弓/中足的 Rapier 力模式马达（arch/mfoot）在拉脚
 *   E. V4 阻尼项（相对非零 ⇒ 有阻尼力矩）
 *   F. 初始姿态本身就不在静止平衡（骨架 restRad 与物理 rest 不一致）
 *
 * 逐拍记录全部关节 → 表格，看哪些轴在漂。
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG } = await import('../src/core/skeleton');
await import('../src/core/ragdoll');
const bg = bgNs as any;
const p: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
const c = await WebAssembly.compile(fs.readFileSync(p));
const im: any = {};
for (const i of WebAssembly.Module.imports(c)) {
  const impl = (bg as any)[i.name];
  if (typeof impl === 'function') (im[i.module] ??= {})[i.name] = impl;
}
bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);

const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const FRAMES = Number(ARGS[0] ?? 120);

const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
env.V4MODE = '1';

const sk = buildSkeleton(DEFAULT_CONFIG) as any;
const sim: any = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: 600 });
sim.begin(new Float32Array(sim.paramCount));
const d: any = sim.doll;
sim.world.gravity = { x: 0, y: 0, z: 0 };
d.setV4Torques(new Float64Array(sk.joints.length * 3));

const nj = sk.joints.length;
const rr = new Float64Array(3);
const DEG = 180 / Math.PI;

console.log(`════ 静置漂移（关重力/零τ/零控制器）前 ${FRAMES} 拍 ════`);
console.log(`t=0 姿态 vs t=${(FRAMES/240).toFixed(2)}s 姿态，|Δ| > 0.5° 的轴列出`);
console.log('');

const a0: number[] = [];
for (let k = 0; k < nj * 3; k++) { d.jointRot(k / 3 | 0, rr); a0[k] = rr[k % 3]!; }

for (let f = 0; f < FRAMES; f++) sim.advance(1);

const drift: { name: string; ax: number; v0: number; v1: number; d: number }[] = [];
for (let ji = 0; ji < nj; ji++) {
  d.jointRot(ji, rr);
  for (let k = 0; k < 3; k++) {
    const v0 = a0[ji * 3 + k]!, v1 = rr[k]!;
    const dd = (v1 - v0) * DEG;
    if (Math.abs(dd) > 0.5) drift.push({ name: sk.joints[ji].name, ax: k, v0: v0 * DEG, v1: v1 * DEG, d: dd });
  }
}
drift.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
console.log(`漂移轴 ${drift.length} / ${nj * 3}：`);
console.log('joint/ax      |   初始(°)  →   末态(°)  |   Δθ(°)');
for (const r of drift) {
  console.log(`${(r.name + '/' + r.ax).padEnd(13)} | ${r.v0.toFixed(2).padStart(8)} → ${r.v1.toFixed(2).padStart(8)} | ${r.d.toFixed(2).padStart(7)}`);
}

console.log('');
console.log(`站立高度：torso.y = ${d.torso().translation().y.toFixed(4)} m`);
console.log(`脚底：soleY(l)=${d.soleY('l').toFixed(4)}  soleY(r)=${d.soleY('r').toFixed(4)}`);
console.log('末态角速度（幅值 top 8）：');
const wl: { name: string; ax: number; w: number }[] = [];
for (let ji = 0; ji < nj; ji++) {
  d.jointRelVel(ji, rr);
  for (let k = 0; k < 3; k++) wl.push({ name: sk.joints[ji].name, ax: k, w: rr[k]! });
}
wl.sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
for (let i = 0; i < 8; i++) console.log(`  ${(wl[i].name + '/' + wl[i].ax).padEnd(13)} ω=${wl[i].w.toFixed(4)} rad/s`);
