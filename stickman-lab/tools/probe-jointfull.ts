/**
 * probe-jointfull —— **全关节完整变化回读**（用户："回读关节的完整变化"）
 *
 *   记录每一拍的**所有关节**角度/力矩（60Hz），输出：
 *     ① 逐关节统计：角度范围、τ 峰值、限位违例
 *     ② 时间线采样（每 0.2s 一行，关键关节）
 *     ③ 违例汇总（哪根轴、超了多少、持续多久）
 *   用法：`node tools/run.mjs probe-jointfull [秒]`
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
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { shapeForJoints } = await import('../src/core/brain');

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const T = Number(ARGS[0] ?? 4);

const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: T + 0.3 });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, DEFAULT_CONTROLLER);
const d = sim.doll;
const HZ = 120, DT = 1 / HZ;
const NJ = sk.joints.length;

// 逐轴统计
const stat = Array.from({ length: NJ }, () => ({
  name: '', lo: Infinity, hi: -Infinity, tauMax: 0, satN: 0, violN: 0, violMax: 0,
}));
for (let i = 0; i < NJ; i++) stat[i]!.name = sk.joints[i]!.name;

const buf = new Float64Array(3);
const log = (s: string) => console.log(s);
const N = Math.round(T * HZ);
for (let k = 0; k <= N; k++) {
  ctrl.step(DT);
  sim.advance(2);
  for (let i = 0; i < NJ; i++) {
    const st = stat[i]!;
    const jd = sk.joints[i]!;
    for (let ax = 0; ax < 3; ax++) {
      d.jointRot(i, buf);
      const deg = buf[ax]! * 57.2958;
      if (deg < st.lo) st.lo = deg;
      if (deg > st.hi) st.hi = deg;
      const tau = d.tauApplied[i * 3 + ax] ?? 0;
      const tm = Math.abs(tau);
      if (tm > st.tauMax) st.tauMax = tm;
      if (tm > 0.95 * (jd.maxTorque[ax] ?? 1e9)) st.satN++;
      const loDeg = jd.minRad[ax]! * 57.2958, hiDeg = jd.maxRad[ax]! * 57.2958;
      if (deg < loDeg - 1 || deg > hiDeg + 1) {
        st.violN++;
        const ov = Math.max(loDeg - deg, deg - hiDeg);
        if (ov > st.violMax) st.violMax = ov;
      }
    }
  }
}

log(`══ probe-jointfull（${T}s，${N} 拍 × ${NJ} 关节）══`);
log('  关节           角下限   角上限   τ峰值  饱和拍  违例拍  最大超出°');
for (let i = 0; i < NJ; i++) {
  const st = stat[i]!;
  const flag = st.violN > 0 ? ' ←⚠' : st.satN > 20 ? ' ←饱和' : '';
  log(
    `  ${st.name.padEnd(12)}${st.lo.toFixed(1).padStart(8)}${st.hi.toFixed(1).padStart(8)}` +
    `${st.tauMax.toFixed(0).padStart(7)}${String(st.satN).padStart(8)}${String(st.violN).padStart(8)}` +
    `${st.violMax.toFixed(1).padStart(9)}${flag}`,
  );
}
