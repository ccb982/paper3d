/**
 * probe-guardrail —— ★ 证明"护栏自举死锁"：静止时 relL≈0 ⇒ impStable≈0 ⇒ τ 全被剪
 *
 * 假设（ragdoll.ts:3469）：
 *     impStable = impDamp + |ff|·dt + impSpring
 *   V4 模式下 kPSpring=0、ff=torqueCmd=0 ⇒ impStable = alpha·|relL[k]|·Ieff
 *   静止 ⇒ relL[k]≈0 ⇒ impStable≈0 ⇒ 注入的 τ 被剪到 ~0（motorAuthority→0）
 *
 * 若假设成立：注入 τ 的同时**人为给一个初始相对角速度**（拨一下），护栏就该放行。
 *
 * 用法：node tools/run.mjs probe-guardrail hip_l 2
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
const JNAME = ARGS[0] ?? 'hip_l';
const AXIS = Number(ARGS[1] ?? 2);
const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
env.V4MODE = '1';

const sk = buildSkeleton(DEFAULT_CONFIG) as any;
const jIdx = sk.joints.findIndex((j: any) => j.name === JNAME);
const j = sk.joints[jIdx];

const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: 60 });
sim.begin(new Float32Array(sim.paramCount));
const d = sim.doll as any;
(sim as any).world.gravity = { x: 0, y: 0, z: 0 };

const HZ = 240, DT = 1 / HZ;
const SETTLE = 60, PULSE = 60;
const nj = sk.joints.length;
const tauBuf = new Float64Array(nj * 3);
const rr = new Float64Array(3);
const rv = new Float64Array(3);

function clearAll() { tauBuf.fill(0); d.setV4Torques(tauBuf); }
function run(n: number) { for (let i = 0; i < n; i++) sim.advance(1); }
function ang() { d.jointRot(jIdx, rr); return rr[AXIS]!; }

const tauInj = Math.min(j.maxTorque[AXIS] * 0.5, 60);

console.log(`════ 护栏自举诊断：${JNAME}/${AXIS}  τmax=${j.maxTorque[AXIS]} τinj=${tauInj} ════`);
console.log('拍 |  relL(kick) | authority | tauApplied | applied/τinj | Δθ累计(°)');
console.log('');

// —— 实验：清空 → 静止 → 注入 τ，同时**直接给子刚体一个初始角速度**（kick）
function trial(label: string, kick: number): void {
  clearAll(); run(SETTLE);
  const a0 = ang();
  tauBuf[jIdx * 3 + AXIS] = tauInj;
  d.setV4Torques(tauBuf);
  if (kick !== 0) {
    // 给该轴的"子刚体"一个绕父体本地轴的初始角速度
    const ci = d.jointBodies[jIdx * 2 + 1];
    const body = d.bodies[ci];
    // 取该轴的世界方向
    d.jointWorldAxis(jIdx, AXIS, rv);
    body.setAngvel({ x: rv[0] * kick, y: rv[1] * kick, z: rv[2] * kick }, true);
  }
  let authMax = 0, appSum = 0, n = 0;
  for (let s = 0; s < PULSE; s++) {
    sim.advance(1);
    const idx = jIdx * 3 + AXIS;
    d.jointRelVel(jIdx, rv);
    const auth = d.motorAuthority?.[idx] ?? NaN;
    if (Number.isFinite(auth)) authMax = Math.max(authMax, auth);
    appSum += Math.abs(d.tauApplied?.[idx] ?? 0); n++;
    if (s < 6 || s % 15 === 0) {
      console.log(
        `${String(s).padStart(2)} | ${rv[AXIS]!.toFixed(3).padStart(10)} | ${(Number.isFinite(auth) ? (auth * 100).toFixed(1) + '%' : 'n/a').padStart(9)} | ` +
        `${(d.tauApplied?.[idx] ?? 0).toFixed(2).padStart(8)} | ${(Math.abs(d.tauApplied?.[idx] ?? 0) / tauInj).toFixed(3).padStart(11)} | ${((ang() - a0) * 180 / Math.PI).toFixed(2).padStart(7)}`,
      );
    }
  }
  console.log(`  ⇒ ${label}：authority峰值=${(authMax * 100).toFixed(1)}%  平均|applied|=${(appSum / n).toFixed(2)}  Δθ=${((ang() - a0) * 180 / Math.PI).toFixed(2)}°\n`);
  clearAll(); run(SETTLE);
}

trial('零初速（模拟静止上电）', 0);
trial('拨一下 +2 rad/s', 2);
trial('拨一下 +10 rad/s', 10);
