/**
 * probe-motortarget.ts —— 角度通道（位置伺服）到底有没有被喂
 *
 * 起因：`Controller.step` 里 `const out = rs.arbitrate(dt)` 的 `out`
 *   **从未被使用** —— 只把 `rs.tauOut` 送进了 `setTorqueTargets`。
 *   而 `setMotorTargets`（写 `motorTarget`，位置环的唯一输入）**一次都没被调用**。
 *   ⇒ 若属实，全部位置 PD（`sagSupport` 的髋/膝、步态关键帧）都是死的，
 *     只有力矩通道在出力。这与"两种模式 com.y 都塌"完全吻合。
 *
 * 判据：给 `setMotorTargets` 打桩计数 + 读 `motorTarget` 的内容。
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
const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const log = console.log;

const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: 3 });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, DEFAULT_CONTROLLER);
const doll: any = sim.doll;

// 打桩
let nMotor = 0, nTorque = 0;
const origMotor = doll.setMotorTargets.bind(doll);
const origTorque = doll.setTorqueTargets.bind(doll);
doll.setMotorTargets = (t: Float32Array) => { nMotor++; origMotor(t); };
doll.setTorqueTargets = (t: Float32Array) => { nTorque++; origTorque(t); };

const N = Math.round(2 * (DEFAULT_SIM.physicsHz ?? 240));
for (let f = 0; f < N; f++) { ctrl.step(1 / (DEFAULT_SIM.controlHz ?? 120)); sim.advance(1); }

const rs: any = ctrl.rs;
log('══ 角度通道是否被喂 ══');
log(`   setMotorTargets 调用 ${nMotor} 次 / setTorqueTargets ${nTorque} 次  (共 ${N} 拍)`);
log(`   ${nMotor === 0 ? '\u2717 角度通道从未被调用 ⇒ 位置伺服 + 步态关键帧全部是死的' : '\u2713 角度通道有被调用'}`);
const mt: any = doll.motorTarget;
let nz = 0, mx = 0;
for (let i = 0; i < mt.length; i++) { if (Math.abs(mt[i]) > 1e-6) nz++; mx = Math.max(mx, Math.abs(mt[i])); }
log(`   motorTarget: 非零 ${nz}/${mt.length} 项，最大 |值| = ${mx.toFixed(4)}`);
log(`   torqueCmd  : 非零 ${(() => { let c = 0; const t: any = doll.torqueCmd; for (let i = 0; i < t.length; i++) if (Math.abs(t[i]) > 1e-6) c++; return c; })()}/${doll.torqueCmd.length} 项`);
log(`   com.y = ${rs.com.y.toFixed(4)}  （初始约 0.9623）`);
log('');
log('   仲裁器确实算出了角度目标吗？ out 的内容:');
const out = rs.arbitrate(1 / (DEFAULT_SIM.controlHz ?? 120));
let onz = 0, onmx = 0;
for (let i = 0; i < out.length; i++) { if (Math.abs(out[i]) > 1e-6) onz++; onmx = Math.max(onmx, Math.abs(out[i])); }
log(`     out: 非零 ${onz}/${out.length} 项，最大 |值| = ${onmx.toFixed(4)}`
  + `  ${onz > 0 ? '（有内容，却没人送去 setMotorTargets）' : ''}`);
