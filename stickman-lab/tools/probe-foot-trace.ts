/**
 * probe-foot-trace —— 深挖 foot_l/2 vs foot_r/2 的左右不对称 + 逐拍追踪
 *
 * 已知（probe-joint-survey，每轴独立世界）：
 *   foot_l/2 : +0.4° / −29.6°   applied=60
 *   foot_r/2 : +24.9° / −5.1°   applied=60
 * 同一只脚两个方向差 70 倍 ⇒ 不是"权限"，像是被**非对称外部约束**卡住。
 *
 * 逐拍打印：角、相对角速度、applied、限位距离、脚底高度、接触数。
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
const SIGN = Number(ARGS[2] ?? 1);

const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
env.V4MODE = '1';

const sk = buildSkeleton(DEFAULT_CONFIG) as any;
const jIdx = sk.joints.findIndex((j: any) => j.name === JNAME);
const j = sk.joints[jIdx];

const sim: any = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: 600 });
sim.begin(new Float32Array(sim.paramCount));
const d: any = sim.doll;
sim.world.gravity = { x: 0, y: 0, z: 0 };

const HZ = 240, DT = 1 / HZ;
const SETTLE = 60, PULSE = 60;
const nj = sk.joints.length;
const tauBuf = new Float64Array(nj * 3);
const rr = new Float64Array(3);
const rv = new Float64Array(3);
const idx = jIdx * 3 + AXIS;

const tauInj = Math.min(j.maxTorque[AXIS] * 0.5, 60) * SIGN;

function clearAll() { tauBuf.fill(0); d.setV4Torques(tauBuf); }
function run(n: number) { for (let i = 0; i < n; i++) sim.advance(1); }
function ang() { d.jointRot(jIdx, rr); return rr[AXIS]!; }
function rel() { d.jointRelVel(jIdx, rv); return rv[AXIS]!; }

console.log(`════ foot 追踪：${JNAME}/${AXIS}  τinj=${tauInj}  revoluteAxis=${JSON.stringify(j.revoluteAxis)} ════`);
console.log(`限位=[${(j.minRad[AXIS]*180/Math.PI).toFixed(1)}°, ${(j.maxRad[AXIS]*180/Math.PI).toFixed(1)}°]  τmax=${j.maxTorque[AXIS]}`);

clearAll(); run(SETTLE);
const a0 = ang();
console.log(`静置后：角=${(a0*180/Math.PI).toFixed(2)}°  相对角速度=${rel().toFixed(4)}`);
// 脚底高度 / 接触
try {
  console.log(`脚底高度: soleY(l)=${d.soleY?.('l')?.toFixed?.(4)}  soleY(r)=${d.soleY?.('r')?.toFixed?.(4)}`);
} catch { /* ignore */ }
console.log('');

tauBuf[idx] = tauInj; d.setV4Torques(tauBuf);
console.log('拍 | 角(°) | 相对ω | applied | 距限位(°) | 接触数');
for (let s = 0; s < PULSE; s++) {
  sim.advance(1);
  if (s < 8 || s % 10 === 0 || s === PULSE - 1) {
    const a = ang();
    const dist = Math.min(a - j.minRad[AXIS], j.maxRad[AXIS] - a) * 180 / Math.PI;
    // 该子刚体的接触数
    let nc = -1;
    try {
      const ci = d.jointBodies[jIdx * 2 + 1];
      const body = d.bodies[ci];
      nc = body ? sim.world.contactPairsWith?.(body, () => {}) ?? -1 : -1;
    } catch { /* ignore */ }
    console.log(
      `${String(s).padStart(2)} | ${((a - a0) * 180 / Math.PI).toFixed(3).padStart(7)} | ${rel().toFixed(4).padStart(7)} | ` +
      `${(d.tauApplied?.[idx] ?? 0).toFixed(1).padStart(7)} | ${dist.toFixed(2).padStart(9)} | ${nc}`,
    );
  }
}
console.log('');
console.log(`⇒ Δθ=${((ang() - a0) * 180 / Math.PI).toFixed(3)}°`);
