/**
 * 蹲下伺服唯一入口。
 *
 * 架构真源：
 *   docs/蹲下唯一回正PD-架构-2026-10-29.md
 * 写手白名单见第 112 节。
 *
 * 当前只实现：
 *   - 矢状基础力
 *   - FootSensor 接触门控
 *   - hip/0、knee/2 PD
 *   - 接触时的 knee/0、foot/0/1/2 PD
 *   - hip/1、离地关节阻尼
 *
 * 未实现（不得在文档外补）：
 *   - F_support 前馈（部分）
 *   - CoP 控制（部分）
 *   - capacity 限力（部分）
 *   - 运行时力链检查
 */
import { baseState, baseParams } from './baseTable';
import { propose, PRI } from '../proposalBus';
import type { World } from '../world';
import type { ControlModule } from '../control';
import type { CourtState as CS } from '../court';
import { courtStep } from '../court';
import { sampleFootContact, resetFootSensor } from './footContact';
import { captureShankLeg, hipLateralTarget, solveShankIK, solveShankIK2, type ShankLegRef } from './shankIK';
import { estimateActualChain } from './forceChain';
import { measureActualForceChain } from './actualForceChain';
import { solveLateralRighting } from './rightingLateral';
import { planFootForce, tauFromFootForce } from './footRighting';
import { sensePelvis } from './pelvisSense';
import { senseSagittal } from './sagittalSense';
import { resetHipTask2, solveHipTask2 } from './hipTaskPD';

/** 架构 111.3：HipTaskPD 输出给 ShankTaskPD 的支撑接口。 */
export interface SupportCommand {
  side: 'l' | 'r';
  hip0: number;
  knee2: number;
  fSupport: number;
  saturation: boolean;
}

/** 架构 111.3：ShankTaskPD 回传的力链容量接口。 */
export interface ForceChainStatus {
  side: 'l' | 'r';
  contact: boolean;
  utilization: number;
  capacity: number;
  chainError: number;
}

/** 架构 111.5：小腿 IK/回正目标，不包含 hip/knee2 承重。 */
export interface RightingCommand {
  side: 'l' | 'r';
  knee0: number;
  foot0: number;
  foot1: number;
  foot2: number;
}


/** 从 FootSensor 生成支撑请求；只给 HipTaskPD 消费。 */
function buildSupport(q: SideTarget, fc: ReturnType<typeof sampleFootContact>, hip0: number, knee2: number): SupportCommand {
  return {
    side: q === undefined ? 'l' : (fc.side),
    hip0,
    knee2,
    fSupport: fc.contact ? fc.normalError : 0,
    saturation: !fc.contact || Math.abs(fc.normalError) > fc.fzTarget * 0.8,
  };
}

/** 力链容量/利用率；当前用 N 误差归一化，后续替换为 JᵀF。 */
function buildChain(fc: ReturnType<typeof sampleFootContact>): ForceChainStatus {
  return {
    side: fc.side,
    contact: fc.contact,
    utilization: Math.min(1, Math.abs(fc.normalError) / Math.max(1, fc.fzTarget)),
    capacity: fc.contact && fc.copInside ? 1 : 0,
    chainError: fc.normalError,
  };
}

/** 只生成关节角回正目标。小腿/踝/脚不消费 CoP；CoP 只作为 FootSensor 读数保留。 */
function buildRighting(side: 'l' | 'r', q: SideTarget, ik: { knee0: number; foot0: number; foot2: number }): RightingCommand {
  return {
    side,
    knee0: ik.knee0,
    foot0: ik.foot0,
    foot1: q.foot1,
    foot2: ik.foot2,
  };
}

/** 释放姿态目标；脚目标是脚底接触采样值，不是 foot 刚体中心。 */
interface SideTarget {
  hip0: number;
  hip1: number;
  hip2: number;
  knee0: number;
  knee1: number;
  knee2: number;
  foot0: number;
  foot1: number;
  foot2: number;
  footY: number;
  footZ: number;
}

