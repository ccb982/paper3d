/**
 * probe-full —— **全状态+能量审计**（最后的诊断手段）
 *
 *   逐拍打印：总能量（KE+PE）/ CoM(x,y) / 四个关键关节角 / CoP_L / Fz总 / 踝τ
 *   判读：能量增长 ⇒ 存在泵源（反馈符号）；能量单调减 ⇒ 只是权限不足。
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG, jointIndexByName } = await import('../src/core/skeleton');
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
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { shapeForJoints } = await import('../src/core/brain');

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const T = Number(ARGS[0] ?? 3);

const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: T + 0.3 });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, DEFAULT_CONTROLLER);
const rs = (ctrl as unknown as { rs: Record<string, any> }).rs;
const d = sim.doll as unknown as {
  bodies: Array<{ mass: () => number; linvel: () => { x: number; y: number; z: number }; angvel: () => { x: number; y: number; z: number }; translation: () => { x: number; y: number; z: number }; principalInertia: () => { x: number; y: number; z: number } }>;
  jointRot: (i: number, o: Float64Array) => void;
  tauApplied: Float64Array;
  soleForceProfile: (side: 0 | 1, dt: number) => { fz: number; copX: number };
};
const DT = 1 / 120;
const G = 9.81;
const jBuf = new Float64Array(3);
const jA = jointIndexByName(sk, 'foot_l');
const jK = jointIndexByName(sk, 'knee_l');
const jH = jointIndexByName(sk, 'hip_l');
const jS = jointIndexByName(sk, 'spine1');

const energy = (): { ke: number; pe: number } => {
  let ke = 0, pe = 0;
  for (const b of d.bodies) {
    const m = b.mass();
    if (m <= 0) continue;
    const v = b.linvel(), w = b.angvel(), t = b.translation(), I = b.principalInertia();
    ke += 0.5 * m * (v.x * v.x + v.y * v.y + v.z * v.z);
    ke += 0.5 * (Math.max(I.x, I.y, I.z)) * (w.x * w.x + w.y * w.y + w.z * w.z);
    pe += m * G * t.y;
  }
  return { ke, pe };
};

const N = Math.round(T * 120);
await Promise.resolve();
console.log('══ probe-full（能量审计）══');
console.log('   t   |  KE     PE     E=KE+PE  | CoM.x  CoM.y | 踝L 膝L 髋L 脊1 | CoP_L  Fz_tot | τ踝  τ膝  τ髋');
for (let k = 0; k <= N; k++) {
  ctrl.step(DT);
  sim.advance(2);
  if (k % 12 !== 0) continue;
  const E = energy();
  const FL = d.soleForceProfile(0, DT), FR = d.soleForceProfile(1, DT);
  d.jointRot(jA, jBuf); const a = jBuf[2]! * 57.2958;
  d.jointRot(jK, jBuf); const kk = jBuf[2]! * 57.2958;
  d.jointRot(jH, jBuf); const h = jBuf[2]! * 57.2958;
  d.jointRot(jS, jBuf); const s1 = jBuf[2]! * 57.2958;
  const t = (k + 1) * DT;
  console.log(
    ` ${t.toFixed(2)} | ${E.ke.toFixed(0).padStart(6)} ${E.pe.toFixed(0).padStart(6)} ${(E.ke + E.pe).toFixed(1).padStart(8)} |` +
    `${((rs.com.x ?? 0) * 1000).toFixed(0).padStart(6)}${((rs.com.y ?? 0) * 1000).toFixed(0).padStart(6)} |` +
    `${a.toFixed(0).padStart(4)}${kk.toFixed(0).padStart(4)}${h.toFixed(0).padStart(4)}${s1.toFixed(0).padStart(4)} |` +
    `${(FL.copX * 1000).toFixed(0).padStart(6)}${(FL.fz + FR.fz).toFixed(0).padStart(6)} | ${(d.tauApplied[jA * 3 + 2] ?? 0).toFixed(1).padStart(7)}`,
  );
}
