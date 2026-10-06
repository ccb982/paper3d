/**
 * ══════════════════════════════════════════════════════════════════
 * probe-slip.ts —— **承重脚打滑？腰向后？** 逐帧定量
 * ══════════════════════════════════════════════════════════════════
 *
 * 用户 2026-10-06：「**腰还在向后，承重脚出现打滑了**」。
 *
 * 每 STEP 秒一行：
 *   · 双脚**踝的世界 x**（滑移的直接读数：脚在地上就不该漂）与区间内 Δx
 *   · 双脚**摩擦占用** `frictionUse = Σ|f_t| / (μ Σf_n)`（≥1 ⇒ 摩擦锥打满 ⇒ 必滑）
 *     与切向合力 `Σpatches[].t`、μ·Fz
 *   · `CoM.x / vx`、**腰（spine1 的世界 x）**、躯干 pitch
 * 末尾给：两脚的全段 Δx（滑移总量）与摩擦占用峰值。
 *
 * 用法：`node tools/run.mjs probe-slip [秒数=12] [间隔=0.5]`
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
const SECS = Number(ARGS[0] ?? 12);
const STEP = Number(ARGS[1] ?? 0.5);
const HZ = PHZ > 0 ? PHZ : 120, DT = 1 / 120, PER = Math.max(1, Math.round(HZ / 60));
const sk = buildSkeleton(DEFAULT_CONFIG);
const jn = sk.joints.map((j) => j.name);
const jAnkL = jn.indexOf('foot_l'), jAnkR = jn.indexOf('foot_r');
const jSp1 = jn.indexOf('spine1');

log(`══ probe-slip ${SECS}s：承重脚滑移 + 腰向后（每 ${STEP}s）══`);
log('   t(s)  踝L.x   ΔL    踝R.x   ΔR   | 左μ 右μ  左Ft 右Ft  左μFz 右μFz | CoM.x  vx   腰x    pitch');
const PHZ = Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).PHZ ?? '') || 0;
const sim = new Sim(sk, shapeForJoints(sk.joints.length), {
  ...DEFAULT_SIM, mode: 'stand', duration: SECS,
  ...(PHZ > 0 ? { physicsHz: PHZ } : {}),
});
sim.begin(new Float32Array(sim.paramCount));
const ABL = (ARGS[2] ?? '').trim();   // 用法: probe-slip [秒] [间隔] [ABL]
const ctrl = new Controller(sk, sim, {
  ...DEFAULT_CONTROLLER,
  gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' },
  balance: { ...DEFAULT_CONTROLLER.balance, ablate: ABL || undefined },
});
const d = sim.doll;
const rs = ctrl.rs;
const jw = new Float64Array(3);
const jr2 = new Float64Array(3);
const xOf = (j: number): number => { d.jointWorld(j, jw); return jw[0]!; };
const tangentOf = (ff: { patches: { t: number }[] }): number => ff.patches.reduce((a, p) => a + (Number.isFinite(p.t) ? p.t : 0), 0);
const head = d.bodyByKey('head');
const headY = (): number => (head ? head.translation().y : Number.NaN);
let prevL = xOf(jAnkL), prevR = xOf(jAnkR);
let nextT = 0;
let maxMuL = 0, maxMuR = 0;
let firstCollapse = -1;      // ★ 真倒：头y<0.6（头碰地判据会漏"侧塌"）
let xlAtFall = Number.NaN, xrAtFall = Number.NaN;   // 倒地时刻的踝 x（滑移只算到倒下）
const x0L = prevL, x0R = prevR;
for (let i = 0; i < SECS * HZ && !sim.finished; i++) {
  if (i % PER === 0) d.setMotorTargets(ctrl.step(DT));
  sim.advance(1);
  const t = i / HZ;
  if (firstCollapse < 0 && headY() < 0.6) { firstCollapse = t; xlAtFall = xOf(jAnkL); xrAtFall = xOf(jAnkR); }
  const fl = d.soleForceProfile(0, DT), fr = d.soleForceProfile(1, DT);
  if (Number.isFinite(fl.frictionUse)) maxMuL = Math.max(maxMuL, fl.frictionUse);
  if (Number.isFinite(fr.frictionUse)) maxMuR = Math.max(maxMuR, fr.frictionUse);
  if (t + 1e-6 < nextT) continue;
  nextT += STEP;
  const xl = xOf(jAnkL), xr = xOf(jAnkR);
  const mu = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : ' — ').padStart(5);
  log(`   ${t.toFixed(2).padStart(5)} ${((xl * 1000).toFixed(1)).padStart(6)} ${((xl - prevL) * 1000).toFixed(1).padStart(6)}`
    + ` ${((xr * 1000).toFixed(1)).padStart(6)} ${((xr - prevR) * 1000).toFixed(1).padStart(6)}`
    + ` |${mu(fl.frictionUse)}${mu(fr.frictionUse)}${tangentOf(fl).toFixed(0).padStart(6)}${tangentOf(fr).toFixed(0).padStart(6)}`
    + `${(0.8 * fl.fz).toFixed(0).padStart(7)}${(0.8 * fr.fz).toFixed(0).padStart(7)}`
    + ` | ${((rs.com.x * 1000).toFixed(0)).padStart(5)} ${((rs.com.vx * 1000).toFixed(0)).padStart(5)}`
    + ` ${((xOf(jSp1) * 1000).toFixed(0)).padStart(5)}  ${(rs.tiltDeg ?? 0).toFixed(1)}`
    + ` | 侧: CoMz=${((rs.com.z * 1000).toFixed(0)).padStart(5)} vz=${((rs.com.vz * 1000).toFixed(0)).padStart(5)}`
    + ` | 前: needX=${((rs.copPlan?.needX ?? 0) * 1000).toFixed(0).padStart(5)} overX=${((rs.copPlan?.overX ?? 0) * 1000).toFixed(0).padStart(5)} errX=${((rs.copPlan?.errX ?? 0) * 1000).toFixed(0).padStart(5)}`
    + ` 承τ=(${rs.supLegTau.hip.toFixed(0)},${rs.supLegTau.knee.toFixed(0)},${rs.supLegTau.ank.toFixed(0)}) Fh=${rs.supLegTau.Fh.toFixed(0)} Fv=${rs.supLegTau.Fv.toFixed(0)}`
    + `  头y=${headY().toFixed(2)} CoMy=${rs.com.y.toFixed(2)}`
    + ` grf=(${rs.grfCmd.x.toFixed(0)},${rs.grfCmd.y.toFixed(0)},${rs.grfCmd.z.toFixed(0)})`
    + (() => {
      const supS = rs.supportLeg();
      const jH = jn.indexOf(`hip_${supS}`), jK = jn.indexOf(`knee_${supS}`), jA = jn.indexOf(`foot_${supS}`);
      const g = (j: number): string => { if (j < 0) return '  — '; d.jointRot(j, jr2); return (jr2[2]! * 57.2958).toFixed(0).padStart(4); };
      return ` 支撑${supS}: 髋${g(jH)}° 膝${g(jK)}° 踝${g(jA)}°`;
    })()
    + (rs.copPlan ? `  | 落足X=${(rs.copPlan.stepX * 1000).toFixed(0)} Z=${(rs.copPlan.stepZ * 1000).toFixed(0)} 急=${rs.copPlan.stepUrgent.toFixed(2)}${rs.copPlan.fallNeeded ? '★必迈' : ''}` : ''));
  prevL = xl; prevR = xr;
}
log(`\n── 全段滑移总量 ──`);
log(`  左踝 Δx = ${((prevL - x0L) * 1000).toFixed(1)} mm    右踝 Δx = ${((prevR - x0R) * 1000).toFixed(1)} mm`);
log(`  左摩擦占用峰值 = ${maxMuL.toFixed(2)}    右 = ${maxMuR.toFixed(2)}    （≥1.0 ⇒ 摩擦锥打满）`);
log(`  ★ **真倒时刻**（头y<0.6）: ${firstCollapse < 0 ? '未倒' : firstCollapse.toFixed(2) + ' s'}`);
if (firstCollapse >= 0) {
  log(`  ★ **倒地前**滑移: 左 ${((xlAtFall - x0L) * 1000).toFixed(1)} mm   右 ${((xrAtFall - x0R) * 1000).toFixed(1)} mm`);
}