/** 仅保存释放时的姿态目标；不在文档外新增目标。 */
const _target = new WeakMap<CS, { l: SideTarget; r: SideTarget }>();
const _tauPrev = new WeakMap<World, Map<number, number>>();
const _velLp = new WeakMap<World, Map<number, number>>();
const _upperTarget = new WeakMap<CS, Map<number, number>>();
const _legRef = new WeakMap<CS, { l: ShankLegRef; r: ShankLegRef }>();
interface IKCacheEntry { at: number; contact: boolean; H: { x: number; y: number; z: number }; hipTask: ReturnType<typeof solveHipTask2> | null; ik: ReturnType<typeof solveShankIK> }
const _ikCache = new WeakMap<World, Map<'l' | 'r', IKCacheEntry>>();
const _eqCache = new WeakMap<World, Map<'l' | 'r', { hip: number; knee: number; ankle: number }>>();
const _eqQ = new WeakMap<World, Map<'l' | 'r', { hip2: number; knee2: number; foot2: number }>>();
interface FCacheEntry { at: number; fChain: number; fPerp: number; fChainLp: number; fPerpLp: number; feasible: boolean }
const _fcCache = new WeakMap<World, Map<'l' | 'r', FCacheEntry>>();
const _footSeq = new WeakMap<World, Map<'l' | 'r', { at: number; joint: 'hip' | 'knee' | 'ankle' }>>();

const num = (k: string, d: number): number => {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const v = Number(env[k]);
  return Number.isFinite(v) ? v : d;
};
const di = (w: World, n: string, a: number): number => w.body.dofByName(n, a);
const ang = (w: World, n: string, a: number): number => { const i = di(w, n, a); return i >= 0 ? w.body.dofs[i]!.angle : 0; };

function preload(st: CS): boolean { return !st.released && st.t >= st.settle - num('SQC_PRELOAD_T', 0.05); }

function capture(w: World, st: CS): { l: SideTarget; r: SideTarget } {
  let t = _target.get(st);
  if (t) return t;
  const one = (s: 'l' | 'r'): SideTarget => {
    const sensor = sampleFootContact(w, s);
    return {
      hip0: ang(w, `hip_${s}`, 0), hip1: ang(w, `hip_${s}`, 1), hip2: ang(w, `hip_${s}`, 2),
      knee0: ang(w, `knee_${s}`, 0), knee1: ang(w, `knee_${s}`, 1), knee2: ang(w, `knee_${s}`, 2),
      foot0: ang(w, `foot_${s}`, 0), foot1: ang(w, `foot_${s}`, 1), foot2: ang(w, `foot_${s}`, 2),
      footY: sensor.footY, footZ: sensor.footZ,
    };
  };
  t = { l: one('l'), r: one('r') };
  _target.set(st, t);
  _legRef.set(st, { l: captureShankLeg(w, 'l'), r: captureShankLeg(w, 'r') });
  return t;
}

/** 只保留矢状基础力；侧向由 PD/被动层负责。 */
export function squatPairBase(w: World, ctl: ControlModule): void {
  if (baseState() !== 'squat') return;
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_PAIR_OFF ?? '0') === '1') return;
  const useEq = String(env.SQC_BASE_EQ ?? '1') === '1';
  const eqm = useEq ? _eqCache.get(w) : undefined;
  const buf = (ctl.warner as unknown as { squatBaseBuf(): Float64Array | null }).squatBaseBuf();
  if (!buf) return;
  const c = Number(env.SQC_PAIR_C ?? (baseParams() as { pairC?: number }).pairC ?? 0.7);
  for (const d of w.body.dofs) {
    if (d.engineMotor || d.preRing || d.axis !== 2) continue;
    if (!/^(hip|knee|spine|neck|foot)/.test(d.name)) continue;
    let tau = buf[d.dofIndex] ?? 0;
    if (useEq && eqm) {
      const sm = /^hip_/.test(d.name) ? (d.name.endsWith('_l') ? 'l' : 'r') : (d.name.endsWith('_l') ? 'l' : 'r');
      const e = eqm.get(sm);
      if (e && /^hip_/.test(d.name)) tau = e.hip;
      else if (e && /^knee_/.test(d.name)) tau = e.knee;
      else if (/^foot_/.test(d.name)) tau = 0;
    }
    if (Math.abs(tau) > 1e-6) propose({ dof: d.dofIndex, kind: 'pair', pri: PRI.action, c, rad: d.angle, tau, src: 'squat.pairBase' });
  }
}

