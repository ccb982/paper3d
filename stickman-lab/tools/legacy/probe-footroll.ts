/**
 * probe-footroll.ts —— **柔性足 F2（弓刚体 + 旋前关节）是否真的起作用**
 * 判据（`柔性足设计.md` §7）：
 *   ① 弓角能进限位 [−4°,16°] 且**不为 0**（不转 = 白加）
 *   ② 弓块承重 **> 0**（当前基线是 ≈0）
 *   ③ 弓角**稳定**不oscillate（中足当初塌陷/抽动就是这么来的）
 *   ④ CoP 内侧余量从 0mm 变正（支撑面真的变宽了）
 */
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
const { DEFAULTS } = await import('../src/core/ragdoll');
const { shapeForJoints } = await import('../src/core/brain');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const log = console.log;
const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);
const DEG = 180 / Math.PI;
const ARCH: Record<string, number> = {
  l: jointIndexByName(sk, 'arch_l'), r: jointIndexByName(sk, 'arch_r'),
};
log(`   刚体 ${sk.bodies.length} / 关节 ${sk.joints.length}   arch_l idx=${ARCH.l} arch_r idx=${ARCH.r}`);

const COP = new Float64Array(4);
const BB = new Float64Array(4);
const LD = new Float64Array(8);
log('══ 弓关节刚度/阻尼扫描（K=N·m/rad, B=N·m·s/rad）══');
log('     K      B   弓角min  弓角max  摆幅  弓承重峰  CoP内侧余量  存活倾角');
for (const K of [1, 2, 4, 6, 7.3]) {
  for (const B of [0.005, 0.012, 0.025, 0.03]) {
    DEFAULTS.archStiffness = K;      // ⚠ 必须在构造前（K/B 是构造时折算的）
    DEFAULTS.archDamping = B;
    const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'walk' });
    sim.begin(new Float32Array(sim.paramCount));
    const ctrl = new Controller(sk, sim, { ...DEFAULT_CONTROLLER });
    let aMin = 1e9, aMax = -1e9, archPk = 0, medBest = -1e9, tilt = 0;
    let dbg = '';
    for (let i = 0; i < 120 * 2.5 && !sim.finished; i++) {
      if (i % 2 === 0) sim.doll.setMotorTargets(ctrl.step(1 / 60));
      sim.advance(1);
      if (i % 8) continue;
      const s = ctrl.snapshot;
      const sup = s.supportLeg;
      const idx = (sup === 'l' ? 0 : 1) as 0 | 1;
      sim.doll.readCoP(idx, COP); sim.doll.footSoleBounds(idx, BB);
      sim.doll.soleBlockLoad(idx, LD);
      const med = COP[3]! > 0 ? (COP[2]! - BB[2]!) * 1000 : NaN;
      const ax: any = s.axes.find((x: any) => x.joint === ARCH[sup] && x.axis === 0);
      const a = ax?.pos ?? NaN;
      if (dbg === '' && Number.isFinite(a)) {
        dbg = `目标=${((ax.target ?? 0) * DEG).toFixed(1)}° 归属=${ax.ownerLabel}`
          + ` hold=${(sim.doll as any).holdCmd[ARCH[sup] * 3]}`
          + ` 角度=${(a * DEG).toFixed(1)}° 角速=${((ax.vel ?? 0) * DEG).toFixed(0)}°/s`;
      }
      if (Number.isFinite(a)) { aMin = Math.min(aMin, a * DEG); aMax = Math.max(aMax, a * DEG); }
      archPk = Math.max(archPk, (LD[2]! + LD[3]!) / 2);   // ★ 归一：两块的份额要除以块数
      if (Number.isFinite(med)) medBest = Math.max(medBest, med);
      tilt = Math.max(tilt, s.tiltDeg);
      if (s.tiltDeg >= 25) break;
    }
    const swing = aMax - aMin;
    log(`   ${String(K).padStart(4)} ${String(B).padStart(6)}`
      + ` ${aMin.toFixed(1).padStart(7)}° ${aMax.toFixed(1).padStart(7)}°`
      + ` ${swing.toFixed(1).padStart(5)}° ${(archPk * 100).toFixed(0).padStart(8)}%`
      + ` ${medBest.toFixed(0).padStart(10)}mm ${tilt.toFixed(0).padStart(8)}°`
      + `  ${swing < 3 ? '✓稳定' : '✗振荡'}`);
    if (K === 60 && B === 6) log(`      ↳ ${dbg}`);
  }
}
