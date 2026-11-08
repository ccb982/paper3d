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
import { baseState } from './baseTable';
import { propose, PRI } from '../proposalBus';
import type { World } from '../world';
import type { ControlModule } from '../control';
import type { CourtState as CS } from '../court';
import { courtStep } from '../court';
import { sampleFootContact, resetFootSensor } from './footContact';
import { captureShankLeg, hipLateralTarget, solveShankIK, solveShankIK2, solveShankIKTarget, type ShankLegRef } from './shankIK';
import { measureActualForceChain } from './actualForceChain';
import { sensePelvis } from './pelvisSense';
import { senseSagittal } from './sagittalSense';
import { upperBodyCommand } from './upperBodyCommand';
import { UpperTaskPD } from './upperTaskPD';
import { planSupport } from './supportPlanner';
import { computeSagittalRighting } from './sagittalRighting';
import { computeHipRightingStrategy, type HipRightingStrategyOutput } from './hipRightingStrategy';
import { computeHipHub, computeThighPower, computeShankGuard, computeHipFrontalCouple } from './sagittalCommandLayer';
import { computeSagittalBase } from './sagittalBase';
import { computeFzBudget, resetFzBudget } from './fzBudget';
import { computeHipCommand, type HipCommandOutput } from './hipCommand';
import { gripValidForSide, type HipRightingFrame } from './hipRightingInput';
import { shankLateral } from './shankLateral';
import { scheduleRighting } from './rightingScheduler';
import { resetHipTask2, solveHipTask2 } from './hipTaskPD';
import { HipTaskPD, ShankTaskPD } from './pdGroups';

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
function buildSupport(q: SideTarget, fc: ReturnType<typeof sampleFootContact>, hip0: number, knee2: number, targetFz: number): SupportCommand {
  const err = targetFz - fc.fzFiltered;
  return {
    side: q === undefined ? 'l' : (fc.side),
    hip0,
    knee2,
    fSupport: fc.contact ? err : 0,
    saturation: !fc.contact || Math.abs(err) > Math.max(1, targetFz) * 0.8,
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
const _sym = new WeakMap<CS, { kneeAbs: number; hipAbs: number; ankleAbs: number; hip0BaseL: number; foot0BaseL: number; tiltAbs: number }>();
const _tauPrev = new WeakMap<World, Map<number, number>>();
const _velLp = new WeakMap<World, Map<number, number>>();
const _legRef = new WeakMap<CS, { l: ShankLegRef; r: ShankLegRef }>();
const _pdGroups = new WeakMap<World, { hip: HipTaskPD; shank: ShankTaskPD }>();
const _upperPd = new WeakMap<World, UpperTaskPD>();
const _relaxLp = new WeakMap<CS, Map<'l' | 'r', number>>();
/** 力链模式滞回（上一帧是否 FORCE_CHAIN） */
const _forceModePrev = new WeakMap<World, Map<'l' | 'r', boolean>>();
/** 神经命令淡入淡出（0..1）：力链模式 / 回正模式切换用 */
const _sagFade = new WeakMap<World, Map<'l' | 'r', number>>();
const _hipFade = new WeakMap<World, Map<'l' | 'r', number>>();
const _hubScaleLp = new WeakMap<CS, Map<'l' | 'r', number>>();
const _guardScaleLp = new WeakMap<CS, Map<'l' | 'r', number>>();
const _shankHold = new WeakMap<CS, Partial<Record<'l' | 'r', { knee0: number; foot0: number }>>>();
interface IKCacheEntry { at: number; contact: boolean; H: { x: number; y: number; z: number }; hipTask: ReturnType<typeof solveHipTask2> | null; ik: ReturnType<typeof solveShankIK> }
const _ikCache = new WeakMap<World, Map<'l' | 'r', IKCacheEntry>>();
const _hipHold = new WeakMap<World, Map<'l' | 'r', { x: number; y: number; z: number }>>();
interface FCacheEntry { at: number; fChain: number; fPerp: number; fPerpSag: number; fLat: number; fLatLp: number; fParallel: number; fParallelSigned: number; copZ: number; frictionUtil: number; copInside: boolean; fChainLp: number; fPerpLp: number; feasible: boolean; feasibleRaw: boolean; tauUtil: number }
const _fcCache = new WeakMap<World, Map<'l' | 'r', FCacheEntry>>();
/** 释放瞬间捕获的稳定力链基线（fPerp0/fParallel0），侧向回正只追相对偏差。 */
const _shankChainBase = new WeakMap<CS, Partial<Record<'l' | 'r', { fp: number; par: number; lat: number }>>>();
const _ikBase = new WeakMap<World, Map<'l' | 'r', { hip: number; knee: number; ankle: number }>>();

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
  const refs = { l: captureShankLeg(w, 'l'), r: captureShankLeg(w, 'r') };
  _legRef.set(st, refs);
  _sym.set(st, {
    kneeAbs: (Math.abs(refs.l.knee.z) + Math.abs(refs.r.knee.z)) / 2,
    hipAbs: (Math.abs(refs.l.hip.z) + Math.abs(refs.r.hip.z)) / 2,
    ankleAbs: (Math.abs(refs.l.ankle.z) + Math.abs(refs.r.ankle.z)) / 2,
    hip0BaseL: (refs.l.qHip0 - refs.r.qHip0) / 2,
    foot0BaseL: (-refs.l.qFoot0 + refs.r.qFoot0) / 2,
    tiltAbs: (Math.abs(Math.atan2(refs.l.knee.z - refs.l.ankle.z, Math.max(1e-4, refs.l.knee.y - refs.l.ankle.y)))
      + Math.abs(Math.atan2(refs.r.knee.z - refs.r.ankle.z, Math.max(1e-4, refs.r.knee.y - refs.r.ankle.y)))) / 2,
  });
  return t;
}

export function squatResetLimits(w: World): void {
  // 跨局清掉 PD 滤波/速率状态，避免第二次法庭继承上一局的力矩
  // squatFrame 每帧把 hip1/hip2/knee2 的 min/max 改到本局目标附近；
  // 下一局不恢复，就会继承上一局的窄限位 → 接触/承重一开始就顶死、高频翻号。
  w.applyJointLimits('squat');
  _tauPrev.delete(w);
  _velLp.delete(w);
  _forceModePrev.delete(w);
  _sagFade.delete(w);
  _hipFade.delete(w);
  _hubScaleLp.delete(w as unknown as CS);
  _guardScaleLp.delete(w as unknown as CS);
  _shankHold.delete(w as unknown as CS);
  resetFzBudget(w);
  resetHipTask2(w);
  _ikCache.delete(w);
  _hipHold.delete(w);
  _fcCache.delete(w);
  _ikBase.delete(w);
  resetFootSensor(w);
}

/** 关节 PD 执行器；只消费 target，不生成新目标。 */
/** 只消费接口目标，不生成文档外目标。 */
function pd(w: World, name: string, axis: number, target: number, kp: number, kd: number, cap: number, src: string, ff = 0, pri: number = PRI.reflex, passive = 0, muscleExtra = 0): void {
  const i = di(w, name, axis);
  if (i < 0) return;
  const d = w.body.dofs[i]!;
  let vm = _velLp.get(w);
  if (!vm) { vm = new Map(); _velLp.set(w, vm); }
  const vPrev = vm.get(i) ?? d.vel;
  const vLp = vPrev + (d.vel - vPrev) * Math.max(0, Math.min(1, num('SQC_PD_VEL_LP', 0.2)));
  vm.set(i, vLp);
  const posTerm = kp * (target - d.angle);
  const dampTerm = -kd * vLp;
  const latAxis = axis === 0 && /^(hip|knee|foot)_/.test(name);
  const dampCap = Math.abs(num('SQC_LAT_DAMP_CAP', 15));
  const dampUse = latAxis ? Math.max(-dampCap, Math.min(dampCap, dampTerm)) : dampTerm;
  const rawPd0 = posTerm + dampUse;
  const legJoint = /^squat\.(knee0|foot0|foot2)$/.test(src);
  const dead = Math.abs(legJoint ? num('SQC_LEG_DEAD', 0.5) : num('SQC_PD_DEADBAND', 4));
  const rawPd = Math.abs(rawPd0) < dead ? 0 : rawPd0;
  let m = _tauPrev.get(w);
  if (!m) { m = new Map(); _tauPrev.set(w, m); }
  const prev = m.get(i);
  const slew = Math.abs(src === 'squat.foot0.lat' ? num('SQC_LAT_TAU_SLEW', 30) : num('SQC_TAU_SLEW', 3));
  const pd = prev === undefined ? rawPd : Math.max(prev - slew, Math.min(prev + slew, rawPd));
  m.set(i, pd);
  // 基础力前馈直接加在 PD 之后，不再被 PD slew 延迟
  const tau = Math.max(-cap, Math.min(cap, pd + ff + muscleExtra));
  if (passive !== 0) propose({ dof: i, kind: 'ext', pri: PRI.servo, channel: 'passive', tau: passive, src });

  if (String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SQUAT_DBG ?? '0') === '1') {
    const g = globalThis as unknown as { __PD_TAU?: Record<string, number> };
    const o = g.__PD_TAU ?? {};
    o[`${name}/${axis}`] = rawPd;
    g.__PD_TAU = o;
  }

  if (String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_PD_DBG ?? '0') === '1') {
    const g = globalThis as unknown as { __PD_PARTS?: Record<string, unknown> };
    const o = g.__PD_PARTS ?? {};
    o[`${name}/${axis}`] = { target, angle: d.angle, vel: d.vel, vLp, posTerm, dampTerm, dampUse, rawPd0, dead, rawPd, slew, prev, cap, ff, passive, muscleExtra, tau, legJoint };
    g.__PD_PARTS = o;
  }
  propose({ dof: i, kind: 'ext', pri, tau, src, channel: 'support' });
}

