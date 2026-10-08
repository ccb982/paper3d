/**
 * probe-static —— **关节静态重力载荷测量**（给被动刚度定标的工程依据）
 *
 *   站立姿态下逐关节回读解析重力矩（ragdoll.computeGravityTau），
 *   打印矢状轴（k=2）的 |τ_grav|。
 *   设计取值：K_j ≥ SAFETY × |τ_grav,j| / θ_allow（θ_allow=0.1 rad ⇒ 站姿偏差 <6°）
 *   用法：`node tools/run.mjs probe-static [SAFETY=2.5] [θallow=0.1]`
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
const SAFETY = Number(ARGS[0] ?? 2.5);
const THETA = Number(ARGS[1] ?? 0.1);

const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: 0.4 });
sim.begin(new Float32Array(sim.paramCount));
const d = sim.doll as unknown as {
  computeGravityTau: () => Float64Array | number[];
  sk: { joints: Array<{ name: string; maxTorque: number[] }> };
};
const g = 9.81;
const jbuf = new Float64Array(3);
const joints = sk.joints as Array<{ name: string; parentKey: string; childKey: string; maxTorque: number[]; }>;
const subtree = (root: string): string[] => {
  const out = [root];
  let ch = true;
  while (ch) {
    ch = false;
    for (const j of joints) {
      if (out.includes(j.parentKey) && !out.includes(j.childKey)) { out.push(j.childKey); ch = true; }
    }
  }
  return out;
};
const d3 = d as unknown as { bodyByKey: (k: string) => { mass: () => number; translation: () => { x: number; y: number; z: number } } };
console.log('══ probe-static（手工：子树质量×力臂）══');
console.log('关节        τ_grav N·m   →建议K(=2.5|τ|/0.1)   当前τmax   质量链');
for (let i = 0; i < joints.length; i++) {
  const j = joints[i]!;
  if (!/^(hip|knee|foot|spine)/.test(j.name)) continue;
  (d as unknown as { jointWorld: (i: number, o: Float64Array) => void }).jointWorld(i, jbuf);
  const subs = subtree(j.childKey);
  let t = 0, msum = 0;
  for (const kk of subs) {
    let b: { mass: () => number; translation: () => { x: number; y: number; z: number } } | null = null;
    try { b = d3.bodyByKey(kk); } catch { b = null; }
    if (!b) continue;
    const m = b.mass(), p = b.translation();
    t += m * g * (p.x - jbuf[0]!);
    msum += m;
  }
  console.log(`${j.name.padEnd(10)} ${t.toFixed(1).padStart(10)}   ${(Math.abs(t) * 25).toFixed(0).padStart(14)}   ${String(j.maxTorque[2]).padStart(8)}   ${msum.toFixed(1)}kg`);
}
