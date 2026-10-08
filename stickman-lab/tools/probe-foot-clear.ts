/**
 * probe-foot-clear —— ★ 把关节**手动挪到限位中央**再测权限（剥离"贴着限位"的假象）
 *
 * 已知：foot_l/2 静置角 17.59°、上限位 18° ⇒ 只剩 0.38° 行程 ⇒
 *       survey 报 Δθ=0.41° 是"顶到限位"，**不是没权限**。
 *
 * 本探针：注入 τ 前，先把该关节直接 write 到限位中点（用 Rapier 的
 * setRotation / 或给两刚体相对旋转），再测 250ms 的位移。
 *   → 若 Δθ 显著变大 ⇒ 权限正常，之前是行程耗尽的假象。
 *
 * 用法：node tools/run.mjs probe-foot-clear foot_l 2
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
const JNAME = ARGS[0] ?? 'foot_l';
const AXIS = Number(ARGS[1] ?? 2);

const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
env.V4MODE = '1';

const sk = buildSkeleton(DEFAULT_CONFIG) as any;
const jIdx = sk.joints.findIndex((j: any) => j.name === JNAME);
const j = sk.joints[jIdx];

const HZ = 240, DT = 1 / HZ;
const SETTLE = 60, PULSE = 60;
const nj = sk.joints.length;
const tauBuf = new Float64Array(nj * 3);
const rr = new Float64Array(3);
const idx = jIdx * 3 + AXIS;
const tauInj = Math.min(j.maxTorque[AXIS] * 0.5, 60);

function makeSim() {
  const s: any = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: 600 });
  s.begin(new Float32Array(s.paramCount));
  s.world.gravity = { x: 0, y: 0, z: 0 };
  return s;
}

console.log(`════ 剥离限位假象：${JNAME}/${AXIS}  τinj=${tauInj} ════`);
console.log(`限位=[${(j.minRad[AXIS]*180/Math.PI).toFixed(1)}°, ${(j.maxRad[AXIS]*180/Math.PI).toFixed(1)}°]  中点=${(((j.minRad[AXIS]+j.maxRad[AXIS])/2)*180/Math.PI).toFixed(1)}°`);
console.log('');

function run(label: string, prePos: 'asis' | 'center', sign: number): void {
  const sim = makeSim();
  const d: any = sim.doll;
  const tau = tauBuf; tau.fill(0);
  d.setV4Torques(tau);
  for (let i = 0; i < SETTLE; i++) sim.advance(1);

  if (prePos === 'center') {
    // ★ 直接把子刚体旋转到位：绕该轴把相对角设到限位中点。
    //   简化做法：用 Rapier 的 setRotation，基于父体姿态叠加一个绕本地轴的旋转。
    const ci = d.jointBodies[jIdx * 2 + 1];
    const body = d.bodies[ci];
    const before = (() => { d.jointRot(jIdx, rr); return rr[AXIS]; })();
    const targetDelta = ((j.minRad[AXIS] + j.maxRad[AXIS]) / 2) - before;
    // 取该轴世界方向
    const ax = new Float64Array(3);
    d.jointWorldAxis(jIdx, AXIS, ax);
    // 绕该世界轴旋转 targetDelta
    const s2 = Math.sin(targetDelta / 2), c2 = Math.cos(targetDelta / 2);
    const dq = { x: ax[0] * s2, y: ax[1] * s2, z: ax[2] * s2, w: c2 };
    const q = body.rotation();
    // q' = dq * q
    const nq = {
      w: dq.w * q.w - dq.x * q.x - dq.y * q.y - dq.z * q.z,
      x: dq.w * q.x + dq.x * q.w + dq.y * q.z - dq.z * q.y,
      y: dq.w * q.y - dq.x * q.z + dq.y * q.w + dq.z * q.x,
      z: dq.w * q.z + dq.x * q.y - dq.y * q.x + dq.z * q.w,
    };
    body.setRotation(nq, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    const after = (() => { d.jointRot(jIdx, rr); return rr[AXIS]; })();
    console.log(`  [${label}] 挪位：${(before*180/Math.PI).toFixed(2)}° → ${(after*180/Math.PI).toFixed(2)}°`);
  }

  d.jointRot(jIdx, rr);
  const a0 = rr[AXIS]!;
  tau[idx] = tauInj * sign;
  d.setV4Torques(tau);
  for (let i = 0; i < PULSE; i++) sim.advance(1);
  d.jointRot(jIdx, rr);
  const a1 = rr[AXIS]!;
  const dist = Math.min(a1 - j.minRad[AXIS], j.maxRad[AXIS] - a1) * 180 / Math.PI;
  console.log(
    `  [${label}] Δθ=${((a1 - a0) * 180 / Math.PI).toFixed(2).padStart(8)}°  applied=${(d.tauApplied?.[idx] ?? NaN).toFixed(1).padStart(6)}  末距限位=${dist.toFixed(2)}°`,
  );
}

run('原样 +τ', 'asis', +1);
run('居中 +τ', 'center', +1);
run('原样 −τ', 'asis', -1);
run('居中 −τ', 'center', -1);