function getUpperPd(w: World): UpperTaskPD {
  let p = _upperPd.get(w);
  if (!p) { p = new UpperTaskPD(); _upperPd.set(w, p); }
  return p;
}

function getPdGroups(w: World): { hip: HipTaskPD; shank: ShankTaskPD } {
  let g = _pdGroups.get(w);
  if (!g) {
    g = { hip: new HipTaskPD(w, pd), shank: new ShankTaskPD(w, pd) };
    _pdGroups.set(w, g);
  }
  return g;
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
  const hz = Math.max(1, Math.abs(num('SQC_FC_HZ', 60)));
  if (c && now - c.at < 1 / hz) return c;
  if (!fc.contact) { const out = { at: now, fChain: 0, fPerp: 0, fPerpSag: 0, fLat: 0, fLatLp: 0, fParallel: 0, fParallelSigned: 0, copZ: 0, frictionUtil: 0, copInside: false, fChainLp: 0, fPerpLp: 0, feasible: false, feasibleRaw: false, tauUtil: 1 }; m.set(side, out); return out; }
  const leg = captureShankLeg(w, side);
  const a = measureActualForceChain(w, side, leg.hip, leg.knee, leg.ankle);
  const est = { fChain: a.fParallel, fPerp: a.fPerp, fLat: a.fLat };
  const prevLp = c?.fPerpLp ?? est.fPerp;
  const prevLat = c?.fLatLp ?? a.fLat;
  const prevChain = c?.fChainLp ?? est.fChain;
  const dt = Math.max(0, now - (c?.at ?? now));
  const fcLp = Math.max(1e-4, Math.abs(num('SQC_FC_LP', 0.04)));
  const k = 1 - Math.exp(-dt / fcLp);
  const fPerpLp = prevLp + (est.fPerp - prevLp) * k;
  const fLatLp = prevLat + (a.fLat - prevLat) * k;
  const fChainLp = prevChain + (est.fChain - prevChain) * k;
  const chainMin = Math.abs(num('SQC_FC_CHAIN_MIN', w.sk.massTotal * 9.81 * 0.35));
  const out = {
    at: now, fChain: est.fChain, fPerp: est.fPerp, fPerpSag: a.fPerpSag, fLat: est.fLat, fLatLp,
    fParallel: est.fChain, fParallelSigned: a.fParallelSigned, copZ: a.cop.z, frictionUtil: a.frictionUtil, copInside: a.copInside,
    fChainLp, fPerpLp, tauUtil: a.tauUtil,
    feasibleRaw: a.feasible,
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
  let hm = _hipHold.get(w);
  if (!hm) { hm = new Map(); _hipHold.set(w, hm); }
  let H = hm.get(side);
  if (!H) {
    H = hipTask ? { x: hipTask.H.x, y: hipTask.H.y, z: hipTask.H.z } : hipLateralTarget(w, leg);
    hm.set(side, H);
  }
  const ik = solveShankIKTarget(w, leg, H);
  m.set(side, { at: now, contact, H, hipTask, ik });
  return { H, hipTask, ik };
}

/** 法庭静置期也把被动层参考设在当前关节角，避免静置期无被动。 */
function armSupportCurrent(w: World, ctl: ControlModule): void {
  const drv = ctl.warner.drive as unknown as { setSupportRef(i: number, q: number): void };
  for (const n of ['hip_l', 'hip_r', 'knee_l', 'knee_r', 'foot_l', 'foot_r'] as const) {
    for (const ax of [0, 2] as const) {
      const i = di(w, n, ax);
      if (i >= 0) drv.setSupportRef(i, w.body.dofs[i]!.angle);
    }
  }
}

interface ShankSel { side: 'l' | 'r' | null; until: number; since: number }
const _shankSel = new WeakMap<CS, ShankSel>();

function shankErrorOf(w: World, s: 'l' | 'r', tiltAbs: number): number {
  const ki = di(w, `knee_${s}`, 2);
  const ai = di(w, `foot_${s}`, 2);
  if (ki < 0 || ai < 0) return 0;
  const kA = w.body.dofs[ki]!.anchorWorld;
  const aA = w.body.dofs[ai]!.anchorWorld;
  const tiltW = Math.atan2(kA[2]! - aA[2]!, Math.max(1e-4, kA[1]! - aA[1]!));
  const tiltL = (s === 'l' ? 1 : -1) * tiltW;
  return Math.abs(tiltAbs - tiltL);
}

function shankForceErrorOf(w: World, s: 'l' | 'r'): number {
  const ctl = (w as unknown as { controller?: { sensors?: { comVel?: Float64Array } } }).controller;
  const comVz = ctl?.sensors?.comVel?.[2] ?? 0;
  const fc = sampleFootContact(w, s);
  const f = sampleActualForceChain(w, s, fc, w.clock, comVz);
  // 侧向选择不能只看总 fPerp：左腿 fLat=124、右腿 fLat=9 时，
  // 总 fPerp 会被矢状分量主导而选错腿。给侧向分量单独权重。
  const lateral = Math.abs(f.fLatLp) * Math.abs(num('SQC_SHANK_SELECT_FLAT', 0.05));
  return Math.abs(f.fPerpLp) * Math.abs(num('SQC_SHANK_FORCE_ACT', 0.002)) + lateral;
}

function pickShankSide(w: World, st: CS): 'l' | 'r' | null {
  if (String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SHANK_SELECT ?? '1') !== '1') return null;
  const sym = _sym.get(st);
  if (!sym) return null;
  const fcL = sampleFootContact(w, 'l');
  const fcR = sampleFootContact(w, 'r');
  const loadMin = Math.abs(num('SQC_SHANK_SELECT_FZ', 0.15)) * w.sk.massTotal * 9.81;
  const frictionMax = Math.abs(num('SQC_SHANK_FRICTION_MAX', 0.8));
  const cL = fcL.contact && fcL.fz >= loadMin && w.perception.feet[0]!.frictionUse <= frictionMax && fcL.copInside;
  const cR = fcR.contact && fcR.fz >= loadMin && w.perception.feet[1]!.frictionUse <= frictionMax && fcR.copInside;
  const eL = cL ? shankErrorOf(w, 'l', sym.tiltAbs) + shankForceErrorOf(w, 'l') : -1;
  const eR = cR ? shankErrorOf(w, 'r', sym.tiltAbs) + shankForceErrorOf(w, 'r') : -1;
  if (cL !== cR) {
    const forced = cL ? 'l' : 'r';
    let sel = _shankSel.get(st);
    if (!sel) { sel = { side: null, until: 0, since: 0 }; _shankSel.set(st, sel); }
    if (sel.side !== forced) { sel.side = forced; sel.since = w.clock; }
    sel.until = w.clock + Math.max(0, num('SQC_SHANK_SELECT_HOLD', 0.2));
    return forced;
  }
  const now = w.clock;
  const hold = Math.max(0, num('SQC_SHANK_SELECT_HOLD', 0.2));
  const start = Math.max(0, num('SQC_SHANK_SELECT_START', 0.01));
  const release = Math.max(0, num('SQC_SHANK_SELECT_RELEASE', 0.005));
  const margin = Math.max(0, num('SQC_SHANK_SELECT_MARGIN', 0.005));
  let sel = _shankSel.get(st);
  if (!sel) { sel = { side: null, until: 0, since: 0 }; _shankSel.set(st, sel); }
  if (!sel.side) {
    if (Math.max(eL, eR) < start) return null;
    sel.side = eL >= eR ? 'l' : 'r';
    sel.until = now + hold;
    sel.since = now;
    return sel.side;
  }
  const cur = sel.side === 'l' ? eL : eR;
  const other = sel.side === 'l' ? eR : eL;
  const maxOn = Math.max(0, num('SQC_SHANK_SELECT_MAXON', 0.5));
  const swap = (): void => { sel!.side = sel!.side === 'l' ? 'r' : 'l'; sel!.until = now + hold; sel!.since = now; };
  if (cur < 0) { if (other >= start) swap(); else sel.side = null; }
  else if (now >= sel.until && other > cur + margin) swap();
  else if (cur < release && other > start) swap();
  else if (maxOn > 0 && now - sel.since >= maxOn && other >= start) swap();
  return sel.side;
}