export function squatResetLimits(w: World): void {
  // 跨局清掉 PD 滤波/速率状态，避免第二次法庭继承上一局的力矩
  // squatFrame 每帧把 hip1/hip2/knee2 的 min/max 改到本局目标附近；
  // 下一局不恢复，就会继承上一局的窄限位 → 接触/承重一开始就顶死、高频翻号。
  w.applyJointLimits('squat');
  _tauPrev.delete(w);
  _velLp.delete(w);
  _latLatch.delete(w);
  resetHipTask2(w);
  _ikCache.delete(w);
  _eqCache.delete(w);
  _eqQ.delete(w);
  _fcCache.delete(w);
  _footSeq.delete(w);
  resetFootSensor(w);
}

/** 侧向回正方向锁存：方向不能每帧翻，切换需连续确认，并保持最短持续时间。 */
interface LatLatch { sign: number; until: number }
const _latLatch = new WeakMap<World, Map<string, LatLatch>>();
/** 侧向回正方向锁存：每个方向至少保持 hold 秒，期间 raw 翻号也不跟着翻。 */
function latchLateral(w: World, key: string, tau: number): number {
  const now = w.clock;
  let m = _latLatch.get(w);
  if (!m) { m = new Map(); _latLatch.set(w, m); }
  let st = m.get(key);
  const hold = Math.max(0, num('SQC_LAT_HOLD', 0.12));
  const minAbs = Math.max(0, num('SQC_LAT_MIN', 0.5));
  const want = Math.sign(tau);
  if (!st) {
    st = { sign: want || 1, until: now + hold };
    m.set(key, st);
  } else if ((want !== 0 && want !== st.sign) && now >= st.until) {
    st.sign = want;
    st.until = now + hold;
  }
  return st.sign * Math.max(Math.abs(tau), minAbs);
}

/** 关节 PD 执行器；只消费 target，不生成新目标。 */
/** 只消费接口目标，不生成文档外目标。 */
function pd(w: World, name: string, axis: number, target: number, kp: number, kd: number, cap: number, src: string, ff = 0): void {
  const i = di(w, name, axis);
  if (i < 0) return;
  const d = w.body.dofs[i]!;
  let vm = _velLp.get(w);
  if (!vm) { vm = new Map(); _velLp.set(w, vm); }
  const vPrev = vm.get(i) ?? d.vel;
  const vLp = vPrev + (d.vel - vPrev) * 0.20;
  vm.set(i, vLp);
  const rawPd0 = -kp * (d.angle - target) - kd * vLp;
  const legJoint = /^squat\.(knee0|foot0|foot2)$/.test(src);
  const dead = Math.abs(legJoint ? num('SQC_LEG_DEAD', 0.5) : num('SQC_PD_DEADBAND', 4));
  const rawPd = Math.abs(rawPd0) < dead ? 0 : rawPd0;
  let m = _tauPrev.get(w);
  if (!m) { m = new Map(); _tauPrev.set(w, m); }
  const prev = m.get(i);
  const slew = Math.abs(num('SQC_TAU_SLEW', 3));
  const pd = prev === undefined ? rawPd : Math.max(prev - slew, Math.min(prev + slew, rawPd));
  m.set(i, pd);
  // 基础力前馈直接加在 PD 之后，不再被 PD slew 延迟
  let tau = Math.max(-cap, Math.min(cap, pd + ff));
  if (src === 'squat.foot0' || src === 'squat.knee0') tau = latchLateral(w, `${src}.${i}`, tau);

  propose({ dof: i, kind: 'ext', pri: PRI.reflex, tau, src, channel: 'support' });
}

