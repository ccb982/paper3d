/**
 * probe-fall-timeline —— 时间线：从 t=0 起，CoM.y / 躯干高度 / 各部位接触力
 *   用法：node tools/run.mjs probe-fall-timeline [秒数]
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
for (const i of WebAssembly.Module.imports(c)) { const f = (bg as any)[i.name]; if (typeof f === 'function') (im[i.module] ??= {})[i.name] = f; }
bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { shapeForJoints } = await import('../src/core/brain');
const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const T = Number(ARGS[0] ?? 3);
const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: T + 0.3 });
sim.begin(new Float32Array(sim.paramCount));
const d = sim.doll as any;
const ctrl = new Controller(sk, sim, DEFAULT_CONTROLLER);
const DT = 1 / 120;
const log = (s: string) => console.log(s);
// 找关键刚体
const keyIdx = new Map<string, number>();
for (let i = 0; i < sk.bodies.length; i++) keyIdx.set((sk.bodies[i] as any).key, i);
const W = (sk.massTotal * 9.81).toFixed(0);
log(`══ probe-fall-timeline  体重=${W}N  ══`);
log('  t   | CoM.y  vx    | 躯干y 躯干pitch | 脚L fz  脚R fz | 躯干 fz | 手臂 fz');
const loadOf = (bi: number): number => {
  const rb = d.bodies[bi]; let sum = 0;
  const def = sk.bodies[bi] as any;
  for (let ci = 0; ci < (def?.colliders ?? []).length; ci++) {
    const rcol = rb.collider?.(ci); if (!rcol) continue;
    d.world.contactPairsWith(rcol, (other: any) => { d.world.contactPair(rcol, other, (mf: any) => { const nc = mf.numContacts(); for (let i = 0; i < nc; i++) sum += Math.abs(mf.contactImpulse(i)); }); });
  }
  return sum * 120;
};
const pitchOf = (bi: number): number => { const rq = d.bodies[bi].rotation(); return Math.atan2(2 * (rq.w * rq.x + rq.y * rq.z), 1 - 2 * (rq.x * rq.x + rq.y * rq.y)) * 57.2958; };
for (let k = 0; k <= Math.round(T * 120); k++) {
  ctrl.step(DT); sim.advance(2);
  const t = (k + 1) * DT;
  if (k % 12 !== 0) continue;
  const com = ctrl.rs.com as any;
  const ti = keyIdx.get('torso') ?? keyIdx.get('spine3') ?? 3;
  const ty = d.bodies[ti].translation().y;
  const tp = pitchOf(ti);
  const fl = loadOf(keyIdx.get('foot_l')!);
  const fr = loadOf(keyIdx.get('foot_r')!);
  const ft = loadOf(ti);
  const arm = loadOf(keyIdx.get('arm_l')!);
  log(` ${t.toFixed(2)} |${(com?.y ?? 0).toFixed(3)}${((com?.vx ?? 0) * 1000).toFixed(0).padStart(6)} |${ty.toFixed(3)}${tp.toFixed(1).padStart(9)} |${fl.toFixed(0).padStart(7)}${fr.toFixed(0).padStart(7)} |${ft.toFixed(0).padStart(7)} |${arm.toFixed(0).padStart(7)}`);
}

// ── MoS / DCM / 支撑域（项目自带判据）──
log('');
log('── MoS / DCM / 支撑域（项目自带口径）──');
log('  t   | CoM.x  CoM.y | sup.cx halfX |  DCM.x  |  MoS   | 支撑域 [x0,x1]');
for (let k = 0; k <= 240; k++) {
  ctrl.step(DT); sim.advance(2);
  const t = (k + 1) * DT;
  if (k % 6 !== 0 || t > 1.7) continue;
  const c2 = ctrl.rs.com as any;
  const su = ctrl.rs.support as any;
  const dc = ctrl.rs.dcm as any;
  const x0 = ((su?.cx ?? 0) - (su?.halfX ?? 0)) * 1000;
  const x1 = ((su?.cx ?? 0) + (su?.halfX ?? 0)) * 1000;
  log(` ${t.toFixed(2)} |${((c2?.x ?? 0) * 1000).toFixed(0).padStart(6)}${((c2?.y ?? 0) * 1000).toFixed(0).padStart(7)} |${((su?.cx ?? 0) * 1000).toFixed(0).padStart(8)}${((su?.halfX ?? 0) * 1000).toFixed(0).padStart(6)} |${((dc?.x ?? 0) * 1000).toFixed(0).padStart(8)} |${(ctrl.rs.mos * 1000).toFixed(0).padStart(7)} |[${x0.toFixed(0)},${x1.toFixed(0)}]`);
}
