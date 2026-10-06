/**
 * ══════════════════════════════════════════════════════════════════
 * probe-footlat.ts —— **足部侧向发力表征**（自研，不借论文）
 * ══════════════════════════════════════════════════════════════════
 *
 * 背景（用户 2026-10-06）：
 *   「需要重写力链，特别是**我的柔性足是支持脚的侧向发力的**」
 *   「实在不行优先重构足部的侧向发力」
 *
 * 要回答三个问题（全是**实测**，不靠论文）：
 *   Q1 **切向冲量到底能不能用**？前人记录说 `contactTangentImpulseX/Y` 恒 NaN
 *      ⇒ 若能读出，力链的 `fx/fzTan` 就该用它；若不能，只能走 CoM 动力学。
 *   Q2 **侧向发力靠哪个执行器**？`foot_*` 只有屈伸（[0,0,1]）⇒ 侧向只能靠
 *      `hip_*` 的轴0（外展 120 N·m）与 `arch_*` 的轴0（旋前旋后 30 N·m）。
 *      逐个扫力矩，看 CoP_z 与内/外侧柱载荷怎么变。
 *   Q3 **权限有多大**？N·m → mm CoP、N·m → N 侧向力（由 CoM 加速度反推）。
 *
 * 用法：node tools/run.mjs probe-footlat
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

const DEG = 180 / Math.PI;
const log = (s: string) => console.log(s);
let fails = 0;
const check = (name: string, ok: boolean, extra = '') => {
  log(`  ${ok ? '✓' : '✗'} ${name}${extra ? '  — ' + extra : ''}`);
  if (!ok) fails++;
};

const HZ = 120, DT = 1 / 60;
const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);
const nAx = sk.joints.length * 3;
const MASS = sk.bodies.reduce((a, b) => a + (b.mass ?? 0), 0);

/** 诊断：要监视 `tauApplied` 的 flat 轴下标（−1 = 不监视） */
let WATCH = -1;

/** 跑一次站立，phase 回调可注入直接力矩（N·m，逐轴） */
function run(
  name: string,
  inject: (tSec: number, tau: Float64Array, d: any) => void,
  dur = 1.6,
  sample?: (i: number, d: any, c2: any, s: RunSample) => void,
): RunSample {
  const s2 = buildSkeleton(DEFAULT_CONFIG);
  const sim = new Sim(s2, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: dur });
  sim.begin(new Float32Array(sim.paramCount));
  const ctrl = new Controller(s2, sim, {
    ...DEFAULT_CONTROLLER,
    gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' },
    balance: DEFAULT_CONTROLLER.balance,
  });
  const d = sim.doll;
  const tau = new Float64Array(nAx);
  const tauF32 = new Float32Array(nAx);
  const st: RunSample = {
    name, copZ: { l: [], r: [] }, colIn: { l: [], r: [] }, colOut: { l: [], r: [] },
    fz: { l: [], r: [] }, copValid: { l: [], r: [] }, ft: [], fn: [], comZ: [], comAzLat: [], jfz: [], jfx: [],
    watchTau: [], watchAng: [],
    secs: 0, fall: '',
  };
  const fric = new Float64Array(2);
  const jf = new Float64Array(s2.joints.length * 5);
  const iFootL = jointIndexByName(s2, 'foot_l');
  const iFootR = jointIndexByName(s2, 'foot_r');
  let prevVz = 0;
  for (let i = 0; i < dur * HZ && !sim.finished; i++) {
    if (i % 2 === 0) {
      d.setMotorTargets(ctrl.step(DT));
      tau.fill(0);
      inject(i / HZ, tau, d);
      if (tau.some((v) => v !== 0)) { tauF32.set(tau); d.setTorqueTargets(tauF32); }
    }
    sim.advance(1);
    if (i < 30) continue;
    if (i % 2 === 0) {
      const rs = ctrl.rs;
      const v = rs.com.vz;
      const az = (v - prevVz) / DT;
      prevVz = v;
      st.comAzLat.push(MASS * az);
      st.comZ.push(rs.com.z);
      for (const s of [0, 1] as const) {
        const p = d.soleForceProfile(s, 1 / HZ);
        const key = s === 0 ? 'l' : 'r';
        st.copZ[key].push(p.copValid ? p.copZ : NaN);
        st.colIn[key].push(p.colIn);
        st.colOut[key].push(p.colOut);
        st.fz[key].push(p.fz);
        st.copValid[key].push(p.copValid ? 1 : 0);
        d.soleFrictionUse(s, fric);
        st.ft.push(fric[0]!); st.fn.push(fric[1]!);
      }
      d.jointForce(jf, 1 / HZ);
      st.jfz.push(jf[iFootL * 5 + 2]! + jf[iFootR * 5 + 2]!);
      st.jfx.push(jf[iFootL * 5 + 0]! + jf[iFootR * 5 + 0]!);
      if (WATCH >= 0) {
        st.watchTau.push(d.tauApplied[WATCH] ?? 0);
        const rv2 = new Float64Array(3);
        d.jointRot(Math.floor(WATCH / 3), rv2);
        st.watchAng.push(rv2[WATCH % 3]! * DEG);
      }
    }
    sample?.(i, d, ctrl, st);
  }
  st.secs = sim.ticksDone / HZ;
  st.fall = sim.fallReason || '';
  return st;
}