/** 上身支撑：基础力前馈 + 释放姿态 PD，只防止上身倒。 */
function upperSupport(w: World, st: CS, baseBuf: Float64Array | null, baseRamp: number): void {
  let m = _upperTarget.get(st);
  if (!m) {
    m = new Map();
    for (const n of ['spine1', 'spine2', 'spine3', 'neck'] as const) {
      for (const ax of [0, 2] as const) {
        const i = di(w, n, ax);
        if (i >= 0) m.set(i, w.body.dofs[i]!.angle);
      }
    }
    _upperTarget.set(st, m);
  }
  for (const [i, target] of m) {
    const d = w.body.dofs[i]!;
    // 上身基础力前馈必须限幅，不能把 neck/2 的几百牛米直接灌进去
    const ffRaw = baseBuf ? (baseBuf[i] ?? 0) * baseRamp : 0;
    const ffCap = num('SQC_UPPER_FF_CAP', 200);
    const ff = Math.max(-ffCap, Math.min(ffCap, ffRaw));
    const kp = num('SQC_UPPER_KP', 150);
    const kd = num('SQC_UPPER_KD', 100);
    pd(w, d.name, d.axis, target, kp, kd, 200, 'squat.upperSupport', ff);
  }
}

function damp(w: World, name: string, axis: number, b: number, src: string): void {
  const i = di(w, name, axis);
  if (i < 0) return;
  const d = w.body.dofs[i]!;
  const cap = Math.abs(num('SQC_DAMP_CAP', 30));
  const tau = Math.max(-cap, Math.min(cap, -b * d.vel));
  if (Math.abs(tau) > 1e-6) propose({ dof: i, kind: 'ext', pri: PRI.servo, tau, src, channel: 'passive' });
}

/** 实际力链低频采样（15Hz）；不直接控制，只提供 F_chain/F_perp。 */
function sampleActualForceChain(w: World, side: 'l' | 'r', fc: ReturnType<typeof sampleFootContact>, now: number, _comVelZ: number): FCacheEntry {
  let m = _fcCache.get(w);
  if (!m) { m = new Map(); _fcCache.set(w, m); }
  const c = m.get(side);
  const hz = Math.max(1, Math.abs(num('SQC_FC_HZ', 15)));
  if (c && now - c.at < 1 / hz) return c;
  if (!fc.contact) { const out = { at: now, fChain: 0, fPerp: 0, fChainLp: 0, fPerpLp: 0, feasible: false }; m.set(side, out); return out; }
  const leg = captureShankLeg(w, side);
  const a = measureActualForceChain(w, side, leg.hip, leg.knee, leg.ankle);
  const est = { fChain: a.fParallel, fPerp: a.fPerp };
  const prevLp = c?.fPerpLp ?? est.fPerp;
  const prevChain = c?.fChainLp ?? est.fChain;
  const dt = Math.max(0, now - (c?.at ?? now));
  const k = 1 - Math.exp(-dt / 0.08);
  const fPerpLp = prevLp + (est.fPerp - prevLp) * k;
  const fChainLp = prevChain + (est.fChain - prevChain) * k;
  const chainMin = Math.abs(num('SQC_FC_CHAIN_MIN', w.sk.massTotal * 9.81 * 0.35));
  const out = {
    at: now, fChain: est.fChain, fPerp: est.fPerp,
    fChainLp, fPerpLp,
    feasible: a.feasible && fChainLp >= chainMin && Number.isFinite(fPerpLp),
  };
  m.set(side, out); return out;
}

interface IKTargetBundle { H: { x: number; y: number; z: number }; hipTask: ReturnType<typeof solveHipTask2> | null; ik: ReturnType<typeof solveShankIK> }
/** IK 目标低频更新：默认 15Hz；接触状态改变时立即重解，其余帧保持。 */
function heldIKTargets(w: World, side: 'l' | 'r', leg: ShankLegRef, hip2Mode: boolean, comZ: number, contact: boolean): IKTargetBundle {
  let m = _ikCache.get(w);
  if (!m) { m = new Map(); _ikCache.set(w, m); }
  const now = w.clock;
  const hz = Math.max(1, Math.abs(num('SQC_IK_HZ', 15)));
  const period = 1 / hz;
  const c = m.get(side);
  if (c && c.contact === contact && now - c.at < period) return { H: c.H, hipTask: c.hipTask, ik: c.ik };
  const hipTask = hip2Mode ? solveHipTask2(w, leg, comZ) : null;
  const H = hipTask ? hipTask.H : hipLateralTarget(w, leg);
  const ik = solveShankIK(w, leg, H);
  m.set(side, { at: now, contact, H, hipTask, ik });
  return { H, hipTask, ik };
}