function applyResistance(w: World): void {
  if (String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_RESIST_IN_PD ?? '0') !== '1') return;
  const drv = w.drive as unknown as { supportTorque(i: number): number };
  for (const side of ['l', 'r'] as const) {
    for (const [n, ax] of [[`hip_${side}`, 0], [`foot_${side}`, 0], [`knee_${side}`, 2], [`foot_${side}`, 2]] as Array<[string, number]>) {
      const i = di(w, n, ax);
      if (i < 0) continue;
      const tau = drv.supportTorque(i);
      if (tau !== 0) propose({ dof: i, kind: 'ext', pri: PRI.servo, channel: 'passive', tau, src: 'squat.resist' });
    }
  }
}

function pickMostSevereShankSide(
  w: World, fcL: ReturnType<typeof sampleFootContact>, fcR: ReturnType<typeof sampleFootContact>, comVz: number,
): 'l' | 'r' | null {
  if (String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SHANK_MOST_SEVERE ?? '1') === '0') return null;
  const fL = sampleActualForceChain(w, 'l', fcL, w.clock, comVz);
  const fR = sampleActualForceChain(w, 'r', fcR, w.clock, comVz);
  const ok = (fc: typeof fcL, _f: typeof fL): boolean => fc.contact;
  const eL = ok(fcL, fL) ? Math.abs(fL.fLat) : -1;
  const eR = ok(fcR, fR) ? Math.abs(fR.fLat) : -1;
  const min = Math.abs(num('SQC_SHANK_SEVERE_MIN', 5));
  if (Math.max(eL, eR) < min) return null;
  const margin = Math.abs(num('SQC_SHANK_SEVERE_MARGIN', 1));
  if (eL > eR + margin) return 'l';
  if (eR > eL + margin) return 'r';
  return null;
}

