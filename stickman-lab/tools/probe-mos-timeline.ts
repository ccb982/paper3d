/**
 * probe-mos-timeline —— 唯一目的：把「MoS 什么时候转负」量出来。
 *   用法：node tools/run.mjs probe-mos-timeline [秒数]
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
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: 1e9 });   // ★ 不设上限，靠循环停
sim.begin(new Float32Array(sim.paramCount));
const d = sim.doll as any;
const ctrl = new Controller(sk, sim, DEFAULT_CONTROLLER);
const DT = 1 / 120;
const log = (s: string) => console.log(s);
log(`══ probe-mos-timeline  体重=${sk.massTotal}kg=${(sk.massTotal * 9.81).toFixed(0)}N  ══`);
log('  t   | CoM.x  CoM.y | sup.cx ±halfX |  DCM.x  |  MoS  | 支撑域[x0,x1] | 脚fz(L+R) | 躯干pitch');
const keyIdx = new Map<string, number>();
for (let i = 0; i < sk.bodies.length; i++) keyIdx.set((sk.bodies[i] as any).key, i);
const ti = keyIdx.get('torso') ?? keyIdx.get('spine3') ?? 3;
const pitchOf = (bi: number): number => { const rq = d.bodies[bi].rotation(); return Math.atan2(2 * (rq.w * rq.x + rq.y * rq.z), 1 - 2 * (rq.x * rq.x + rq.y * rq.y)) * 57.2958; };
let mosNegAt = -1;
const N = Math.round(T * 120);
for (let k = 0; k <= N; k++) {
  ctrl.step(DT); sim.advance(2);
  const t = (k + 1) * DT;
  const mos = ctrl.rs.mos as number;
  if (mosNegAt < 0 && mos < 0) mosNegAt = t;
  if (k % 6 !== 0) continue;
  const c2 = ctrl.rs.com as any, su = ctrl.rs.support as any, dc = ctrl.rs.dcm as any;
  const Fl = d.soleForceProfile(0, DT), Fr = d.soleForceProfile(1, DT);
  const x0 = ((su?.cx ?? 0) - (su?.halfX ?? 0)) * 1000, x1 = ((su?.cx ?? 0) + (su?.halfX ?? 0)) * 1000;
  log(` ${t.toFixed(2)} |${((c2?.x ?? 0) * 1000).toFixed(0).padStart(6)}${((c2?.y ?? 0) * 1000).toFixed(0).padStart(7)} |${((su?.cx ?? 0) * 1000).toFixed(0).padStart(8)}${((su?.halfX ?? 0) * 1000).toFixed(0).padStart(6)} |${((dc?.x ?? 0) * 1000).toFixed(0).padStart(8)} |${(mos * 1000).toFixed(0).padStart(6)} |[${x0.toFixed(0).padStart(5)},${x1.toFixed(0).padStart(5)}] |${(Fl.fz + Fr.fz).toFixed(0).padStart(9)} |${pitchOf(ti).toFixed(1).padStart(6)}`);
}
log(`\n★ MoS 首次转负于 t = ${mosNegAt < 0 ? '（始终未负）' : mosNegAt.toFixed(3) + ' s'}`);
