/** probe-footroll.ts —— 承重脚有没有主动调整朝向（旋前）来扩大承重 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG, jointIndexByName } = await import('../src/core/skeleton');
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
const SHAPE = shapeForJoints(sk.joints.length);
const DEG = 180 / Math.PI;
const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'walk' });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, { ...DEFAULT_CONTROLLER });
const COP = new Float64Array(4);
const BB = new Float64Array(4);
const LD = new Float64Array(8);
// 足刚体的滚转（绕自身长轴 x）：+ = 外侧缘下沉（旋前）
function footRoll(side: 0 | 1): number {
  const d: any = sim.doll;
  const bi = (d as any).bodies[(d as any).sk.joints.findIndex((j: any) =>
    j.name === (side === 0 ? 'foot_l' : 'foot_r')) * 2 + 1];
  if (!bi) return NaN;
  const q = bi.rotation();
  // 足长轴 = 局部 X，脚朝 +x；取局部 X 在世界 z 分量 ⇒ 正 = 脚尖偏 +z
  const xw = q[0]! * q[0]! + q[1]! * q[1]!;
  void xw;
  const zx = 1 - 2 * (q[1]! * q[1]! + q[2]! * q[2]!);   // R[0][2] 近似
  return Math.asin(Math.max(-1, Math.min(1, zx))) * DEG;
}
log('══ 承重脚朝向 + 逐块承重（站距1.0，髋外展τ=120）══');
log('   t   承重  L载  CoM.z  足滚角  CoP内侧余量  足跟 外侧柱 跖骨  趾 | 倾角');
for (let i = 0; i < 120 * 2.2 && !sim.finished; i++) {
  if (i % 2 === 0) sim.doll.setMotorTargets(ctrl.step(1 / 60));
  sim.advance(1);
  if (i % 8) continue;
  const s = ctrl.snapshot;
  const sup = s.supportLeg;
  const idx = (sup === 'l' ? 0 : 1) as 0 | 1;
  sim.doll.readCoP(idx, COP); sim.doll.footSoleBounds(idx, BB);
  sim.doll.soleBlockLoad(idx, LD);
  const med = COP[3]! > 0 ? (COP[2]! - BB[2]!) * 1000 : NaN;
  log(`  ${s.t.toFixed(2).padStart(5)} ${sup}  ${(s.legs.l.loadFrac * 100).toFixed(0).padStart(3)}%`
    + ` ${(s.com.z * 1000).toFixed(0).padStart(6)} ${footRoll(idx).toFixed(1).padStart(7)}°`
    + ` ${med.toFixed(0).padStart(9)}mm`
    + ` ${(LD[0]! * 100).toFixed(0).padStart(5)} ${(LD[1]! * 100).toFixed(0).padStart(5)}`
    + ` ${(LD[3]! * 100).toFixed(0).padStart(4)} ${(LD[5]! * 100).toFixed(0).padStart(4)}`
    + ` | ${s.tiltDeg.toFixed(1)}°`);
  if (s.tiltDeg >= 25) break;
}
