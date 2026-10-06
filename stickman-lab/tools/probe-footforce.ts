/**
 * probe-footforce.ts —— 逐帧逐部位受力回读 + 求解器参数扫描
 *
 * 归因结论（先跑一次的读数）：
 *   foot_l/外侧柱  λ均值 2.853  帧间最大差 29.308  ← 342N 压在一条 30mm 窄条上，摆幅是均值 10 倍
 *   foot_l/跖骨头  λ均值 0.372 / 足跟 0.176 / 趾 0.017
 *   arch_l/#4 #5   始终无接触（弓是刚性桁架，不落地 —— 符合设计）
 *
 * 机理假设：刚体压在**窄条**上本质是绕棱 rocking，接触在窄条两条棱之间交替
 *          ⇒ 周期-2（60Hz @120Hz）。本探针用 λ 摆幅去验收"压住了没有"。
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG } = await import('../src/core/skeleton');
await import('../src/core/ragdoll');
{
  const p: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const c = await WebAssembly.compile(fs.readFileSync(p));
  const bg = bgNs as any; const im: any = {};
  for (const i of WebAssembly.Module.imports(c)) {
    const f = bg[i.name]; if (typeof f !== 'function') throw new Error(i.name);
    (im[i.module] ??= {})[i.name] = f;
  }
  bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
}
const RAPIER = await import('@dimforge/rapier3d');
const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const log = console.log;

interface R {
  lamMean: number; lamSwing: number; rel: number;
  vyMax: number; p2: number; load: number; nc: number;
}

function sweep(iters: number, physHz: number): R {
  const sk = buildSkeleton(DEFAULT_CONFIG);
  const SHAPE = shapeForJoints(sk.joints.length);
  const sim = new Sim(sk, SHAPE, {
    ...DEFAULT_SIM, mode: 'stand',
    solverIterations: iters, physicsHz: physHz, controlHz: physHz / 2,
  });
  sim.begin(new Float32Array(sim.paramCount));
  const ctrl = new Controller(sk, sim, { ...DEFAULT_CONTROLLER });
  const d = sim.doll;
  const world = (d as any).world as InstanceType<typeof RAPIER.World>;
  const cols = (d as any).soleCols[0] as any[];
  const bIdx = (d as any).soleColBody[0] as number[];
  // 标签真源是 collider 定义里的 `_label`（`ColliderDef` 没有公开的 label 字段）
  let L = cols.findIndex((c, i) =>
    ((sk.bodies[bIdx[i] ?? bIdx[0]!]!.colliders[i] as any)?._label ?? '').includes('外侧柱'));
  if (L < 0) L = 1;
  const col = cols[L]!;
  const iF = sk.bodies.findIndex((b) => b.key === 'foot_l');
  const lams: number[] = [], vys: number[] = [], ncs: number[] = [];
  const NF = Math.round(physHz * 0.8), skip = Math.round(physHz * 0.35);
  for (let f = 0; f < NF; f++) {
    (sim as unknown as { motor: { set(v: Float32Array): void } }).motor.set(ctrl.step(2 / physHz));
    sim.advance(1);
    if (f < skip) continue;
    let lam = 0, nc = 0;
    world.contactPairsWith(col, (other: any) => {
      world.contactPair(col, other, (mf: any) => {
        if (mf.numContacts() === 0) return;
        for (let k = 0; k < mf.numContacts(); k++) { nc++; lam += Math.abs(mf.contactImpulse(k)); }
      });
    });
    lams.push(lam); ncs.push(nc); vys.push(d.bodies[iF]!.linvel().y);
  }
  const lamMean = lams.reduce((a, b) => a + b, 0) / Math.max(1, lams.length);
  let lamSwing = 0;
  for (let k = 1; k < lams.length; k++) lamSwing = Math.max(lamSwing, Math.abs(lams[k]! - lams[k - 1]!));
  let p2 = 0, n2 = 0;
  for (let k = 2; k < vys.length; k++) {
    n2++;
    if (Math.abs(vys[k]! - vys[k - 2]!) < 0.5 * Math.max(1e-6, Math.abs(vys[k]!))) p2++;
  }
  const total = lams.reduce((a, b) => a + b, 0);
  return {
    lamMean, lamSwing, rel: lamSwing / Math.max(1e-9, lamMean),
    vyMax: Math.max(...vys.map(Math.abs)), p2: n2 ? p2 / n2 : 0,
    load: (total / lams.length) * physHz, nc: ncs.reduce((a, b) => a + b, 0) / Math.max(1, ncs.length),
  };
}

log('══ 求解器参数扫描：判据 = 外侧柱 λ 的帧间摆幅 / 均值（<1.2 视为压住）══');
log('');
log('   iters  physicsHz    λ均值    λ帧间差   相对摆幅   承载(N)  接触点  vy峰值    周期2');
for (const [si, ph] of [
  [16, 120], [32, 120], [64, 120], [16, 240], [32, 240], [64, 240],
] as const) {
  const r = sweep(si, ph);
  log(`   ${String(si).padStart(5)}  ${String(ph).padStart(7)}Hz`
    + `  ${r.lamMean.toFixed(3).padStart(7)}  ${r.lamSwing.toFixed(2).padStart(8)}`
    + `  ${r.rel.toFixed(1).padStart(7)}×`
    + `  ${r.load.toFixed(0).padStart(7)}  ${r.nc.toFixed(1).padStart(5)}`
    + `  ${(r.vyMax * 1000).toFixed(0).padStart(5)}mm/s`
    + `  ${(r.p2 * 100).toFixed(0).padStart(4)}%`
    + `   ${r.rel < 1.2 ? '✓ 压住了' : '✗'}`);
}
