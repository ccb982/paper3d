/**
 * probe-diff —— 逐拍对比 survey 与 guardrail 两条路径，找出 Δθ 差异的根因
 *
 * survey.measure():
 *   clearAll(); runSteps(SETTLE);  a0=read();  clearAll();
 *   tauBuf[j*3+a]=tau; setV4Torques(tauBuf);
 *   runSteps(2);                 applied=read();
 *   runSteps(PULSE-2);           a1=read();
 * guardrail.trial():
 *   clearAll(); run(SETTLE);      a0=read();
 *   tauBuf[j*3+a]=tau; setV4Torques(tauBuf);  // ★ 注意：这里**没有**再 clearAll()
 *   for s in PULSE: advance(1); read();
 *
 * 差异候选：
 *   D1 guardrail 在 setV4Torques(tau) 之前**没有** clearAll() ⇒ tauBuf 里可能残留别的？
 *   D2 survey 的 clearAll() 在 a0 读出后紧接着执行 ⇒ 多跑了一拍？
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

function clearAll() { tauBuf.fill(0); d.setV4Torques(tauBuf); }
function run(n: number) { for (let i = 0; i < n; i++) sim.advance(1); }
function ang() { d.jointRot(jIdx, rr); return rr[AXIS]!; }

const tauInj = Math.min(j.maxTorque[AXIS] * 0.5, 60);
const idx = jIdx * 3 + AXIS;

console.log(`════ 路径对比：${JNAME}/${AXIS}  τinj=${tauInj} ════\n`);

// ── 路径 S（survey 逐字复制）
clearAll(); run(SETTLE);
let a0s = ang();
clearAll();
tauBuf[idx] = tauInj; d.setV4Torques(tauBuf);
run(2);
const appS = d.tauApplied?.[idx] ?? NaN;
run(PULSE - 2);
const a1s = ang();
console.log(`[S] survey 路径 : a0=${(a0s*180/Math.PI).toFixed(2)}° a1=${(a1s*180/Math.PI).toFixed(2)}° Δθ=${((a1s-a0s)*180/Math.PI).toFixed(2)}° applied=${appS}`);
clearAll(); run(SETTLE);

// ── 路径 G（guardrail 逐字复制）
let a0g = ang();
tauBuf[idx] = tauInj; d.setV4Torques(tauBuf);
let trace: string[] = [];
for (let s = 0; s < PULSE; s++) { sim.advance(1); if (s===0||s===1||s===2||s===15||s===30||s===59) trace.push(`${s}:${((ang()-a0g)*180/Math.PI).toFixed(2)}°`); }
const a1g = ang();
console.log(`[G] guardrail : a0=${(a0g*180/Math.PI).toFixed(2)}° a1=${(a1g*180/Math.PI).toFixed(2)}° Δθ=${((a1g-a0g)*180/Math.PI).toFixed(2)}°  逐拍 ${trace.join(' ')}`);
clearAll(); run(SETTLE);

// ── 路径 G2：和 G 相同，但**先 clearAll 再 run(SETTLE) 再读 a0**（与 S 同序）
clearAll(); run(SETTLE);
let a0g2 = ang();
tauBuf[idx] = tauInj; d.setV4Torques(tauBuf);
run(PULSE);
const a1g2 = ang();
console.log(`[G2] 同G但先清零: a0=${(a0g2*180/Math.PI).toFixed(2)}° a1=${(a1g2*180/Math.PI).toFixed(2)}° Δθ=${((a1g2-a0g2)*180/Math.PI).toFixed(2)}°`);
clearAll(); run(SETTLE);

// ── 路径 S2：和 S 相同，但**去掉中间那次 clearAll()**
clearAll(); run(SETTLE);
let a0s2 = ang();
tauBuf[idx] = tauInj; d.setV4Torques(tauBuf);
run(2);
run(PULSE - 2);
const a1s2 = ang();
console.log(`[S2] 去掉中间clear: a0=${(a0s2*180/Math.PI).toFixed(2)}° a1=${(a1s2*180/Math.PI).toFixed(2)}° Δθ=${((a1s2-a0s2)*180/Math.PI).toFixed(2)}°`);
