/**
 * ══════════════════════════════════════════════════════════════════
 * probe-ankcop.ts —— `ANKLE_COP` 单主 CoP 律的**闭环整定**
 * ══════════════════════════════════════════════════════════════════
 *
 * 律（归一化增量式，见 balance.ts 模块顶部长注释）：
 *     τ ← τ_prev + COPK·(CoP_obs − CoP_want)·Fz      （COPK ≤ 1；1 = 一拍收敛）
 *   `CoP_want = clamp(ξ, 足内)`，`ξ = rs.dcm.x`（捕获点）。
 *
 * 为什么不做开环标定（两台方法都试过、都失败，记下来）：
 *   ① 不让位：位置伺服与力矩通道在 `driveMotors` 里**相加**，伺服弹簧把注入 τ
 *      **整体吸收**（踝转 `τ/640` rad 即回零）⇒ 注入 ±20 N·m 的 ΔCoP ≈ 0.03 mm/N·m。
 *   ② 让位后开环：恒力矩把脚直接掀翻、CoP 读数 NaN。
 *   ③ 固定 `G=ΔCoP/Δτ`：植物增益 `g=1/Fz`，而实测 Fz 在 **0~578 N** 跳 ⇒ 固定 G 必错。
 *   ⇒ 只能**闭环**整定：直接跑真正的律，观察 `CoP_obs` 追 `CoP_want` 的收敛。
 *
 * 用法：`node tools/run.mjs probe-ankcop [COPK=0.5] [前缀秒=0.6] [尾秒=0.2]`
 *   （环境变量 `COPK` 也会被用作默认值）
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
  const bg = bgNs as any;
  const im: any = {};
  for (const i of WebAssembly.Module.imports(c)) {
    const f = bg[i.name];
    if (typeof f !== 'function') throw new Error(i.name);
    (im[i.module] ??= {})[i.name] = f;
  }
  bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
}
const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { shapeForJoints } = await import('../src/core/brain');

const log = (s: string) => console.log(s);
const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const COPK = Number(ARGS[0] ?? process.env.COPK ?? 0.5);
const T_ON = Number(ARGS[1] ?? 0.6);
const TAIL = Number(ARGS[2] ?? 0.2);
const SECS = T_ON + TAIL;
const HZ = 120, DT = 1 / HZ, PER = 2;
const sk = buildSkeleton(DEFAULT_CONFIG);

log(`══ probe-ankcop 闭环整定：COPK=${COPK}；${T_ON}s 前正常控制（VIP），此后 ANKLE_COP=1 ══`);
log('   t(s) 侧  CoP_obs  CoP_want   err(mm)    τ(N·m)  踝角°   Fz本  Fz对  ankCopOn');
process.env.ANKLE_COP = '0';
process.env.COPK = String(COPK);

const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: SECS });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, {
  ...DEFAULT_CONTROLLER,
  gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' },
});
const d = sim.doll;
const rs = ctrl.rs;
const jn = sk.joints.map((j) => j.name);
let on = false;
for (let i = 0; i < SECS * HZ && !sim.finished; i++) {
  const t = i / HZ;
  if (!on && t >= T_ON) { on = true; process.env.ANKLE_COP = '1'; }
  if (i % PER === 0) d.setMotorTargets(ctrl.step(DT));
  sim.advance(1);
  if (t < T_ON - 0.03) continue;
  const supS = rs.supportLeg();
  const side: 0 | 1 = supS === 'l' ? 0 : 1;
  const jAnk = jn.findIndex((n) => n === (side === 0 ? 'foot_l' : 'foot_r'));
  const ff = d.soleForceProfile(side, DT);
  const ffo = d.soleForceProfile(side === 0 ? 1 : 0, DT);
  const jr = new Float64Array(3); d.jointRot(jAnk, jr);
  const cop = ff.copValid ? (ff.copX * 1000).toFixed(1) : '  —  ';
  const want = (rs.copWantX * 1000).toFixed(1);
  const err = ff.copValid ? ((ff.copX - rs.copWantX) * 1000).toFixed(1) : '  —  ';
  log(`   ${t.toFixed(3)}  ${supS}  ${String(cop).padStart(8)}  ${want.padStart(8)}  ${String(err).padStart(8)}  ${rs.ankCopTau.toFixed(1).padStart(7)}  ${(jr[2]! * 57.2958).toFixed(1).padStart(6)}  ${ff.fz.toFixed(0).padStart(5)}  ${ffo.fz.toFixed(0).padStart(4)}   ${rs.ankCopOn}`);
}
