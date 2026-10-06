/**
 * probe-ablate.ts —— 分系统验证：
 *   ① 重心侧移系统（step 申报的 push / lean 意图）**是否真的搬得动重心**
 *   ② 保护伺服（balance 的 CoP 余量门限 + 侧倾限幅）**是否是承力构件**
 *
 * ★ 判定口径（用户 2026-10-05：站得久不久不是唯一标准）：
 *   · 侧移系统是否起作用 = **X3 误差有没有变小**（`com.z − soleZ[支撑]`），
 *     不是载荷峰值、不是存活。
 *   · 保护伺服是否起作用 = 把护栏**拆掉**后是否真的更坏。
 *     若拆掉没变化 ⇒ 那些护栏是装饰，必须删掉（项目原则：假权威不保留）。
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
const { DEFAULT_STEP_PARAMS } = await import('../src/core/systems/step');
const { DEFAULT_BALANCE_PARAMS } = await import('../src/core/systems/balance');

const log = console.log;
const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);
const COP = new Float64Array(4);
const BB = new Float64Array(4);
const DEG = 180 / Math.PI;

interface Case { name: string; fmax: number; zeta: number; guard: boolean }
const CASES: Case[] = [
  { name: '基线（驱动关，shiftFMax=0）  ', fmax: 0, zeta: 1.0, guard: true },
  { name: '驱动 ω₀=2 ζ=1 Fmax=60      ', fmax: 60, zeta: 1.0, guard: true },
  { name: '驱动 ζ=0.5（欠阻尼）        ', fmax: 60, zeta: 0.5, guard: true },
  { name: '驱动 ζ=1.5（过阻尼）        ', fmax: 60, zeta: 1.5, guard: true },
  { name: '驱动 Fmax=120（大）         ', fmax: 120, zeta: 1.0, guard: true },
  { name: '★拆护栏：Fmax=60 无 CoP 门限', fmax: 60, zeta: 1.0, guard: false },
];

log('══ ① 重心侧移系统：X3 误差（|com.z − 支撑脚z|，门限 50mm）有没有变小 ══');
log('   配置                          最小X3   末X3   申报力  实加力矩  存活');
const rows: string[] = [];
for (const cs of CASES) {
  const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'walk' });
  sim.begin(new Float32Array(sim.paramCount));
  const ctrl = new Controller(sk, sim, {
    ...DEFAULT_CONTROLLER,
    step: { ...DEFAULT_STEP_PARAMS, shiftFMax: cs.fmax, shiftZeta: cs.zeta },
    balance: {
      ...DEFAULT_BALANCE_PARAMS,
      // 拆护栏：CoP 余量门限设成负数 ⇒ 永不拦截；侧倾限幅放到 10rad ⇒ 不限
      latShiftCopMargin: cs.guard ? DEFAULT_BALANCE_PARAMS.latShiftCopMargin : -10,
    },
  });
  let dzMin = 1e9, dzEnd = 0, dPk = 0, aPk = 0, clipped = 0, alive = 0, tiltMax = 0;
  for (let i = 0; i < 120 * 14 && !sim.finished; i++) {
    if (i % 2 === 0) sim.doll.setMotorTargets(ctrl.step(1 / 60));
    sim.advance(1);
    if (i % 2) continue;
    const s = ctrl.snapshot;
    const sup = s.supportLeg;
    dzMin = Math.min(dzMin, Math.abs(s.com.z - s.legs[sup].footZ));
    dzEnd = Math.abs(s.com.z - s.legs[sup].footZ);
    const d = Math.abs(s.shiftDemandF ?? 0);
    const a = Math.abs(s.shiftPushTau ?? 0);
    dPk = Math.max(dPk, d); aPk = Math.max(aPk, a);
    clipped = Math.max(clipped, d - a);
    tiltMax = Math.max(tiltMax, s.tiltDeg);
    if (s.tiltDeg >= 25) break;
    alive = s.t;
  }
  void COP; void BB;
  rows.push(`   ${cs.name} ${(dzMin * 1000).toFixed(0).padStart(5)}mm`
    + ` ${(dzEnd * 1000).toFixed(0).padStart(6)}mm`
    + ` ${dPk.toFixed(0).padStart(6)}N ${aPk.toFixed(0).padStart(5)}N·m`
    + ` ${clipped.toFixed(0).padStart(10)}  ${alive.toFixed(2)}s`);
  log(`   ${cs.name} ${(dzMin * 1000).toFixed(0).padStart(5)}mm`
    + ` ${(dzEnd * 1000).toFixed(0).padStart(6)}mm`
    + ` ${dPk.toFixed(0).padStart(6)}N ${aPk.toFixed(0).padStart(5)}N·m`
    + ` ${clipped.toFixed(0).padStart(10)}  ${alive.toFixed(2)}s`);
}
log('');
log('══ ③ X3 只是**瞬时**达标还是能**保持**？X4 要求连续驻留 1s ══');
for (const cs of CASES.slice(0, 4)) {
  const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'walk' });
  sim.begin(new Float32Array(sim.paramCount));
  const ctrl = new Controller(sk, sim, {
    ...DEFAULT_CONTROLLER,
    step: { ...DEFAULT_STEP_PARAMS, shiftPushGain: cs.push, shiftLeanGain: cs.lean },
  });
  let run = 0, bestRun = 0, inside = 0, tot = 0;
  for (let i = 0; i < 120 * 14 && !sim.finished; i++) {
    if (i % 2 === 0) sim.doll.setMotorTargets(ctrl.step(1 / 60));
    sim.advance(1);
    if (i % 2) continue;
    const s = ctrl.snapshot; const sup = s.supportLeg;
    const dz = Math.abs(s.com.z - s.legs[sup].footZ);
    tot++;
    if (dz <= 0.05) { run++; inside++; bestRun = Math.max(bestRun, run); }
    else run = 0;
    if (s.tiltDeg >= 25) break;
  }
  log(`   ${cs.name} X3<50mm 占 ${(100 * inside / Math.max(1, tot)).toFixed(0).padStart(3)}%`
    + `  最长连续驻留 = ${(bestRun / 60).toFixed(2)}s（X4 需要 1.00s）`
    + `  ${bestRun / 60 >= 1 ? '✓ 够' : '✗ 差 ' + (1 - bestRun / 60).toFixed(2) + 's'}`);
}
log('');
log('══ ② 保护伺服：拆掉护栏后 CoP 是否跑出支撑面 ══');
for (const cs of CASES.slice(0, 4).concat(CASES.slice(4))) {
  const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'walk' });
  sim.begin(new Float32Array(sim.paramCount));
  const ctrl = new Controller(sk, sim, {
    ...DEFAULT_CONTROLLER,
    step: { ...DEFAULT_STEP_PARAMS, shiftPushGain: cs.push, shiftLeanGain: cs.lean },
    balance: {
      ...DEFAULT_BALANCE_PARAMS,
      latShiftCopMargin: cs.guard ? DEFAULT_BALANCE_PARAMS.latShiftCopMargin : -10,
      shiftLeanMax: cs.guard ? DEFAULT_BALANCE_PARAMS.shiftLeanMax : 10,
      maxWaistTrim: cs.guard ? DEFAULT_BALANCE_PARAMS.maxWaistTrim : 1.2,
    },
  });
  let minMed = 1e9, outOfSole = 0, n = 0, tiltMax = 0;
  for (let i = 0; i < 120 * 14 && !sim.finished; i++) {
    if (i % 2 === 0) sim.doll.setMotorTargets(ctrl.step(1 / 60));
    sim.advance(1);
    if (i % 2) continue;
    const s = ctrl.snapshot;
    const idx = s.supportLeg === 'l' ? 0 : 1;
    sim.doll.readCoP(idx as 0 | 1, COP);
    sim.doll.footSoleBounds(idx as 0 | 1, BB);
    if (COP[3]! > 0) {
      n++;
      const med = COP[2]! - BB[2]!;
      minMed = Math.min(minMed, med);
      if (med < 0 || COP[2]! > BB[3]! || COP[0]! < BB[0]! || COP[0]! > BB[1]!) outOfSole++;
    }
    tiltMax = Math.max(tiltMax, s.tiltDeg);
    if (s.tiltDeg >= 25) break;
  }
  log(`   ${cs.name} CoP最小侧缘余量=${(minMed * 1000).toFixed(0).padStart(4)}mm`
    + `  出界帧=${String(outOfSole).padStart(4)}/${n}  倾角峰=${tiltMax.toFixed(0).padStart(2)}°`);
}