export function squatFrame(w: World, ctl: ControlModule, st: CS): void {
  courtStep(w, ctl, st);
  // 法庭已经判死后不再跑蹲下 PD，避免倒地把控制器带成高频抽搐
  if (st.fall >= 0) return;
  const pre = preload(st);
  // 冻结期不跑主动 PD，但被动层必须在场；否则静置期也会无支撑漂移。
  if (!pre && !st.released) {
    if (String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_PASSIVE2 ?? '1') === '1') armSupportCurrent(w, ctl);
      return;
  }
  const baseBuf = (ctl.warner as unknown as { squatBaseBuf(): Float64Array | null }).squatBaseBuf();
  const pdg = getPdGroups(w);
  // 预载窗口内就让基础力就位，释放时不再从 0 ramp
  const baseRamp = (pre || st.released) ? 1 : 0;
  // 非矢状轴仍保留原基础表；矢状轴由 side 循环里的 baseSag 统一给。
  const ff = (name: string, axis: number): number => {
    const i = di(w, name, axis);
    if (!(baseBuf && i >= 0)) return 0;
    let k = num('SQC_BASE_SCALE', 1);
    if (/^hip_/.test(name)) k *= num('SQC_BASE_SCALE_HIP', 0.85);
    else if (/^knee_/.test(name)) k *= num('SQC_BASE_SCALE_KNEE', 0.85);
    else if (/^foot_/.test(name)) k *= num('SQC_BASE_SCALE_FOOT', 1);
    return (baseBuf[i] ?? 0) * baseRamp * k;
  };
  const t = capture(w, st);
  let shankSelSide = pickShankSide(w, st);
  // 足底检测单一来源：接触/fz/CoP 全部走 sampleFootContact（每帧缓存）；
  // 摩擦利用率仍来自 perception（它测的是切向力/摩擦锥，不是接触检测）。
  const fcS = { l: sampleFootContact(w, 'l'), r: sampleFootContact(w, 'r') };
  const comZ = ctl.sensors.com[2]!;
  const severeSide = pickMostSevereShankSide(w, fcS.l, fcS.r, ctl.sensors.comVel[2]!);
  if (severeSide) shankSelSide = severeSide;
  const pelvisSense = sensePelvis(w);
  const hipFrame: HipRightingFrame = {
    comX: ctl.sensors.com[0]!, comY: ctl.sensors.com[1]!, comZ,
    comVX: ctl.sensors.comVel[0]!, comVZ: ctl.sensors.comVel[2]!,
    comTargetX: ctl.warner.getComTarget().x, comTargetZ: ctl.warner.getComTarget().z,
    // 策略层用滤波后的 fz/CoP（raw 留给支持层做快误差）
    fzL: fcS.l.fzFiltered, fzR: fcS.r.fzFiltered,
    copZL: fcS.l.copValid ? fcS.l.copZFiltered : comZ,
    copZR: fcS.r.copValid ? fcS.r.copZFiltered : comZ,
    copValidL: fcS.l.copValid, copValidR: fcS.r.copValid,
    contactL: fcS.l.contact, contactR: fcS.r.contact,
    frictionL: ctl.perception.feet[0]!.frictionUse, frictionR: ctl.perception.feet[1]!.frictionUse,
    roll: pelvisSense.roll,
    sagRel: senseSagittal(w).eX,
  };
  (globalThis as { __HIP_FRAME?: HipRightingFrame }).__HIP_FRAME = hipFrame;
  // Fz 预算唯一来源：支撑、legFf、knee 支撑都读同一组左右目标（架构 §11.6/§13）
  const fzBudget = computeFzBudget(w, {
    fzTotal: hipFrame.fzL + hipFrame.fzR,
    fzNominal: w.sk.massTotal * 9.81,
    comZ: hipFrame.comZ, comVZ: hipFrame.comVZ,
    comTargetZ: hipFrame.comTargetZ, comY: hipFrame.comY,
    // 几何用脚体中心，不用 CoP（CoP 是控制输出，用它会造成代数环）
    zL: fcS.l.footZ,
    zR: fcS.r.footZ,
    contactL: fcS.l.contact, contactR: fcS.r.contact,
    copValidL: fcS.l.copValid, copValidR: fcS.r.copValid,
    dt: w.dt,
  });
  (globalThis as { __FZ_BUDGET?: typeof fzBudget }).__FZ_BUDGET = fzBudget;
  const frictionMax = Math.abs(num('SQC_SHANK_FRICTION_MAX', 0.8));
  const latErr = shankSelSide && _sym.get(st) ? Math.max(shankErrorOf(w, shankSelSide, _sym.get(st)!.tiltAbs), shankForceErrorOf(w, shankSelSide)) : 0;
  // 侧向就绪 = 抓地/力链可用；不满足时调度器不进入侧向 / 退回矢状。
  // 命令层不再用 `|| !lateralGrip` 自行兜底（架构 §12：同一帧只有一个 mode）。
  const lateralReady = shankSelSide ? gripValidForSide(hipFrame, shankSelSide, frictionMax) : true;
  const sched = scheduleRighting(st, { active: pre || st.released, now: w.clock, lateralSide: shankSelSide, lateralError: latErr, lateralReady, lateralUrgent: !!severeSide });
  (globalThis as { __SQC_MODE?: string; __SQC_MODE_T?: number }).__SQC_MODE = sched.mode;
  (globalThis as { __SQC_MODE?: string; __SQC_MODE_T?: number }).__SQC_MODE_T = w.clock;
  let p2Soft = 0;
  for (const n of ['spine1', 'spine2', 'spine3', 'neck'] as const) {
    ctl.manual.clearAngle(n, 2);
    ctl.manual.pin(n, 2, true);
  }
  getUpperPd(w).step(w, upperBodyCommand(w, st));
  for (const s of ['l', 'r'] as const) {
    const q = t[s];
    const fc = fcS[s];
    const has = fc.contact;
    const leg = _legRef.get(st)![s];
    const hip2Mode = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_HIPTASK2 ?? '1') === '1';
    const held = heldIKTargets(w, s, leg, hip2Mode, ctl.sensors.com[2]!, has);
    const hipTask = held.hipTask;
    const hipTarget = held.H;
    let ik = held.ik;
    const fActual = sampleActualForceChain(w, s, fc, w.clock, ctl.sensors.comVel[2]!);
    let cb = _shankChainBase.get(st);
    if (!cb) { cb = {}; _shankChainBase.set(st, cb); }
    if (st.released && st.t >= st.settle + 0.05 && fc.contact && fActual.at >= st.settle && fActual.fParallel > 0 && !cb[s]) {
      cb[s] = { fp: fActual.fPerpLp, par: fActual.fParallel, lat: fActual.fLatLp };
    }
    const chainBase = cb[s];
    let eqTau: { hip: number; knee: number; ankle: number } | null = null;
    let eqIk: { F: { x: number; y: number }; cop: { x: number; z: number }; tau: { hip: number; knee: number; ankle: number }; feasible: boolean } | null = null;
    let targetKneeIk: { x: number; y: number; z: number } | null = null;
    if (String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_IK2 ?? '1') === '1') {
      const k2i = di(w, `knee_${s}`, 2);
      const tauKnee = k2i >= 0 ? (w.executor.ledger[k2i]?.applied ?? 0) : 0;
      const targetF = w.sk.massTotal * 9.81 * 0.5;
      const sol = solveShankIK2(w, leg, hipTarget, targetF, tauKnee, { x: leg.knee.x - leg.ankle.x, y: leg.knee.y - leg.ankle.y, z: leg.knee.z - leg.ankle.z });
      ik = sol.ik; eqTau = sol.equilibrium.tau; eqIk = sol.equilibrium; targetKneeIk = sol.targetKnee;
      let ib = _ikBase.get(w); if (!ib) { ib = new Map(); _ikBase.set(w, ib); } ib.set(s, eqTau);
    }
    const gIk = globalThis as unknown as { __IK_DBG?: boolean; __IK_STATE?: Record<string, unknown> };
    if (gIk.__IK_DBG) { const o = gIk.__IK_STATE ?? {}; o[s] = { ik, H: hipTarget, hipTask, eqTau, eq: eqIk, targetKnee: targetKneeIk, A: leg.ankle, feasible: fActual.feasible }; gIk.__IK_STATE = o; }
    const gFc = globalThis as unknown as { __FC_DBG?: boolean; __FC_STATE?: Record<string, unknown> };
    if (gFc.__FC_DBG) { const o = gFc.__FC_STATE ?? {}; o[s] = fActual; gFc.__FC_STATE = o; }
    const p2 = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_PASSIVE2 ?? '1') === '1';
    if (p2) {
      const drv = ctl.warner.drive as unknown as { setSupportRef(i: number, q: number): void };
      const setRef = (n: string, a: number, qv: number): void => { const i = di(w, n, a); if (i >= 0) drv.setSupportRef(i, qv); };
      setRef(`hip_${s}`, 0, ik.hip0);
      setRef(`foot_${s}`, 0, ik.foot0);
      setRef(`hip_${s}`, 2, ik.hip2);   // 被动参考必须用 IK 目标，不用 hipTask 的支撑偏移
      setRef(`knee_${s}`, 2, ik.knee2);
      setRef(`foot_${s}`, 2, ik.foot2);
    }

    // 实际力链低频回正：只消 F_perp，不改变沿链 F_chain。
    // ★ §164：力链/扰动检测只汇报，不生成回正力。
    const fcFoot = 0;
    const fzTarget = s === 'l' ? fzBudget.fzLTarget : fzBudget.fzRTarget;
    const support = buildSupport(q, fc, ik.hip0, ik.knee2, fzTarget);
    const chain = buildChain(fc);
    const right = buildRighting(s, q, ik);
    const hip0T = ik.hip0;
    const foot0T = right.foot0;
    const knee0Hold = t[s].knee0;
    const shankPlan = { knee0: knee0Hold, foot0: foot0T, foot1: right.foot1 };
    const hipA = w.body.dofs[di(w, `hip_${s}`, 0)]!.anchorWorld;
    const h1i = di(w, `hip_${s}`, 1);
    const hip1Base = h1i >= 0 ? w.body.dofs[h1i]!.angle : 0;
    const selectOff = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SHANK_SELECT ?? '1') !== '1';
    const grip = gripValidForSide(hipFrame, s, frictionMax);
    const k0i = di(w, `knee_${s}`, 0);
    const k0d = k0i >= 0 ? w.body.dofs[k0i]! : null;
    const f0i = di(w, `foot_${s}`, 0);
    const f0d = f0i >= 0 ? w.body.dofs[f0i]! : null;
    // 侧向回正只在调度器授权的侧向模式运行（架构 §12.2）
    const lateralActiveNow = !selectOff && grip && sched.lateralSide === s;
    const lateral = shankLateral(st, {
      side: s,
      active: lateralActiveNow,
      grip,
      dt: w.dt,
      fadeHz: num('SQC_SHANK_FADE_HZ', 10),
      ikKnee0: ik.knee0,
      ikFoot0: ik.foot0,
      actualKnee0: k0d?.angle ?? 0,
      actualKnee0Vel: k0d?.vel ?? 0,
      foot0Min: f0d?.min ?? -Math.PI,
      foot0Max: f0d?.max ?? Math.PI,
      fParallel: fActual.fParallel,
      fPerp: fActual.fPerpLp,
      fLat: fActual.fLatLp,
      fLatRaw: fActual.fLat,
      fPerp0: chainBase?.fp ?? fActual.fPerpLp,
      fParallel0: chainBase?.par ?? fActual.fParallel,
      fLat0: chainBase?.lat ?? fActual.fLatLp,
      feasible: fActual.feasibleRaw,
      copInside: fActual.copInside,
      tauUtil: fActual.tauUtil,
      frictionUse: ctl.perception.feet[s === 'l' ? 0 : 1]!.frictionUse,
      frictionMax,
    });
    const lateralFoot0 = lateral.foot0Target;

    const lateralKneeFf = lateral.knee0Ff;
    shankPlan.knee0 = lateral.knee0Target;
    // 单侧回正 + 对侧 shank hold：active 侧才追 lateral，support 侧锁在进入支撑时的膝/踝角。
    let holdMap = _shankHold.get(st);
    if (!holdMap) { holdMap = {}; _shankHold.set(st, holdMap); }
    const isLateralActive = sched.lateralSide === s;
    let hold = holdMap[s];
    if (isLateralActive) {
      if (hold) { holdMap[s] = undefined; hold = undefined; }
    } else if (!hold) {
      hold = { knee0: k0d?.angle ?? 0, foot0: f0d?.angle ?? 0 };
      holdMap[s] = hold;
    }
    const knee0Cmd = !isLateralActive && hold ? hold.knee0 : shankPlan.knee0;
    const foot0Cmd = !isLateralActive && hold ? hold.foot0 : lateralFoot0;
    {
      const gh = globalThis as unknown as { __SQC_SHANK_HUD?: Record<string, unknown> };
      const oh = gh.__SQC_SHANK_HUD ?? {};
      oh[s] = { align: lateral.align ? 1 : 0, eLat: lateral.eLat, soft: lateral.soft, targetDeg: lateral.foot0Target * 57.2958, actualDeg: (f0d?.angle ?? 0) * 57.2958, active: lateral.active ? 1 : 0, fade: lateral.fade, chainOk: lateral.chainOk ? 1 : 0 };
      gh.__SQC_SHANK_HUD = oh;
    }
    if (String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SQUAT_DBG ?? '0') === '1') {
      const gd = globalThis as unknown as { __SQC_SHANK_DBG?: Record<string, unknown> };
      const od = gd.__SQC_SHANK_DBG ?? {};
      od[s] = { fade: lateral.fade, soft: lateral.soft, fPerp: lateral.fPerp, fPerpRaw: fActual.fPerp, fPerpSag: fActual.fPerpSag, fParallel: lateral.fParallel, fParallelSigned: fActual.fParallelSigned, fLat: lateral.fLat, fLatRaw: fActual.fLat, fLat0: lateral.fLat0, ePerp: lateral.ePerp, eLat: lateral.eLat, eLatRate: lateral.eLatRate, eLatRawRate: lateral.eLatRawRate, chainOk: lateral.chainOk ? 1 : 0, feasible: fActual.feasible ? 1 : 0, raw: fActual.feasibleRaw ? 1 : 0, copIn: fActual.copInside ? 1 : 0, tauU: fActual.tauUtil, fric: ctl.perception.feet[s === 'l' ? 0 : 1]!.frictionUse, fMax: frictionMax, knee0T: knee0Cmd, foot0T: foot0Cmd, knee0Ff: lateral.knee0Ff, chainOpen: lateral.chainOpen, align: lateral.align };
      gd.__SQC_SHANK_DBG = od;
    }
    const supPlan = planSupport({
      knee2Base: support.knee2, fSupport: support.fSupport, capacity: chain.capacity,
      contact: chain.contact, fz: fc.fzFiltered, targetFz: fzTarget,
      supK: num('SQC_SUP_FF', 0.2), supCap: 40,
    });
    const k2Target = supPlan.knee2Target;
    const h2 = di(w, `hip_${s}`, 2);
    const k2 = di(w, `knee_${s}`, 2);
    // H* 高度偏差直接补到 hip2：偏离目标髋越高，正向支撑越大。
    const h2nowY = h2 >= 0 ? w.body.dofs[h2]!.anchorWorld[1]! : leg.hip.y;
    const hip2Base = ik.hip2;
    const hipHigh = Math.max(0, h2nowY - hipTarget.y);
    const hipLow = Math.max(0, hipTarget.y - h2nowY);
    const relaxRaw = Math.max(0, Math.min(1, hipHigh / 0.05));
    let rm = _relaxLp.get(st);
    if (!rm) { rm = new Map(); _relaxLp.set(st, rm); }
    const rPrev = rm.get(s);
    const rA = 1 - Math.exp(-Math.max(0, w.dt) * 2 * Math.PI * Math.max(1, num('SQC_HIP_RELAX_LP_HZ', 8)));
    const relax = rPrev === undefined ? relaxRaw : rPrev + (relaxRaw - rPrev) * rA;
    rm.set(s, relax);
    const sideData = {
      hipHeight: h2nowY, hipTargetY: hipTarget.y,
      hipQ: [leg.qHip0, w.body.dofs[di(w, `hip_${s}`, 1)]?.angle ?? 0, leg.qHip2] as [number, number, number],
      hipV: [
        w.body.dofs[di(w, `hip_${s}`, 0)]?.vel ?? 0,
        w.body.dofs[di(w, `hip_${s}`, 1)]?.vel ?? 0,
        w.body.dofs[di(w, `hip_${s}`, 2)]?.vel ?? 0,
      ] as [number, number, number],
      fParallel: fActual.fParallel, fParallelSigned: fActual.fParallelSigned, fPerp: fActual.fPerp, fPerpSag: fActual.fPerpSag, fLat: fActual.fLat, knee0: w.body.dofs[di(w, `knee_${s}`, 0)]?.angle ?? 0, chainFeasible: fActual.feasible,
      hipZErr: hipTarget.z - hipA[2]!,
    };
    if (s === 'l') hipFrame.left = sideData; else hipFrame.right = sideData;
    // 职责分离（架构 §12）：矢状 / 侧向由调度器轮流授权，命令层不自激活。
    const sagOn = sched.sagittalOn;
    const hipOn = sagOn;
    // 力链模式滞回：上一帧状态进策略（文档 §10.4：必须滞回，不能每帧切）
    let fm = _forceModePrev.get(w);
    if (!fm) { fm = new Map(); _forceModePrev.set(w, fm); }
    const prevForceMode = fm.get(s) ?? false;
    const hipStrategy: HipRightingStrategyOutput = computeHipRightingStrategy(hipFrame, s, {
      loadHipK: num('SQC_HIP_LOAD_K', 0.1),
      latHipK: num('SQC_HIP_LAT_K', 0.05),
      loadFfK: num('SQC_HIP_LOAD_FF', 10),
      latFfK: num('SQC_HIP_LAT_FF', 5),
      legFfK: num('SQC_HIP_LEG_FF', 0.1),
      legFfCap: num('SQC_HIP_LEG_FF_CAP', 25),
      loadOn: num('SQC_HIP_LOAD_ON', 0.35),
      sagOn: num('SQC_HIP_SAG_ON', 0.04),
      chainOn: num('SQC_HIP_CHAIN_ON', 120),
      hipCap: num('SQC_HIP0_ROLL_CAP', 0.08),
      ffCap: num('SQC_HIP_INPUT_FF_CAP', 25),
      sagHipK: num('SQC_SAG_HIP_K', 2),
      sagHipD: num('SQC_SAG_HIP_D', 0.2),
      sagHipCap: num('SQC_SAG_HIP_CAP', 0.12),
      hipZK: num('SQC_HIP_Z_K', 0.2),
      roll0K: num('SQC_HIP_ROLL0_K', 0.2),
      roll1K: num('SQC_HIP_ROLL1_K', 0.2),
      hip1Cap: num('SQC_HIP1_ROLL_CAP', 0.06),
      prevForceMode,
      modeExitRatio: num('SQC_HIP_MODE_EXIT_RATIO', 0.6),
      fzTargetL: fzBudget.fzLTarget,
      fzTargetR: fzBudget.fzRTarget,
      hipForceK: num('SQC_HIP_FORCE_K', 0.15),
      hipForceCap: num('SQC_HIP_FORCE_CAP', 40),
      valgusK0: num('SQC_HIP_VALGUS_K0', 0.5),
      valgusCap0: num('SQC_HIP_VALGUS_CAP0', 0.08),
      valgusK1: num('SQC_HIP_VALGUS_K1', 0.5),
      valgusCap1: num('SQC_HIP_VALGUS_CAP1', 0.06),
      valgusForceK: num('SQC_HIP_VALGUS_FORCE_K', 1),
    });
    fm.set(s, hipStrategy.forceMode);
    // 双大腿额状力偶：主动 hip0 成对 ff，不改目标、不改 base/踝。
    const valgusCommon = ((hipFrame.left?.knee0 ?? 0) - (hipFrame.right?.knee0 ?? 0)) / 2;
    const frontalCouple = computeHipFrontalCouple({
      pelvisRoll: pelvisSense.roll,
      valgusCommon,
      loadDiff: hipStrategy.loadDiff,
      contact: fc.contact,
      enabled: String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_HIP_COUPLE ?? '1') !== '0',
      kValgus: num('SQC_HIP_COUPLE_VALGUS_K', 8),
      kRoll: num('SQC_HIP_COUPLE_ROLL_K', 80),
      kLoad: num('SQC_HIP_COUPLE_LOAD_K', 0.02),
      cap: num('SQC_HIP_COUPLE_CAP', 60),
      sign: num('SQC_HIP_COUPLE_SIGN', 1),
    });
    // 神经命令淡入淡出（架构 §3：fade/ramp）；力链模式切换不跳变
    const fadeTc = Math.max(0, num('SQC_SAG_FADE_TC', 0.08));
    const fadeA = fadeTc > 0 ? 1 - Math.exp(-Math.max(0, w.dt) / fadeTc) : 1;
    let sf = _sagFade.get(w);
    if (!sf) { sf = new Map(); _sagFade.set(w, sf); }
    const sagFadeTarget = (sagOn && !hipStrategy.forceMode) ? 1 : 0;
    const sagFadePrev = sf.get(s) ?? 0;
    const sagFade = sagFadePrev + (sagFadeTarget - sagFadePrev) * fadeA;
    sf.set(s, sagFade);
    let hfade = _hipFade.get(w);
    if (!hfade) { hfade = new Map(); _hipFade.set(w, hfade); }
    const hipFadeTarget = hipOn ? 1 : 0;
    const hipFadePrev = hfade.get(s) ?? 0;
    const hipFade = hipFadePrev + (hipFadeTarget - hipFadePrev) * fadeA;
    hfade.set(s, hipFade);
    (globalThis as { __HIP_INPUTS?: typeof hipStrategy.errors }).__HIP_INPUTS = hipStrategy.errors;
    (globalThis as { __HIP_STRATEGY?: HipRightingStrategyOutput }).__HIP_STRATEGY = hipStrategy;
    // 任务①（力链）：默认关，A/B 用 SQC_HIP_FORCE_ON=1。
    // 开启后 hip0 的角度项只保留 posture（load/com 不再走角度通路），
    // 负载差走 forceFf 成对前馈。
    const sag16 = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SAG16 ?? '1') !== '0';
    const hipForceOn = num('SQC_HIP_FORCE_ON', 0) === 1;
    const hipForceSign = num('SQC_HIP_FORCE_SIGN', 1) >= 0 ? 1 : -1;
    const hipForceFf = hipForceOn ? hipForceSign * hipStrategy.forceFf : 0;
    // 默认保留 load/com 角度项，方便 A/B 隔离；SQC_HIP_FORCE_ANGLE_KEEP=0 时只留 posture。
    const hipForceAngleKeep = num('SQC_HIP_FORCE_ANGLE_KEEP', 1) === 1;
    // §16：新矢状层只接管 hip2 的矢状力；hip0/hip1 的侧向/roll 回正保留
    // （之前把 hip0/hip1 也清零，直接导致侧向扰动回正力极弱）。
    const hipStrategyUse = sag16
      ? { ...hipStrategy, hip2Delta: 0, hipFf: 0 }
      : ((hipForceOn && !hipForceAngleKeep)
        ? { ...hipStrategy, hip0Delta: hipStrategy.postureHip0 }
        : hipStrategy);
    const baseSag = computeSagittalBase({
      ik: _ikBase.get(w)?.get(s),
      hip2Base, foot2Base: right.foot2, hip0Base: hip0T, hip1Base,
      knee2Base: k2Target, hipLow, hipHigh, hipTargetY: hipTarget.y, hipAnchorY: h2nowY,
      relax, baseGateK: num('SQC_BASE_HIP_GATE', 0.8), kneeFlexK: num('SQC_KNEE_HIP_FLEX', 0.12),
      heightK: num('SQC_HIP2_ERR_K', 300), heightCap: num('SQC_HIP2_ERR_CAP', 40),
    });
    // 矢状误差单一来源：默认 target 相对（comTarget − com）；baseline 相对保留为 A/B
    const eSagSrc = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SAG_ERR_SRC ?? 'target');
    const sagRight = computeSagittalRighting({
      eSag: eSagSrc === 'baseline' ? hipStrategy.sagRel : hipStrategy.errors.eSag,
      leanKneeK: num('SQC_LEAN_KNEE_K', -4),
      enabled: sagOn && !sag16,
    });
    const thigh = computeThighPower({
      eSag: hipStrategy.errors.eSag,
      eSagV: hipStrategy.errors.eSagV,
      contact: fc.contact,
      enabled: sag16,
      kSag: num('SQC_THIGH_SAG_K', 1800),
      dSag: num('SQC_THIGH_SAG_D', 260),
      forceCap: num('SQC_THIGH_FORCE_CAP', 320),
      lever: num('SQC_THIGH_LEVER', 0.28),
      torqueCap: num('SQC_THIGH_TORQUE_CAP', 100),
    });
    const pairOnly = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SAG_PAIR_ONLY ?? '0') === '1';
    const supFf = supPlan.supFf;
    p2Soft = Math.max(p2Soft, baseSag.relax);
    const hipBase = baseSag.hip;
    // 髋高支撑力（神经层力命令）。− supFf·K 是已知跨关节耦合，待判决（架构 §11.6）。
    const heightFf = baseSag.hipFf - num('SQC_HIP_HEIGHT_FF_SUP', 0.5) * supFf;
    // 负值代表向下基础力，不能被 hipHigh 门控削掉。
    const baseGated = hipBase >= 0 ? hipBase * baseSag.baseGate : hipBase;
    const rightStrength = Math.max(0, num('SQC_RIGHT_STRENGTH', 2.0));
    const hip2Target = baseSag.hip2Target + (hipOn && !sag16 ? sagFade * hipStrategy.hip2Delta : 0);
    const hipCmd: HipCommandOutput = computeHipCommand({
      baseHip0Target: baseSag.hip0Target,
      baseHip1Target: baseSag.hip1Target,
      baseGatedFf: baseGated,
      heightFf,
      relax: baseSag.relax,
      hipOn,
      rightStrength,
      rightFade: hipFade,
      strategy: hipStrategyUse,
      hip2Target,
    });
    // 矢状层内的“大腿内收靠近 IK”：按膝-踝局部外偏量修 hip0 目标。
    // 左负/右正；只修目标，不新增写手，不改 base / 侧向踝。
    if (sag16) {
      const kzi = di(w, `knee_${s}`, 2);
      const azi = di(w, `foot_${s}`, 2);
      const kz = kzi >= 0 ? w.body.dofs[kzi]!.anchorWorld[2]! : 0;
      const az = azi >= 0 ? w.body.dofs[azi]!.anchorWorld[2]! : 0;
      const sideSign = s === 'l' ? 1 : -1;
      const out = sideSign * (kz - az);
      const cap = Math.abs(num('SQC_HIP0_OUT_CAP', 0.08));
      const bias = -sideSign * Math.min(cap, Math.max(0, num('SQC_HIP0_OUT_K', 4.5) * out));
      hipCmd.hip0Target += bias;
    }
    const hipFf = hipCmd.hipFf + thigh.hip2Ff;
    // 矢状命令层最小版：HipHub 局部共收缩。
    // 只放大 hip 的 kp/kd，不改 target / base / 侧向；用于“大腿根动、骨盆稳”。
    const hipHub = computeHipHub({
      side: s,
      hipQ: sideData.hipQ,
      hipV: sideData.hipV,
      pelvisRoll: pelvisSense.roll,
      contact: fc.contact,
      enabled: sag16 || String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_HIP_HUB ?? '0') !== '0',
      kMove: num('SQC_HIP_HUB_MOVE_K', 0.15),
      kPelvis: num('SQC_HIP_HUB_PELVIS_K', 0.2),
      maxScale: num('SQC_HIP_HUB_MAX', 3.0),
    });
    let hubMap = _hubScaleLp.get(st);
    if (!hubMap) { hubMap = new Map(); _hubScaleLp.set(st, hubMap); }
    const hubPrev = hubMap.get(s) ?? hipHub.dampingScale;
    const hubA = 1 - Math.exp(-Math.max(0, w.dt) / Math.max(1e-3, num('SQC_HIP_HUB_LP_TC', 0.05)));
    const hubScale = hubPrev + (hipHub.dampingScale - hubPrev) * hubA;
    hubMap.set(s, hubScale);
    const hubKpScale = 1 + 0.35 * (hubScale - 1);
    const hubKdScale = hubScale;
    const shankGuard = computeShankGuard({
      hipMove: hipHub.hipMove,
      kneeV: w.body.dofs[di(w, `knee_${s}`, 2)]?.vel ?? 0,
      ankleV: w.body.dofs[di(w, `foot_${s}`, 2)]?.vel ?? 0,
      contact: fc.contact,
      enabled: sag16 || String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SHANK_GUARD ?? '0') !== '0',
      kMove: num('SQC_SHANK_GUARD_MOVE_K', 0.06),
      maxScale: num('SQC_SHANK_GUARD_MAX', 1.2),
    });
    let guardMap = _guardScaleLp.get(st);
    if (!guardMap) { guardMap = new Map(); _guardScaleLp.set(st, guardMap); }
    const guardPrev = guardMap.get(s) ?? shankGuard.scale;
    const guardA = 1 - Math.exp(-Math.max(0, w.dt) / Math.max(1e-3, num('SQC_SHANK_GUARD_LP_TC', 0.05)));
    const shankScale = guardPrev + (shankGuard.scale - guardPrev) * guardA;
    guardMap.set(s, shankScale);
    {
      const gh = globalThis as unknown as { __HIP_HUD?: Record<string, unknown>; __HIP_HUB?: Record<string, unknown>; __SHANK_GUARD?: Record<string, unknown> };
      const oh = gh.__HIP_HUD ?? {};
      oh[s] = { knee0: sideData.knee0, fLat: fActual.fLat, fParallel: fActual.fParallel, fParallelSigned: fActual.fParallelSigned, fPerpSag: fActual.fPerpSag, hip0Delta: hipStrategy.hip0Delta, hip1Delta: hipStrategy.hip1Delta, valgusHip0: hipStrategy.valgusHip0, valgusHip1: hipStrategy.valgusHip1, hip0T: hipCmd.hip0Target, hip1T: hipCmd.hip1Target };
      gh.__HIP_HUD = oh;
      const hb = gh.__HIP_HUB ?? {};
      hb[s] = { scale: hubScale, hipMove: hipHub.hipMove, roll: pelvisSense.roll, active: hipHub.active ? 1 : 0 };
      gh.__HIP_HUB = hb;
      const gsg = gh.__SHANK_GUARD ?? {};
      gsg[s] = { scale: shankScale, active: shankGuard.active ? 1 : 0 };
      gh.__SHANK_GUARD = gsg;
      const gs = globalThis as unknown as { __SAG16?: Record<string, unknown> };
      const os = gs.__SAG16 ?? {};
      os[s] = { sag16, thighFf: thigh.hip2Ff, thighForce: thigh.force, eSag: hipStrategy.errors.eSag, eSagV: hipStrategy.errors.eSagV, hipFf, hubScale, shankScale, couple: frontalCouple.couple, coupleL: frontalCouple.ffL, coupleR: frontalCouple.ffR };
      gs.__SAG16 = os;
    }
    pdg.hip.hip0(s, hipCmd.hip0Target, num('SQC_HIP0_KP', 1200) * hubKpScale, num('SQC_HIP0_KD', 20) * hubKdScale, Math.abs(num('SQC_HIP0_CAP', 150)), 'squat.hip0', hipForceFf + (s === 'l' ? frontalCouple.ffL : frontalCouple.ffR));
    pdg.hip.hip1(s, hipCmd.hip1Target, num('SQC_HIP1_ROLL_KP', 200) * hubKpScale, num('SQC_HIP1_ROLL_KD', 10) * hubKdScale, Math.abs(num('SQC_HIP1_CAP', 120)), 'squat.hip1');
    pdg.hip.hip2(s, hipCmd.hip2Target, num('SQC_SUPPORT_KP', 50) * hubKpScale, num('SQC_SUPPORT_KD', 2) * hubKdScale, Math.abs(num('SQC_HIP2_CAP', 150)), 'squat.hip2', hipFf);
    const kneeAng = w.body.dofs[di(w, `knee_${s}`, 2)]?.angle ?? 0;
    const knee2Target = baseSag.knee2Support + (sag16 ? 0 : sagFade * sagRight.knee2Delta);
    const kneeErr = knee2Target - kneeAng;
    const band = Math.abs(num('SQC_SUP_ONE_WAY_BAND', 0.3));
    const supScale = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SUP_ONE_WAY ?? '0') !== '0'
      ? (kneeErr >= 0 ? 1 : Math.max(0, Math.min(1, 1 + kneeErr / band))) : 1;
    const kneeSup = supFf * supScale * (1 - relax);
    const kneeLock = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_KNEE_LOCK ?? '0') !== '0';
    const knee2T = kneeLock ? leg.qKnee2 : knee2Target;
    const kneeFf = kneeLock ? 0 : baseSag.knee + rightStrength * kneeSup;
    if (!pairOnly) {
      pdg.shank.knee2(s, knee2T, num('SQC_SUPPORT_KP', 50) * shankScale, num('SQC_SUPPORT_KD', 2) * shankScale, Math.abs(num('SQC_SUPPORT_CAP', 120)), 'squat.knee2', kneeFf);
    }
    {
      pdg.shank.knee0(s, knee0Cmd, 300, 12, Math.abs(num('SQC_KNEE0_CAP', 60)), 'squat.knee0', lateralKneeFf);
      const latPdg = lateral.align;
      const latGain = latPdg ? lateral.soft : 0;
      const f0Kp = num('SQC_FOOT0_KP', 20) + (num('SQC_SHANK_FOOT0_KP', 160) - num('SQC_FOOT0_KP', 20)) * latGain;
      const f0Kd = num('SQC_FOOT0_KD', 8) + (num('SQC_SHANK_FOOT0_KD', 12) - num('SQC_FOOT0_KD', 8)) * latGain;
      const f0Cap = Math.abs(num('SQC_FOOT0_CAP', 25)) + (Math.abs(num('SQC_SHANK_FOOT0_CAP', 80)) - Math.abs(num('SQC_FOOT0_CAP', 25))) * latGain;
      const f0Src = latPdg ? 'squat.foot0.lat' : 'squat.foot0';
      pdg.shank.foot0(s, foot0Cmd, f0Kp, f0Kd, f0Cap, f0Src);
      pdg.shank.foot1(s, shankPlan.foot1, 40, 3, 30, 'squat.foot1');

    }
    // 矢状踝是承重链末端：接触短暂丢失时也保持关节角，不允许踝在卸载瞬间完全消失。
    // ★ 实测：-0.0005 会把左脚 CoP 推到 0.13、fz 201/346；关闭后恢复 331/333。
    // 踝不归矢状回正：只维持 base/IK，力链/抓地由小腿通道负责（架构 §12.1）。
    const foot2T = baseSag.foot2Target;
    pdg.shank.foot2(s, foot2T, num('SQC_FOOT2_KP', 600) * shankScale, num('SQC_FOOT2_KD', 12) * shankScale, num('SQC_FOOT2_CAP', 200), 'squat.foot2', baseSag.ankle);
    if (String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SQUAT_DBG ?? '0') === '1') {
      const g = globalThis as unknown as { __SQUAT_DBG?: Record<string, unknown> };
      const o = g.__SQUAT_DBG ?? {};
      o[s] = {
        hip0T, foot0T, knee0T: shankPlan.knee0, hip2T: hipCmd.hip2Target, knee2T, foot2T,
        eSag: hipStrategy.errors.eSag, eSagSrc, hipBase, heightFf, supFf, hipFf, relax: baseSag.relax, kneeSup, supScale,
        forceMode: hipStrategy.forceMode, legFf: hipStrategy.legFf, sagFade, hipFade,
        hipForceOn: hipForceOn ? 1 : 0, hipForceFf, loadDiff: hipStrategy.loadDiff,
        ffBase: hipCmd.baseFf, ffHeight: hipCmd.heightFf, ffRight: hipCmd.rightFf,
        baseHip: baseSag.hip, baseGate: baseSag.baseGate, kneeHipFlex: baseSag.kneeHipFlex,
        baseKnee2Support: baseSag.knee2Support, baseHipFf: baseSag.hipFf,
        shankSelSide, lateralFoot0,
        latF: fActual.fLat, latPerp: fActual.fPerp, latChain: fActual.fParallel, latCopZ: fActual.copZ, latFric: fActual.frictionUtil, latCopIn: fActual.copInside,
        hipHigh, hipLow, hipTargetY: hipTarget.y, hipAnchorY: h2nowY,
        hip2Q: h2 >= 0 ? w.body.dofs[h2]!.angle : 0, knee2Q: kneeAng,
        hipT: pdg.hip.tension(s, 'hip'), kneeT: pdg.shank.tension(s, 'knee'), shankT: pdg.shank.tension(s, 'foot'),
      };
      g.__SQUAT_DBG = o;
    }
    // 脚离地时不再写膝/踝 damp；接触丢失后不让阻尼继续制造高频力矩
  }
  const p2Scale = Math.max(0, Math.min(1, 1 - num('SQC_P2_HIP_SOFT', 0.8) * p2Soft));
  const drv = ctl.warner.drive as unknown as { setSupportScale?(s: number): void };
  drv.setSupportScale?.(p2Scale);
}