/** 法庭静置期也把被动层参考设在当前关节角，避免静置期无被动。 */
function armPassiveCurrent(w: World, ctl: ControlModule): void {
  const drv = ctl.warner.drive as unknown as { setPassiveRef(i: number, q: number): void };
  for (const n of ['hip_l', 'hip_r', 'knee_l', 'knee_r', 'foot_l', 'foot_r'] as const) {
    for (const ax of [0, 2] as const) {
      const i = di(w, n, ax);
      if (i >= 0) drv.setPassiveRef(i, w.body.dofs[i]!.angle);
    }
  }
}

export function squatFrame(w: World, ctl: ControlModule, st: CS): void {
  courtStep(w, ctl, st);
  // 法庭已经判死后不再跑蹲下 PD，避免倒地把控制器带成高频抽搐
  if (st.fall >= 0) return;
  const pre = preload(st);
  // 冻结期不跑主动 PD，但被动层必须在场；否则静置期也会无支撑漂移。
  if (!pre && !st.released) {
    if (String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_PASSIVE2 ?? '1') === '1') armPassiveCurrent(w, ctl);
    return;
  }
  const baseBuf = (ctl.warner as unknown as { squatBaseBuf(): Float64Array | null }).squatBaseBuf();
  // 预载窗口内就让基础力就位，释放时不再从 0 ramp
  const baseRamp = (pre || st.released) ? 1 : 0;
  const pairBaseOn = num('SQC_PAIR_BASE', 0) === 1;
  const ff = (name: string, axis: number): number => {
    if (pairBaseOn && /^(hip|knee|foot)_/.test(name)) return 0;
    const i = di(w, name, axis);
    if (!(baseBuf && i >= 0)) return 0;
    let k = num('SQC_BASE_SCALE', 1);
    if (/^hip_/.test(name)) k *= num('SQC_BASE_SCALE_HIP', 0.85);
    else if (/^knee_/.test(name)) k *= num('SQC_BASE_SCALE_KNEE', 0.85);
    else if (/^foot_/.test(name)) k *= num('SQC_BASE_SCALE_FOOT', 1);
    return (baseBuf[i] ?? 0) * baseRamp * k;
  };
  const t = capture(w, st);
  upperSupport(w, st, baseBuf, baseRamp);
  for (const s of ['l', 'r'] as const) {
    const q = t[s];
    const fc = sampleFootContact(w, s);
    const has = fc.contact;
    const leg = _legRef.get(st)![s];
    const hip2Mode = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_HIPTASK2 ?? '1') === '1';
    const held = heldIKTargets(w, s, leg, hip2Mode, ctl.sensors.com[2]!, has);
    const hipTask = held.hipTask;
    const hipTarget = held.H;
    let ik = held.ik;
    const fActual = sampleActualForceChain(w, s, fc, w.clock, ctl.sensors.comVel[2]!);
    let ankleFf = 0;
    const ankleFfOn = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_ANKLE_FF ?? '0') !== '0';
    if (ankleFfOn && has) {
      const cop = new Float64Array(3); const wr = new Float64Array(6);
      w.body.footCoP(s, w.dt, cop); w.body.footContactForce(s, w.dt, wr);
      ankleFf = (cop[0]! - leg.ankle.x) * wr[1]! - (-leg.ankle.y) * wr[0]!;
    }
    let tauHipIK = 0, tauKneeIK = 0;
    const ikTauOn = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_IK_TORQUE ?? '0') === '1';
    if (ikTauOn && has) {
      const cop = new Float64Array(3); const wr = new Float64Array(6);
      w.body.footCoP(s, w.dt, cop); w.body.footContactForce(s, w.dt, wr);
      const Fx = wr[0]!, Fy = wr[1]!;
      const arm = (p: { x: number; y: number }) => (cop[0]! - p.x) * Fy - (-p.y) * Fx;
      tauHipIK = -arm(leg.hip); tauKneeIK = -arm(leg.knee);
    }
    let eqTau: { hip: number; knee: number; ankle: number } | null = null;
    let eqIk: { F: { x: number; y: number }; cop: { x: number; z: number }; tau: { hip: number; knee: number; ankle: number }; feasible: boolean } | null = null;
    let targetKneeIk: { x: number; y: number; z: number } | null = null;
    if (String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_IK2 ?? '1') === '1') {
      const k2i = di(w, `knee_${s}`, 2);
      const tauKnee = k2i >= 0 ? (w.executor.ledger[k2i]?.applied ?? 0) : 0;
      const targetF = w.sk.massTotal * 9.81 * 0.5;
      const sol = solveShankIK2(w, leg, hipTarget, targetF, tauKnee);
      ik = sol.ik; eqTau = sol.equilibrium.tau; eqIk = sol.equilibrium; targetKneeIk = sol.targetKnee;
      let em = _eqCache.get(w); if (!em) { em = new Map(); _eqCache.set(w, em); } em.set(s, eqTau);
      let qm = _eqQ.get(w); if (!qm) { qm = new Map(); _eqQ.set(w, qm); } qm.set(s, { hip2: ik.hip2, knee2: ik.knee2, foot2: ik.foot2 });
    }
    const gIk = globalThis as unknown as { __IK_DBG?: boolean; __IK_STATE?: Record<string, unknown> };
    if (gIk.__IK_DBG) { const o = gIk.__IK_STATE ?? {}; o[s] = { ik, H: hipTarget, hipTask, eqTau, eq: eqIk, targetKnee: targetKneeIk, A: leg.ankle, feasible: fActual.feasible }; gIk.__IK_STATE = o; }
    const gFc = globalThis as unknown as { __FC_DBG?: boolean; __FC_STATE?: Record<string, unknown> };
    if (gFc.__FC_DBG) { const o = gFc.__FC_STATE ?? {}; o[s] = fActual; gFc.__FC_STATE = o; }
    const p2 = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_PASSIVE2 ?? '1') === '1';
    if (p2) {
      const drv = ctl.warner.drive as unknown as { setPassiveRef(i: number, q: number): void };
      const setRef = (n: string, a: number, qv: number): void => { const i = di(w, n, a); if (i >= 0) drv.setPassiveRef(i, qv); };
      setRef(`hip_${s}`, 0, ik.hip0);
      setRef(`foot_${s}`, 0, ik.foot0);
      setRef(`hip_${s}`, 2, ik.hip2);   // 被动参考必须用 IK 目标，不用 hipTask 的支撑偏移
      setRef(`knee_${s}`, 2, ik.knee2);
      setRef(`foot_${s}`, 2, ik.foot2);
    }

    // 实际力链低频回正：只消 F_perp，不改变沿链 F_chain。
    // ★ §164：力链/扰动检测只汇报，不生成回正力。
    const fcHip = 0;
    const fcFoot = 0;
    let fHip = 0, fKnee = 0, fAnkle = 0;
    const footRight = num('SQC_FOOT_RIGHT', 0) === 1;
    if (footRight && has && eqIk) {
      const act = measureActualForceChain(w, s, leg.hip, leg.knee, leg.ankle);
      const hipA = w.body.dofs[di(w, `hip_${s}`, 0)]!.anchorWorld;
      const kneeA = w.body.dofs[di(w, `knee_${s}`, 2)]!.anchorWorld;
      const ankleA = w.body.dofs[di(w, `foot_${s}`, 2)]!.anchorWorld;
      const vHipZ = w.body.bodies[w.body.indexByKey.get('torso')!]!.linvel().z;
      const plan = planFootForce({
        actualF: { x: act.F.x, y: act.F.y },
        targetF: { x: eqIk.F.x, y: eqIk.F.y },
        hipErrZ: (hipTarget.z - hipA[2]!) * num('SQC_FOOT_RIGHT_SIGN', 1),
        hipVelZ: vHipZ * num('SQC_FOOT_RIGHT_SIGN', 1),
        maxLateral: num('SQC_FOOT_RIGHT_CAP', 80),
      });
      const td = tauFromFootForce(
        plan.F, { x: eqIk.cop.x, y: 0 },
        { x: hipA[0]!, y: hipA[1]!, z: hipA[2]! },
        { x: kneeA[0]!, y: kneeA[1]!, z: kneeA[2]! },
        { x: ankleA[0]!, y: ankleA[1]!, z: ankleA[2]! },
      );
      let sm = _footSeq.get(w); if (!sm) { sm = new Map(); _footSeq.set(w, sm); }
      const now = w.clock; const dtFix = Math.max(0.1, num('SQC_FOOT_RIGHT_DT', 0.5));
      let seq = sm.get(s);
      if (!seq || now - seq.at >= dtFix) {
        const mag = [Math.abs(td.hip - act.tau.hip), Math.abs(td.knee - act.tau.knee), Math.abs(td.ankle - act.tau.ankle)];
        const forced = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_FOOT_RIGHT_JOINT ?? '');
        const joint: 'hip' | 'knee' | 'ankle' = forced === 'hip' || forced === 'knee' || forced === 'ankle' ? forced : 'ankle';
        seq = { at: now, joint }; sm.set(s, seq);
      }
      const fs = num('SQC_FOOT_RIGHT_SCALE', 1);
      if (seq.joint === 'hip') fHip = (td.hip - act.tau.hip) * fs;
      if (seq.joint === 'knee') fKnee = (td.knee - act.tau.knee) * fs;
      if (seq.joint === 'ankle') fAnkle = (td.ankle - act.tau.ankle) * fs;
    }
    const eSag = senseSagittal(w).eX;
    const leanHipK = num('SQC_LEAN_HIP_K', -2);
    const leanKneeK = num('SQC_LEAN_KNEE_K', -4);
    const support = buildSupport(q, fc, ik.hip0, ik.knee2);
    const chain = buildChain(fc);
    const sagOnly = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SAG_ONLY ?? '0') === '1';
    const latLock = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_LAT_LOCK ?? '1') === '1';
    let hip0T = latLock ? leg.qHip0 : (hipTask ? hipTask.hip0 : ik.hip0);
    hip0T += num('SQC_CAL_HIP0', 0);
    let foot0T = latLock ? leg.qFoot0 : buildRighting(s, q, ik).foot0;
    foot0T += num('SQC_CAL_FOOT0', 0);
    const latSolve = num('SQC_LAT_SOLVE', 1) === 1 && st.released && (st.t - st.settle) >= num('SQC_LAT_START', 0.3);
    if (latSolve && has && eqIk) {
      const act = measureActualForceChain(w, s, leg.hip, leg.knee, leg.ankle);
      const hipA = w.body.dofs[di(w, `hip_${s}`, 0)]!.anchorWorld;
      const eHipZ = hipTarget.z - hipA[2]!;
      const pelvis = sensePelvis(w);
      const eLat = eHipZ + num('SQC_LAT_ROLL_K', 0) * pelvis.roll - num('SQC_LAT_DAMP', 0.3) * pelvis.vz;
      const lc = solveLateralRighting(
        { hip0: leg.qHip0, foot0: leg.qFoot0 },
        { hip0: hip0T, foot0: foot0T },
        eLat,
        0,
        0.12,
        0.10,
        num('SQC_LAT_HIP_KCOP', 0.5),
        num('SQC_LAT_HIP_KDIST', 0.02),
        num('SQC_LAT_FOOT_KCOP', 0.5),
        num('SQC_LAT_FOOT_KDIST', 0.015),
      );
      if (num('SQC_LAT_HIP', 0) === 1) hip0T += num('SQC_LAT_HIP_SIGN', 1) * lc.dHip0;
      if (num('SQC_LAT_FOOT', 1) === 1) foot0T += num('SQC_LAT_FOOT_SIGN', -1) * lc.dFoot0;
    }
    const latRampT = Math.max(0.01, num('SQC_LAT_RAMP', 0.2));
    const latRamp = st.released ? Math.max(0, Math.min(1, (st.t - st.settle) / latRampT)) : 0;
    if (latLock) {
      pd(w, `hip_${s}`, 0, hip0T, num('SQC_LAT_LOCK_KP', 400) * latRamp, num('SQC_LAT_LOCK_KD', 20), 200, 'squat.hip0');
    } else if (!sagOnly) pd(w, `hip_${s}`, 0, hip0T, num('SQC_HIP0_KP', 1200), num('SQC_HIP0_KD', 20), 80, 'squat.hip0', fcHip);
    const capFactor = chain.contact ? Math.max(0, Math.min(1, 1 - Math.max(0, chain.utilization - 0.8) / 0.2)) : 0;
    const k2Target = chain.capacity > 0 ? support.knee2 + capFactor * Math.max(-0.15, Math.min(0.15, support.fSupport * 0.0004)) : support.knee2;
    const h2 = di(w, `hip_${s}`, 2);
    const k2 = di(w, `knee_${s}`, 2);
    // H* 高度偏差直接补到 hip2：偏离目标髋越高，正向支撑越大。
    const h2nowY = h2 >= 0 ? w.body.dofs[h2]!.anchorWorld[1]! : leg.hip.y;
    const hipHeightGap = hipTarget.y - h2nowY;
    const hip2ErrFf = Math.max(-Math.abs(num('SQC_HIP2_ERR_CAP', 40)), Math.min(Math.abs(num('SQC_HIP2_ERR_CAP', 40)), Math.abs(num('SQC_HIP2_ERR_K', 300)) * hipHeightGap));
    const eKneeSag = ik.knee2 - (k2 >= 0 ? w.body.dofs[k2]!.angle : ik.knee2);
    const hipKneeFf = Math.max(-120, Math.min(120, Math.abs(num('SQC_HIP_KNEE_K', 0)) * eKneeSag));
    const pairOnly = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SAG_PAIR_ONLY ?? '0') === '1';
    const supErr = w.sk.massTotal * 9.81 * 0.5 - fc.fz;
    const supFf = Math.max(-40, Math.min(40, num('SQC_SUP_FF', 0.2) * supErr));
    const hipFf = (ikTauOn ? tauHipIK : ff(`hip_${s}`, 2) + hip2ErrFf) + hipKneeFf + fHip - 0.5 * supFf;
    pd(w, `hip_${s}`, 2, (hipTask ? hipTask.hip2 : ik.hip2) + leanHipK * eSag, num('SQC_SUPPORT_KP', 50), num('SQC_SUPPORT_KD', 2), 80, 'squat.hip2', hipFf);
    const kneeFf = (ikTauOn ? tauKneeIK : ff(`knee_${s}`, 2)) + fKnee + supFf;
    if (!pairOnly) pd(w, `knee_${s}`, 2, k2Target + leanKneeK * eSag, num('SQC_SUPPORT_KP', 50), num('SQC_SUPPORT_KD', 2), 80, 'squat.knee2', kneeFf);
    const right = buildRighting(s, q, ik);
    if (has && latLock) {
      pd(w, `foot_${s}`, 0, foot0T, num('SQC_LAT_FOOT0_KP', 200) * latRamp, 10, 80, 'squat.foot0');
    } else if (has && !sagOnly) {
      pd(w, `knee_${s}`, 0, right.knee0, 300, 12, 40, 'squat.knee0');
      pd(w, `foot_${s}`, 0, foot0T, 60, 4, 40, 'squat.foot0', fcFoot);
      pd(w, `foot_${s}`, 1, right.foot1, 40, 3, 30, 'squat.foot1');
    }
    // 矢状踝是承重链末端：接触短暂丢失时也保持关节角，不允许踝在卸载瞬间完全消失。
    // ★ 实测：-0.0005 会把左脚 CoP 推到 0.13、fz 201/346；关闭后恢复 331/333。
    const foot2FcK = num('SQC_FOOT2_FC_K', 0);
    const fcGate = 1 / (1 + Math.abs(fActual.fPerp) / 40);   // 力链差 → 软降权，不关回正
    const foot2T = right.foot2 + Math.max(-0.08, Math.min(0.08, foot2FcK * fActual.fPerp * fcGate));
    pd(w, `foot_${s}`, 2, foot2T, num('SQC_FOOT2_KP', 600), num('SQC_FOOT2_KD', 12), num('SQC_FOOT2_CAP', 200), 'squat.foot2', ff(`foot_${s}`, 2) + ankleFf + fAnkle);
    // 脚离地时不再写膝/踝 damp；接触丢失后不让阻尼继续制造高频力矩
  }
  if (pairBaseOn) squatPairBase(w, ctl);
}