interface RunSample {
  name: string;
  copZ: { l: number[]; r: number[] };
  colIn: { l: number[]; r: number[] };
  colOut: { l: number[]; r: number[] };
  fz: { l: number[]; r: number[] };
  copValid: { l: number[]; r: number[] };
  ft: number[]; fn: number[];
  comZ: number[]; comAzLat: number[];
  jfz: number[]; jfx: number[];
  /** ★ 诊断：注入轴的实际下发力矩（N·m）与该轴关节角（deg） */
  watchTau: number[]; watchAng: number[];
  secs: number; fall: string;
}

const avgW = (a: number[]): number => {
  const v = a.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((p, q) => p + q, 0) / v.length : NaN;
};
const avg = (a: number[]): number => {
  const v = a.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((p, q) => p + q, 0) / v.length : NaN;
};

// ══════════════════════════════════════════════════════════════════
log('══ Q1. 切向冲量到底能不能读（决定 fx/fzTan 的实现路线）══');
{
  const r = run('baseline', () => { /* 无注入 */ }, 1.4);
  const ftSum = r.ft.reduce((a, b) => a + b, 0);
  const fnSum = r.fn.reduce((a, b) => a + b, 0);
  log(`   Σ|f_t| = ${ftSum.toFixed(1)}   Σf_n = ${fnSum.toFixed(1)}   （${r.ft.length} 拍双脚合计）`);
  // ★ 这不是"缺陷"，是**路线决定**：切向冲量不可用 ⇒ `fx/fzTan` 必须走 CoM 动力学。
  log(ftSum > 0
    ? '   ⇒ 路线：切向冲量可用（可作为接触级测力）'
    : '   ⇒ ★ 路线决定：切向冲量**不可用** ⇒ `fx/fzTan` 走 `m·a_com` 分配（已在 forceChain 落地）');
  if (ftSum > 0) log(`   ⇒ 摩擦占用 = ${((ftSum / Math.max(1e-9, fnSum)) * 100).toFixed(1)}%`);
}

// ══════════════════════════════════════════════════════════════════
log('');
log('══ Q2. 侧向执行器扫描：哪个轴真的能把 CoP/内外侧柱推动 ══');
const iHipL = jointIndexByName(sk, 'hip_l');
const iHipR = jointIndexByName(sk, 'hip_r');
const iArchL = jointIndexByName(sk, 'arch_l');
const iArchR = jointIndexByName(sk, 'arch_r');
log(`   轴下标：hip_l/0=${iHipL * 3}  hip_r/0=${iHipR * 3}  arch_l/0=${iArchL * 3}  arch_r/0=${iArchR * 3}`);

const WATCH_AXES = [iHipL * 3, iHipL * 3, iHipL * 3, iHipL * 3, iHipL * 3, iArchL * 3, iArchL * 3, iHipL * 3];
const CASES: [string, (tau: Float64Array, d: any) => void][] = [
  ['无注入(基线)', () => {}],
  ['hip_l/0 +30N·m（左髋外展）', (t) => { t[iHipL * 3] = 30; }],
  ['hip_l/0 −30N·m（左髋内收）', (t) => { t[iHipL * 3] = -30; }],
  ['hip_l/0 +80N·m', (t) => { t[iHipL * 3] = 80; }],
  ['hip_l/0 −80N·m', (t) => { t[iHipL * 3] = -80; }],
  ['arch 目标角 +8°（旋前）', (_tau, d) => { d.setArchRoll(0, 8 / DEG); }],
  ['arch 目标角 −4°（旋后）', (_tau, d) => { d.setArchRoll(0, -4 / DEG); }],
  ['两髋对推 ±40（压向左腿）', (t) => { t[iHipL * 3] = 40; t[iHipR * 3] = -40; }],
];

