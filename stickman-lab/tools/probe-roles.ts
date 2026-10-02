// ═══════════════════════════════════════════════════════════════════════
//  ★ 阶段 × 角色 跟踪误差回读（用户 2026-10-02）
//  "让角色移动姿态符合各个阶段的参数" ⇒ 先把每格的实测 vs 文献目标打出来
// ═══════════════════════════════════════════════════════════════════════
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildSkeleton, DEFAULT_CONFIG, JOINT_ORDER } from '../src/core/skeleton';
import { Sim, DEFAULT_SIM } from '../src/core/sim';
import { shapeForJoints } from '../src/core/brain';
import { runCaptureTeacher, type CaptureParams } from '../src/core/teacher';
import { CAPTURE_GAIT } from '../src/core/phaseSeed';
import { PHASE_ROLE, cell, cellDesc, type Role } from '../src/core/normGait';

const require = createRequire(import.meta.url);
{
  const p = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const c = await WebAssembly.compile(fs.readFileSync(p));
  const imp: Record<string, Record<string, unknown>> = {};
  for (const i of WebAssembly.Module.imports(c)) {
    const f = (bgNs as unknown as Record<string, unknown>)[i.name];
    if (typeof f === 'function') (imp[i.module] ??= {})[i.name] = f;
  }
  const r = (await WebAssembly.instantiate(c, imp)) as unknown as
    { instance?: { exports: unknown }; exports: unknown };
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(
    r.instance ? r.instance.exports : r.exports,
  );
}
let FAILS = 0;
const check = (n: string, ok: boolean, got: string): void => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n.padEnd(40)} ${got}`);
  if (!ok) FAILS++;
};

const sk = buildSkeleton(DEFAULT_CONFIG);
const shape = shapeForJoints(sk.joints.length);
const DUR = 8;
const FB: CaptureParams = {
  T: CAPTURE_GAIT.T, vDes: CAPTURE_GAIT.vDes, lift: CAPTURE_GAIT.lift, kv: CAPTURE_GAIT.kv,
  kPitch: CAPTURE_GAIT.kPitch, kRate: CAPTURE_GAIT.kRate, thresh: CAPTURE_GAIT.thresh,
  absorb: CAPTURE_GAIT.absorb, absorbTau: CAPTURE_GAIT.absorbTau, kLat: 0, kLatV: 0, kLatSwing: 0,
  stanceLock: 0.6,
};

console.log('=== 阶段 × 角色 姿态指令表（目标全部来自文献）===\n');
for (const ph of ['both', 'step', 'adjust'] as const)
  for (const role of ['swingLeg', 'stanceLeg', 'waist'] as Role[])
    console.log('  ' + cellDesc(ph, role));

console.log('\n=== 实测跟踪误差（每格：相 × 角色）===\n');
const acc: Record<string, { hip: number[]; knee: number[]; n: number }> = {};
{
  const sim = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR, gaitHz: 1 / FB.T });
  sim.begin(new Float32Array(sim.params.length));
  const cb = (_t: number, stanceL: boolean): void => {
    const key = `${sim.gp.now}`;
    (acc[key] ??= { hip: [], knee: [], n: 0 }).n++;
    const rdh = (nm: string): number => {
      const i = JOINT_ORDER.indexOf(nm);
      if (i < 0) return 0;
      const v = sim.doll.jointAngle(i) + (sk.joints[i]?.restRad[2] ?? 0);
      return Number.isFinite(v) ? v : 0;
    };
    const a = acc[key]!;
    a.hip.push(Math.abs(rdh(stanceL ? 'hip_l' : 'hip_r')));
    a.knee.push(Math.abs(rdh(stanceL ? 'knee_l' : 'knee_r')));
  };
  runCaptureTeacher(sk, sim, FB, { dur: DUR, clockDriven: true, onFrame: cb });
  console.log('  相位   支撑脚数  支撑髋ROM  支撑膝ROM   指令表要求（stanceLeg）');
  for (const ph of ['both', 'step', 'adjust'] as const) {
    const a = acc[ph];
    const c = cell(ph, 'stanceLeg');
    const hd = a && a.hip.length ? (Math.max(...a.hip) - Math.min(...a.hip)) * 180 / Math.PI : null;
    const kd = a && a.knee.length ? (Math.max(...a.knee) - Math.min(...a.knee)) * 180 / Math.PI : null;
    console.log(`  ${ph.padEnd(7)} ${String(a?.n ?? 0).padStart(6)}  ${hd === null ? '   ——  ' : hd.toFixed(1).padStart(7) + '°'}`
      + `  ${kd === null ? '   ——  ' : kd.toFixed(1).padStart(7) + '°'}`
      + `   ${c ? `髋 ${c.hipDeg}° / 膝 ${c.kneeDeg}°  w=${c.w}` : '本相不设目标'}`);
  }
  const tot = Object.values(acc).reduce((a, b) => a + b.n, 0);
  console.log(`\n  相位占用：${Object.entries(acc).map(([k, v]) => `${k} ${(100 * v.n / tot).toFixed(0)}%`).join(' · ')}`);
  check('调整相（adjust）有帧占用', (acc.adjust?.n ?? 0) > 0, `${acc.adjust?.n ?? 0} 帧`);
}
console.log(`\n${FAILS === 0 ? '★ 角色回读完成' : `★ 角色回读完成，${FAILS} 项未达标`}`);