log('   配置                        左脚CoP_z mm  左内/外侧柱N   左右fz N      实侧向力N  CoM.z mm  存活   监视轴τ/角');
const rows: { tag: string; copz: number; ci: number; co: number; fl: number; fr: number; fx: number; comz: number; secs: number; wAng: number; wTau: number }[] = [];
for (let ci = 0; ci < CASES.length; ci++) {
  const [tag, inj] = CASES[ci]!;
  WATCH = WATCH_AXES[ci]!;
  const r = run(tag, (_t, tau, d) => inj(tau, d), 1.2);
  WATCH = -1;
  const row = {
    tag,
    copz: avg(r.copZ.l) * 1000,
    ci: avg(r.colIn.l), co: avg(r.colOut.l),
    fl: avg(r.fz.l), fr: avg(r.fz.r),
    fx: avg(r.comAzLat),
    comz: avg(r.comZ) * 1000,
    secs: r.secs,
    wAng: avgW(r.watchAng),
    wTau: avgW(r.watchTau),
  };
  rows.push(row);
  log(`   ${tag.padEnd(26)} ${row.copz.toFixed(0).padStart(9)}`
    + `  ${row.ci.toFixed(0).padStart(5)}/${row.co.toFixed(0).padStart(5)}`
    + `  ${row.fl.toFixed(0).padStart(5)}/${row.fr.toFixed(0).padStart(5)}`
    + `  ${row.fx.toFixed(1).padStart(8)}  ${row.comz.toFixed(0).padStart(7)}  ${row.secs.toFixed(2)}s`
    + `  ${avgW(r.watchTau).toFixed(1).padStart(8)}/${avgW(r.watchAng).toFixed(1).padStart(7)}°`);
  r.copZ.l.length = 0;
}

// ══════════════════════════════════════════════════════════════════
log('');
log('══ Q3. 结论 ══');
{
  const base = rows[0]!;
  const hipPlus = rows[1]!;
  const hipMinus = rows[2]!;
  const archPlus = rows[5]!;
  const archMinus = rows[6]!;
  const dCopHip = Math.abs(hipPlus.copz - base.copz) + Math.abs(hipMinus.copz - base.copz);
  const dCopArch = Math.abs(archPlus.copz - base.copz) + Math.abs(archMinus.copz - base.copz);
  log(`   · 髋外展 ±30 N·m ⇒ 左脚 CoP_z 变化合计 ${dCopHip.toFixed(1)}mm`);
  log(`   · arch 目标角 ±(旋前8°/旋后4°) ⇒ 左脚 CoP_z 变化合计 ${dCopArch.toFixed(1)}mm`);
  log(`   · arch 目标角能否推动关节：实测角 ${archPlus.wAng.toFixed(2)}°（旋前命令）/ ${archMinus.wAng.toFixed(2)}°（旋后命令）`);
  log(`   · 内外侧柱可分性：基线 内${base.ci.toFixed(0)}/外${base.co.toFixed(0)}N`);
  const sep = (r: typeof base): boolean => Math.min(r.ci, r.co) >= 0 && (r.ci + r.co) > 50;
  check('内/外侧柱都有载荷（不是单边悬空）', sep(base), `${base.ci.toFixed(0)}/${base.co.toFixed(0)}`);
  check('★ 髋外展能推动 CoP_z（侧向发力的主通道）', dCopHip > 3, `${dCopHip.toFixed(1)}mm`);
  check('★ arch 通道真的能驱动关节（目标角 ≠ 实测角即未生效）',
    Math.abs(archPlus.wAng - archMinus.wAng) > 0.5,
    `${archPlus.wAng.toFixed(2)}° vs ${archMinus.wAng.toFixed(2)}°`);
  check('★ arch 旋前旋后能推动 CoP_z（柔性足自己的通道）', dCopArch > 1, `${dCopArch.toFixed(1)}mm`);
}

log('');
log(fails === 0 ? '★ 全绿' : `✗ ${fails} 项未过`);
if (fails > 0) process.exitCode = 1;
