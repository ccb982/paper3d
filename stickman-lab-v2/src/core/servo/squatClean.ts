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
import { baseTq, baseAng } from './baseTable';
import { propose, PRI } from '../proposalBus';
import type { World } from '../world';
import type { ControlModule } from '../control';
import type { CourtState as CS } from '../court';
import { courtStep } from '../court';
import { sampleFootContact, resetFootSensor } from './footContact';
import { captureShankLeg, hipLateralTarget, solveShankIK, solveShankIK2, solveShankIKTarget, type ShankLegRef } from './shankIK';
import { measureActualForceChain } from './actualForceChain';
import { solveStaticLegTorques } from './legInverseDynamics';
import { measureJointLoads } from './fullInverseDynamics';
import { solveBilateral } from './bilateralSolver';
import { estimateExternalBoundary, resetExternalBoundary } from './externalBoundary';
import { sensePelvis } from './pelvisSense';
import { senseSagittal } from './sagittalSense';
import { upperBodyCommand } from './upperBodyCommand';
import { UpperTaskPD } from './upperTaskPD';
import { planSupport } from './supportPlanner';
import { computeSagittalBase } from './sagittalBase';
import { clampHip2, clampKnee2, clampFoot2, clampHip0, clampComX, clampComZ, clampCopX, SQUAT_Q_MIN, SQUAT_Q_MAX } from './squatFeasible';
import { solveSquatHipDynamics, solveSquatShankDynamics } from './squatWbc';
import { computeThighPower } from './thighPower';
import { computeFzBudget, resetFzBudget } from './fzBudget';
import type { HipRightingFrame } from './hipRightingInput';
import { resetHipTask2, solveHipTask2 } from './hipTaskPD';
import { HipTaskPD, ShankTaskPD, resetPdGroups } from './pdGroups';

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
const _loadShareLp = new WeakMap<CS, Map<'l' | 'r', number>>();
/** 力链模式滞回（上一帧是否 FORCE_CHAIN） */
/** 神经命令淡入淡出（0..1）：力链模式 / 回正模式切换用 */
const _trace = new WeakMap<CS, Array<Record<string, unknown>>>();
const _traceT = new WeakMap<CS, Map<'l' | 'r', number>>();
const _idMode = new WeakMap<CS, { mode: 'STABILIZE' | 'RECOVER'; since: number }>();
interface IKCacheEntry { at: number; contact: boolean; H: { x: number; y: number; z: number }; hipTask: ReturnType<typeof solveHipTask2> | null; ik: ReturnType<typeof solveShankIK> }
const _ikCache = new WeakMap<World, Map<'l' | 'r', IKCacheEntry>>();
const _hipHold = new WeakMap<World, Map<'l' | 'r', { x: number; y: number; z: number }>>();
interface FCacheEntry { at: number; fChain: number; fPerp: number; fPerpSag: number; fLat: number; fLatLp: number; fParallel: number; fParallelSigned: number; copZ: number; frictionUtil: number; copInside: boolean; fChainLp: number; fPerpLp: number; feasible: boolean; feasibleRaw: boolean; tauUtil: number }
const _fcCache = new WeakMap<World, Map<'l' | 'r', FCacheEntry>>();
/** 释放瞬间捕获的稳定力链基线（fPerp0/fParallel0），侧向回正只追相对偏差。 */
const _ikBase = new WeakMap<World, Map<'l' | 'r', { hip: number; knee: number; ankle: number }>>();

const num = (k: string, d: number): number => {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const v = Number(env[k]);
  return Number.isFinite(v) ? v : d;
};
const di = (w: World, n: string, a: number): number => w.body.dofByName(n, a);
const squatComJ = (w: World, side: 'l' | 'r'): [number, number, number][] => {
  const n = w.body.dofs.length;
  const J = new Float64Array(n * 3);
  w.body.comJacobianComplement(J);
  const row = (name: string, axis: number): [number, number, number] => {
    const i = di(w, name, axis);
    return i >= 0 ? [J[3 * i]!, J[3 * i + 1]!, J[3 * i + 2]!] : [0, 0, 0];
  };
  return [row(`hip_${side}`, 2), row(`knee_${side}`, 2), row(`foot_${side}`, 2)];
};
const ang = (w: World, n: string, a: number): number => { const i = di(w, n, a); return i >= 0 ? w.body.dofs[i]!.angle : 0; };
const cmdPosRaw = (w: World, n: string, a: number, target: number, kp: number): number => { const i = di(w, n, a); return i >= 0 ? kp * (target - w.body.dofs[i]!.angle) : 0; };
const actOf = (ff: number, pos: number, cap: number): number => Math.max(-1, Math.min(1, (ff + pos) / Math.max(1e-6, cap)));
const _actLp = new WeakMap<World, Map<string, number>>();
const _cmdFfLp = new WeakMap<World, Map<string, number>>();
const smoothCmd = (w: World, key: string, target: number): number => {
  let m = _cmdFfLp.get(w);
  if (!m) { m = new Map(); _cmdFfLp.set(w, m); }
  const prev = m.get(key) ?? target;
  const tau = Math.max(0.005, Math.abs(num('SQC_CMD_FF_LP_TAU', 0.05)));
  const a = 1 - Math.exp(-Math.max(0, w.dt) / tau);
  let out = prev + (target - prev) * a;
  const rate = Math.abs(num('SQC_CMD_FF_RATE', 100));
  const step = rate * w.dt;
  out = Math.max(prev - step, Math.min(prev + step, out));
  m.set(key, out);
  return out;
};
const smoothAct = (w: World, key: string, target: number): number => {
  let m = _actLp.get(w);
  if (!m) { m = new Map(); _actLp.set(w, m); }
  const prev = m.get(key) ?? 0;
  const tau = Math.max(0.005, Math.abs(num('SQC_ACT_LP_TAU', 0.02)));
  const a = 1 - Math.exp(-Math.max(0, w.dt) / tau);
  let out = prev + (target - prev) * a;
  const rate = Math.abs(num('SQC_ACT_RATE', 8));
  const step = rate * w.dt;
  out = Math.max(prev - step, Math.min(prev + step, out));
  m.set(key, out);
  return out;
};

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
  {
    const mid = (refs.l.hipGeoZ - refs.r.hipGeoZ) / 2;
    refs.l.hipGeoZ = mid;
    refs.r.hipGeoZ = -mid;
    const mid0 = (refs.l.qHip0 - refs.r.qHip0) / 2;
    refs.l.qHip0 = mid0;
    refs.r.qHip0 = -mid0;
    const midK0 = (refs.l.qKnee0 - refs.r.qKnee0) / 2;
    refs.l.qKnee0 = midK0;
    refs.r.qKnee0 = -midK0;
    const midF0 = (refs.l.qFoot0 - refs.r.qFoot0) / 2;
    refs.l.qFoot0 = midF0;
    refs.r.qFoot0 = -midF0;
    const avgHip2 = (refs.l.qHip2 + refs.r.qHip2) / 2;
    refs.l.qHip2 = avgHip2;
    refs.r.qHip2 = avgHip2;
    const avgKnee2 = (refs.l.qKnee2 + refs.r.qKnee2) / 2;
    refs.l.qKnee2 = avgKnee2;
    refs.r.qKnee2 = avgKnee2;
    const avgFoot2 = (refs.l.qFoot2 + refs.r.qFoot2) / 2;
    refs.l.qFoot2 = avgFoot2;
    refs.r.qFoot2 = avgFoot2;
    const avgHipGeo = (refs.l.hipGeo + refs.r.hipGeo) / 2;
    refs.l.hipGeo = avgHipGeo;
    refs.r.hipGeo = avgHipGeo;
    const avgKneeBend = (refs.l.kneeBend + refs.r.kneeBend) / 2;
    refs.l.kneeBend = avgKneeBend;
    refs.r.kneeBend = avgKneeBend;
  }
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
  {
    const g = globalThis as unknown as Record<string, unknown>;
    delete g.__ID;
    delete g.__ID_GLOBAL;
    delete g.__SQUAT_DBG;
    delete g.__SAG16;
    delete g.__BS;
    delete g.__IK_STATE;
    delete g.__FZ_BUDGET;
    delete g.__HIP_FRAME;
  }
  resetPdGroups(w);
  _pdGroups.delete(w);
  _upperPd.delete(w);
  _tauPrev.delete(w);
  _velLp.delete(w);
  _idMode.delete(w as unknown as CS);
  resetFzBudget(w);
  resetHipTask2(w);
  _ikCache.delete(w);
  _hipHold.delete(w);
  _fcCache.delete(w);
  _ikBase.delete(w);
  resetFootSensor(w);
  resetExternalBoundary(w);
}

/** 关节 PD 执行器；只消费 target，不生成新目标。 */
/** 只消费接口目标，不生成文档外目标。 */
function pd(w: World, name: string, axis: number, target: number, kp: number, kd: number, cap: number, src: string, ff = 0, pri: number = PRI.reflex, passive = 0, cmdPos = 0, act?: number): void {
  const i = di(w, name, axis);
  if (i < 0) return;
  const d = w.body.dofs[i]!;
  let vm = _velLp.get(w);
  if (!vm) { vm = new Map(); _velLp.set(w, vm); }
  const vPrev = vm.get(i) ?? d.vel;
  const vLp = vPrev + (d.vel - vPrev) * Math.max(0, Math.min(1, num('SQC_PD_VEL_LP', 0.2)));
  vm.set(i, vLp);
  const posTerm = 0;
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
  // QP 矢状基础力：QP 输出就是总力矩，执行层不得再叠加 P2/阻尼。
  const qpTotal = act !== undefined && axis === 2 && /^(hip|knee|foot)_/.test(name) && num('SQC_QP_TOTAL', 1) === 1;
  const tau = qpTotal
    ? Math.max(-cap, Math.min(cap, act * cap))
    : act === undefined
      ? Math.max(-cap, Math.min(cap, pd + ff + passive))
      : Math.max(-cap, Math.min(cap, act * cap + dampUse + passive));

  if (String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SQUAT_DBG ?? '0') === '1') {
    const g = globalThis as unknown as { __PD_TAU?: Record<string, number> };
    const o = g.__PD_TAU ?? {};
    o[`${name}/${axis}`] = rawPd;
    g.__PD_TAU = o;
  }

  if (String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_PD_DBG ?? '0') === '1') {
    const g = globalThis as unknown as { __PD_PARTS?: Record<string, unknown> };
    const o = g.__PD_PARTS ?? {};
    o[`${name}/${axis}`] = { target, angle: d.angle, vel: d.vel, vLp, posTerm, dampTerm, dampUse, rawPd0, dead, rawPd, slew, prev, cap, kp, ff, passive, tau, legJoint };
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
  const pdg = getPdGroups(w);
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
  const stanceSide: 'l' | 'r' = hipFrame.fzL >= hipFrame.fzR ? 'l' : 'r';
  (globalThis as unknown as { __SUPPORT_SIDE?: 'l' | 'r' }).__SUPPORT_SIDE = stanceSide;
  {
    const gh = w.body.dofByName('hip_l', 0);
    const gr = w.body.dofByName('hip_r', 0);
    const hL = gh >= 0 ? w.body.dofs[gh]!.anchorWorld[1]! : 0;
    const hR = gr >= 0 ? w.body.dofs[gr]!.anchorWorld[1]! : 0;
    const eH = hL - hR;
    const lowSide = eH > 0 ? 'r' : 'l';
    const baseDestabilizing = Math.abs(eH) > Math.abs(num('SQC_AUTH_EH_MIN', 0.005));
    const authority = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_RIGHTING_AUTHORITY ?? 'assist') === 'override' ? 'override' : 'assist';
    (globalThis as unknown as { __AUTH?: unknown }).__AUTH = {
      authority,
      baseDestabilizing,
      eH,
      lowSide,
      fzL: fzBudget.fzLTarget,
      fzR: fzBudget.fzRTarget,
    };
  }
  const frictionMax = Math.abs(num('SQC_SHANK_FRICTION_MAX', 0.8));
  // 侧向就绪 = 抓地/力链可用；不满足时调度器不进入侧向 / 退回矢状。
  // 命令层不再用 `|| !lateralGrip` 自行兜底（架构 §12：同一帧只有一个 mode）。
  (globalThis as { __SQC_MODE?: string; __SQC_MODE_T?: number }).__SQC_MODE = 'none';
  (globalThis as { __SQC_MODE?: string; __SQC_MODE_T?: number }).__SQC_MODE_T = w.clock;
  let p2Soft = 0;
  for (const n of ['spine1', 'spine2', 'spine3', 'neck'] as const) {
    ctl.manual.clearAngle(n, 2);
    ctl.manual.pin(n, 2, true);
  }
  const upperCmd = upperBodyCommand(w, st);
  {
    const targets = new Map(upperCmd.targets);
    for (const n of ['spine1', 'spine2', 'spine3'] as const) {
      const i = di(w, n, 0);
      if (i >= 0) targets.set(i, upperCmd.targets.get(i) ?? w.body.dofs[i]!.angle);
    }
    if (num('SQC_UPPER_PD_ON', 1) === 1) getUpperPd(w).step(w, { ...upperCmd, targets });
  }
  const loadHL = w.body.dofs[di(w, 'hip_l', 0)]?.anchorWorld[1] ?? 0;
  const loadHR = w.body.dofs[di(w, 'hip_r', 0)]?.anchorWorld[1] ?? 0;
  const loadEH = loadHL - loadHR;
  const loadLow = loadEH > 0 ? 'r' : 'l';
  const loadHigh = loadEH > 0 ? 'l' : 'r';
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
    {
      const g = globalThis as unknown as { __FC_SAG?: Record<string, unknown> };
      const o = g.__FC_SAG ?? {};
      o[s] = { fLat: fActual.fLat, fPerp: fActual.fPerp, fPerpSag: fActual.fPerpSag, fParallel: fActual.fParallel, feasible: fActual.feasible, copInside: fActual.copInside };
      g.__FC_SAG = o;
    }
    let eqTau: { hip: number; knee: number; ankle: number } | null = null;
    let eqIk: { F: { x: number; y: number }; cop: { x: number; z: number }; tau: { hip: number; knee: number; ankle: number }; feasible: boolean } | null = null;
    let targetKneeIk: { x: number; y: number; z: number } | null = null;
    if (String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_IK2 ?? '1') === '1') {
      const k2i = di(w, `knee_${s}`, 2);
      const tauKnee = k2i >= 0 ? (w.executor.ledger[k2i]?.applied ?? 0) : 0;
      const targetF = w.sk.massTotal * 9.81 * 0.5;
      const omegaIK = Math.sqrt(9.81 / Math.max(0.3, hipFrame.comY));
      const copXTarget = hipFrame.comX + hipFrame.comVX / omegaIK;
      const copZTarget = hipFrame.comZ + hipFrame.comVZ / omegaIK;
      const sol = solveShankIK2(w, leg, hipTarget, targetF, tauKnee, { x: leg.knee.x - leg.ankle.x, y: leg.knee.y - leg.ankle.y, z: leg.knee.z - leg.ankle.z }, copXTarget - leg.ankle.x, copZTarget - leg.ankle.z);
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
      setRef(`hip_${s}`, 0, t[s].hip0);
      setRef(`foot_${s}`, 0, num('SQC_P2_FOOT0_REF', 0));
      setRef(`hip_${s}`, 2, ik.hip2);
      setRef(`knee_${s}`, 0, num('SQC_P2_KNEE0_REF', 0));
      setRef(`knee_${s}`, 2, ik.knee2);
      setRef(`foot_${s}`, 2, ik.foot2);
    }

    // 实际力链低频回正：只消 F_perp，不改变沿链 F_chain。
    // ★ §164：力链/扰动检测只汇报，不生成回正力。
    const fzTarget = s === 'l' ? fzBudget.fzLTarget : fzBudget.fzRTarget;
    // 三连杆逆动力学只读快照：目标脚底力 + 实际几何/质量 → hip/knee/ankle 静态力矩。
    const idBoundary = num('SQC_ID_BOUNDARY', 0) === 1 ? estimateExternalBoundary(w, s) : null;
    const idTorque = solveStaticLegTorques(w, s, fc, fzTarget, idBoundary ? {
      ...idBoundary.hip, ...idBoundary.knee,
    } : undefined);
    // 只读状态：XCoM 到支撑中心/边界的余量，决定先稳定还是可回正。
    const omega0 = Math.sqrt(9.81 / Math.max(0.3, hipFrame.comY));
    const xcomZ = hipFrame.comZ + hipFrame.comVZ / omega0;
    const zL = fcS.l.footZ, zR = fcS.r.footZ;
    const supportMid = (zL + zR) / 2;
    const supportHalf = Math.abs(zL - zR) / 2 + 0.04;
    // 有效 BoS：静态支撑面打 30–50% 折扣（Hof 2016：突发扰动下有效 BoS 约 30%）。
    const effectiveHalf = supportHalf * Math.max(0.2, Math.min(1, num('SQC_ID_BOS_FRAC', 0.5)));
    const margin = effectiveHalf - Math.abs(xcomZ - supportMid);
    const idMode = idTorque.feasible && margin > 0 ? 'RECOVER' : 'STABILIZE';
    {
      const gi = globalThis as unknown as { __ID?: Record<string, unknown> };
      const oi = gi.__ID ?? {};
      const hipJ = di(w, `hip_${s}`, 2);
      const kneeJ = di(w, `knee_${s}`, 2);
      const ankleJ = di(w, `foot_${s}`, 2);
      const ledger = (i: number): { cmd: number; applied: number; passive: number; pair: number } => {
        const e = i >= 0 ? w.executor.ledger[i] : null;
        return { cmd: e?.cmd ?? 0, applied: e?.applied ?? 0, passive: e?.passive ?? 0, pair: e?.pair ?? 0 };
      };
      const hl = ledger(hipJ), kl = ledger(kneeJ), al = ledger(ankleJ);
      oi[s] = {
        hip: idTorque.hip, knee: idTorque.knee, ankle: idTorque.ankle,
        fz: idTorque.fz, copX: idTorque.copX,
        feasible: idTorque.feasible ? 1 : 0, margin, mode: idMode,
        q: { hip2: w.body.dofs[hipJ]?.angle ?? 0, knee2: w.body.dofs[kneeJ]?.angle ?? 0, ankle2: w.body.dofs[ankleJ]?.angle ?? 0 },
        qd: { hip2: w.body.dofs[hipJ]?.vel ?? 0, knee2: w.body.dofs[kneeJ]?.vel ?? 0, ankle2: w.body.dofs[ankleJ]?.vel ?? 0 },
        cmd: { hip: hl.cmd, knee: kl.cmd, ankle: al.cmd },
        applied: { hip: hl.applied, knee: kl.applied, ankle: al.applied },
        passive: { hip: hl.passive, knee: kl.passive, ankle: al.passive },
        residual: { hip: idTorque.hip - hl.applied, knee: idTorque.knee - kl.applied, ankle: idTorque.ankle - al.applied },
      };
      gi.__ID = oi;
    }
    const support = buildSupport(q, fc, ik.hip0, ik.knee2, fzTarget);
    const chain = buildChain(fc);
    const right = buildRighting(s, q, ik);
    const hip0T = held.hipTask?.hip0 ?? ik.hip0;
    const foot0T = right.foot0;
    const knee0Hold = t[s].knee0;
    const shankPlan = { knee0: knee0Hold, foot0: foot0T, foot1: right.foot1 };
    const hipA = w.body.dofs[di(w, `hip_${s}`, 0)]!.anchorWorld;
    const h1i = di(w, `hip_${s}`, 1);
    const hip1Base = h1i >= 0 ? w.body.dofs[h1i]!.angle : 0;
    const idArch = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_ID_ARCH ?? '1') !== '0';
    const f0i = di(w, `foot_${s}`, 0);
    const f0d = f0i >= 0 ? w.body.dofs[f0i]! : null;
    const lateral = {
      knee0Target: ik.knee0,
      foot0Target: ik.foot0,
      knee0Ff: 0,
      foot0Ff: 0,
      ikFoot0: ik.foot0,
      foot0Min: f0d?.min ?? -Math.PI,
      foot0Max: f0d?.max ?? Math.PI,
      ankleDelta: 0,
      deltaAvail: 0,
      ePerp: 0,
      eLat: 0,
      soft: 0,
      eLatRate: 0,
      eLatRawRate: 0,
      chainOk: true,
      active: false,
      fade: 0,
      chainOpen: true,
      align: false,
      fParallel: fActual.fParallel,
      fPerp: fActual.fPerpLp,
      fLat: fActual.fLatLp,
      fLat0: fActual.fLatLp,
    };
    const lateralFoot0 = ik.foot0;
    const lateralKneeFf = 0;
    shankPlan.knee0 = ik.knee0;
    const knee0Cmd = ik.knee0;
    const foot0Cmd = ik.foot0;
    {
      const gh = globalThis as unknown as { __SQC_SHANK_HUD?: Record<string, unknown> };
      const oh = gh.__SQC_SHANK_HUD ?? {};
      oh[s] = { align: lateral.align ? 1 : 0, eLat: lateral.eLat, soft: lateral.soft, targetDeg: lateral.foot0Target * 57.2958, actualDeg: (f0d?.angle ?? 0) * 57.2958, active: lateral.active ? 1 : 0, fade: lateral.fade, chainOk: lateral.chainOk ? 1 : 0, ikDeg: lateral.ikFoot0 * 57.2958, minDeg: lateral.foot0Min * 57.2958, maxDeg: lateral.foot0Max * 57.2958, ankleDeltaDeg: lateral.ankleDelta * 57.2958, availDeg: lateral.deltaAvail * 57.2958, foot0Ff: lateral.foot0Ff };
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
    const copCtrlOn = num('SQC_FOOT_COP_ON', 1) === 1;
    const copKpZ = Math.abs(num('SQC_FOOT0_COP_KP', 40));
    const copKdZ = Math.abs(num('SQC_FOOT0_COP_KD', 2));
    const copCapZ = Math.abs(num('SQC_FOOT0_COP_CAP', 8));
    const copKpX = Math.abs(num('SQC_FOOT2_COP_KP', 40));
    const copKdX = Math.abs(num('SQC_FOOT2_COP_KD', 2));
    const copCapX = Math.abs(num('SQC_FOOT2_COP_CAP', 8));
    const copSign0 = num('SQC_FOOT0_COP_SIGN', -1);
    const copSign2 = num('SQC_FOOT2_COP_SIGN', -1);
    let eCopX = 0;
    let eCopZ = 0;
    if (copCtrlOn && fc.contact && fc.copValid) {
      const omega = Math.sqrt(9.81 / Math.max(0.3, hipFrame.comY));
      const xcp = hipFrame.comX + hipFrame.comVX / omega;
      const zcp = hipFrame.comZ + hipFrame.comVZ / omega;
      const safeX = Math.max(0.005, fc.copHalfX - 0.015);
      const safeZ = Math.max(0.005, fc.copHalfZ - 0.015);
      const copTgtX = clampCopX(Math.max(fc.footX - safeX, Math.min(fc.footX + safeX, xcp)));
      const copTgtZ = Math.max(fc.footZ - safeZ, Math.min(fc.footZ + safeZ, zcp));
      eCopX = fc.copXFiltered - copTgtX;
      eCopZ = fc.copZFiltered - copTgtZ;
    }
    const baseSag = computeSagittalBase({
      ik: _ikBase.get(w)?.get(s),
      hip2Base, foot2Base: right.foot2, hip0Base: hip0T, hip1Base,
      knee2Base: k2Target, hipLow, hipHigh, hipTargetY: hipTarget.y, hipAnchorY: h2nowY,
      relax, baseGateK: num('SQC_BASE_HIP_GATE', 0.8), kneeFlexK: num('SQC_KNEE_HIP_FLEX', 0.12),
      heightK: num('SQC_HIP2_ERR_K', 300), heightCap: num('SQC_HIP2_ERR_CAP', 40),
      copErrorX: eCopX, copErrorZ: eCopZ, copVelX: fc.copVelX, copVelZ: fc.copVelZ,
      copKpX: -copSign2 * copKpX, copKdX: -copSign2 * copKdX, copKpZ: -copSign0 * copKpZ, copKdZ: -copSign0 * copKdZ,
      copCapX, copCapZ,
    });
    const copIdK = num('SQC_COP_ID_K', 1);
    const copCorrX = fc.fzFiltered * eCopX * copIdK;
    const copCorrZ = fc.fzFiltered * eCopZ * copIdK;
    const ankleFfOut = smoothCmd(w, `ankle_${s}`, baseSag.ankle);

    const supportX = clampComX(0.5 * (fcS.l.footX + fcS.r.footX));
    const thighSign = num('SQC_THIGH_SAG_SIGN', -1);
    const hipBudgetOn = num('SQC_HIP_BUDGET_ON', 1) === 1;
    const hipBudget = hipBudgetOn && fc.contact
      ? Math.max(0, Math.min(1, Math.min(fc.copMarginNorm, 1 - Math.max(0, fActual.tauUtil), 1 - Math.max(0, fc.copSpeed) / 0.5)))
      : 1;
    const thigh = computeThighPower({
      eSag: thighSign * (supportX - hipFrame.comX),
      eSagV: thighSign * (-hipFrame.comVX),
      contact: fc.contact,
      enabled: num('SQC_HIP_BASE_ON', 1) === 1,
      kSag: num('SQC_THIGH_SAG_K', 300),
      dSag: num('SQC_THIGH_SAG_D', 120),
      forceCap: num('SQC_THIGH_FORCE_CAP', 150),
      lever: num('SQC_THIGH_LEVER', 0.28),
      torqueCap: num('SQC_THIGH_TORQUE_CAP', 100),
      budget: hipBudget,
    });
    const supFf = supPlan.supFf;
    p2Soft = Math.max(p2Soft, baseSag.relax);
    const hipBase = baseSag.hip;
    // 髋高支撑力（神经层力命令）。− supFf·K 是已知跨关节耦合，待判决（架构 §11.6）。
    const heightFf = baseSag.hipFf - num('SQC_HIP_HEIGHT_FF_SUP', 0.5) * supFf;
    // 负值代表向下基础力，不能被 hipHigh 门控削掉。
    const baseGated = hipBase >= 0 ? hipBase * baseSag.baseGate : hipBase;
    const rightStrength = Math.max(0, num('SQC_RIGHT_STRENGTH', 2.0));
    const simpleBase = num('SQC_SIMPLE_BASE', 0) === 1;
    const loadTrim = simpleBase ? Math.max(-20, Math.min(20, num('SQC_SIMPLE_KLOAD', 0.0005) * (fcS.l.fzFiltered - fcS.r.fzFiltered))) * (s === 'l' ? 1 : -1) : 0;
    const baseHip0Target = baseSag.hip0Target;
    const baseHip1Target = baseSag.hip1Target;
    const baseHip2Target = simpleBase ? (baseAng('hip', 2) ?? t[s].hip2) : baseSag.hip2Target;
    const h2nowX = h2 >= 0 ? w.body.dofs[h2]!.anchorWorld[0]! : 0;
    const h2nowZ = h2 >= 0 ? w.body.dofs[h2]!.anchorWorld[2]! : 0;
    const hipShiftX = hipTarget.x - h2nowX;
    const hipShiftZ = hipTarget.z - h2nowZ;
    const hipShiftK = Math.abs(num('SQC_BASE_HIP_SHIFT_K', 0));
    const hipShiftD = Math.abs(num('SQC_BASE_HIP_SHIFT_D', 20));
    const hipShiftCap = Math.abs(num('SQC_BASE_HIP_SHIFT_CAP', 8));
    const hipCorrX = Math.max(-hipShiftCap, Math.min(hipShiftCap, hipShiftK * hipShiftX - hipShiftD * hipFrame.comVX));
    const hipCorrZ = Math.max(-hipShiftCap, Math.min(hipShiftCap, hipShiftK * hipShiftZ - hipShiftD * hipFrame.comVZ));
    const fzTotal = Math.max(1, fzBudget.fzLTarget + fzBudget.fzRTarget);
    const fzShare = Math.max(0.2, Math.min(0.8, fc.fzFiltered / fzTotal));
    let lsMap = _loadShareLp.get(st);
    if (!lsMap) { lsMap = new Map(); _loadShareLp.set(st, lsMap); }
    const lsTarget = Math.max(0.2, Math.min(0.8, fc.fzFiltered / fzTotal));
    const lsPrev = lsMap.get(s) ?? 0.5;
    const lsA = 1 - Math.exp(-w.dt / Math.max(0.1, Math.abs(num('SQC_LOAD_SHARE_TAU', 0.5))));
    const loadShare = lsPrev + (lsTarget - lsPrev) * lsA;
    lsMap.set(s, loadShare);
    const baseHipFfRaw = (simpleBase ? baseTq('hip', 2) + loadTrim : baseGated + heightFf * (1 - 0.8 * baseSag.relax))
      + (hipCorrX + hipCorrZ) * fzShare;
    const baseHipFf = baseHipFfRaw;
    const rightingHip2Ff = thigh.hip2Ff;
    const manScript = (globalThis as unknown as { __SAG_SCRIPT?: Array<{ t: number; hip0?: number; hip1?: number; hip2?: number; knee2?: number; hip2Ff?: number; knee2Ff?: number; hip0L?: number; hip0R?: number; hip1L?: number; hip1R?: number; hip2L?: number; hip2R?: number; knee2L?: number; knee2R?: number; hip2FfL?: number; hip2FfR?: number; knee2FfL?: number; knee2FfR?: number }> }).__SAG_SCRIPT;
    let scriptPoint: { hip0?: number; hip1?: number; hip2?: number; knee2?: number; hip2Ff?: number; knee2Ff?: number } | null = null;
    if (Array.isArray(manScript)) {
      for (const p of manScript) if (p.t <= st.t) scriptPoint = p;
    }
    const manOn = (num('SQC_MANUAL_SAG', 0) === 1 && st.t >= num('SQC_MAN_T0', 0) && st.t <= num('SQC_MAN_T1', 1e9)) || !!scriptPoint;
    const man = {
      hip0: manOn ? num(`SQC_MAN_HIP0_${s === 'l' ? 'L' : 'R'}`, 0) : 0,
      hip1: manOn ? num(`SQC_MAN_HIP1_${s === 'l' ? 'L' : 'R'}`, 0) : 0,
      hip2: manOn ? num(`SQC_MAN_HIP2_${s === 'l' ? 'L' : 'R'}`, 0) : 0,
      knee2: manOn ? num(`SQC_MAN_KNEE2_${s === 'l' ? 'L' : 'R'}`, 0) : 0,
      hip2Ff: manOn ? num(`SQC_MAN_HIP2FF_${s === 'l' ? 'L' : 'R'}`, 0) : 0,
      knee2Ff: manOn ? num(`SQC_MAN_KNEE2FF_${s === 'l' ? 'L' : 'R'}`, 0) : 0,
    };
    if (scriptPoint) {
      const side = s === 'l' ? 'L' : 'R';
      const pick = (k: string): number => {
        const v = (scriptPoint as Record<string, number | undefined>)[k + side] ?? (scriptPoint as Record<string, number | undefined>)[k];
        return typeof v === 'number' && Number.isFinite(v) ? v : 0;
      };
      man.hip0 += pick('hip0');
      man.hip1 += pick('hip1');
      man.hip2 += pick('hip2');
      man.knee2 += pick('knee2');
      man.hip2Ff += pick('hip2Ff');
      man.knee2Ff += pick('knee2Ff');
    }
    const hip0Out = baseHip0Target;
    const hip1Out = baseHip1Target;
    const hip0Soft = num('SQC_HIP0_SOFT_ON', 0) === 1;
    const hipBudgetRad = Math.abs(num('SQC_HIP_BUDGET_RAD', 0.3)) * hipBudget;
    const supportZ = clampComZ(0.5 * (fcS.l.footZ + fcS.r.footZ));
    const eComZ = supportZ - hipFrame.comZ;
    const eComVZ = -hipFrame.comVZ;
    const hip0CmdRaw = clampHip0((hip0Soft ? t[s].hip0 : hip0Out) + man.hip0);
    const hip0Cmd = hip0CmdRaw;
    const hip1Soft = num('SQC_HIP1_SOFT_ON', 1) === 1;
    const hip1CmdRaw = (hip1Soft ? t[s].hip1 : hip1Out) + man.hip1;
    const hip1Cmd = hip1CmdRaw;
    const hip2Out = clampHip2(baseHip2Target);
    const hipFfOut = baseHipFf + rightingHip2Ff;
    const hip2Cmd = hip2Out + man.hip2;
    const hipFfCmd = hipFfOut + man.hip2Ff;
    {
      const g = globalThis as unknown as { __HIP_SRC?: Record<string, unknown> };
      const o = g.__HIP_SRC ?? {};
      o[s] = { base0: baseHip0Target, base1: baseHip1Target, out0: hip0Cmd, out1: hip1Cmd, thigh2: thigh.hip2Ff, loadEH, lowSide: loadLow, base2Ff: baseHipFf, out2Ff: hipFfOut };
      g.__HIP_SRC = o;
    }
    const hubKpOut = 1;
    const hubKdOut = 1;
    const shankOut = 1;
    {
      const gs = globalThis as unknown as { __SAG16?: Record<string, unknown> };
      const os = gs.__SAG16 ?? {};
      os[s] = { base: 1, hipFf: hipFfOut, idHip: 0, idKnee: 0 };
      gs.__SAG16 = os;
    }
    // kneeOut 是 bilateral 逆动力学的约束项，不是独立 hip0 前馈。
    // 独立 kneeOutFf 的 A/B 会破坏平衡，已撤回；只在求解释放后联合输出。
    const passiveHigh = Math.max(0, Math.min(2, num('SQC_PASSIVE_AUTH_HIGH', 1)));
    const passiveLow = Math.max(0, Math.min(2, num('SQC_PASSIVE_AUTH_LOW', 1)));
    const passiveScale = Math.abs(loadEH) > Math.abs(num('SQC_PASSIVE_AUTH_DEADBAND', 0.005))
      ? (s === loadHigh ? passiveHigh : s === loadLow ? passiveLow : 1)
      : 1;
    const hip0Dof = w.body.dofs[di(w, `hip_${s}`, 0)];
    const hip1Dof = w.body.dofs[di(w, `hip_${s}`, 1)];
    const hip0Err = hip0Cmd - (hip0Dof?.angle ?? 0);
    const hip1Err = hip1Cmd - (hip1Dof?.angle ?? 0);
    const lockE = Math.abs(num('SQC_HIP_LOCK_E', 0.035));
    const lockV = Math.abs(num('SQC_HIP_LOCK_V', 0.6));
    const lock0 = Math.abs(hip0Err) > lockE || Math.abs(hip0Dof?.vel ?? 0) > lockV;
    const lock1 = Math.abs(hip1Err) > lockE || Math.abs(hip1Dof?.vel ?? 0) > lockV;
    const pairLat = num('SQC_PD_PAIR_HIP_LAT', 1) === 1;
    const hip0Kp = pairLat ? (hip0Soft ? num('SQC_HIP0_SOFT_KP', 600) : num('SQC_HIP0_KP', 1200)) : lock0 ? num('SQC_HIP0_LOCK_KP', 4000) : hip0Soft ? num('SQC_HIP0_SOFT_KP', 600) : num('SQC_HIP0_KP', 1200);
    const hip0Kd = pairLat ? (hip0Soft ? num('SQC_HIP0_SOFT_KD', 20) : num('SQC_HIP0_KD', 20)) : lock0 ? num('SQC_HIP0_LOCK_KD', 80) : hip0Soft ? num('SQC_HIP0_SOFT_KD', 20) : num('SQC_HIP0_KD', 20);
    const hip0Cap = pairLat ? (hip0Soft ? num('SQC_HIP0_SOFT_CAP', 60) : num('SQC_HIP0_CAP', 150)) : lock0 ? num('SQC_HIP0_LOCK_CAP', 600) : hip0Soft ? num('SQC_HIP0_SOFT_CAP', 60) : num('SQC_HIP0_CAP', 150);
    pdg.hip.hip0(s, hip0Cmd, hip0Kp * hubKpOut, hip0Kd * hubKdOut, Math.abs(hip0Cap), 'squat.hip0', 0, PRI.reflex, passiveScale, cmdPosRaw(w, `hip_${s}`, 0, hip0Cmd, hip0Kp));
    const hip1Kp = pairLat ? (hip1Soft ? num('SQC_HIP1_SOFT_KP', 200) : num('SQC_HIP1_ROLL_KP', 200)) : lock1 ? num('SQC_HIP1_LOCK_KP', 2500) : hip1Soft ? num('SQC_HIP1_SOFT_KP', 200) : num('SQC_HIP1_ROLL_KP', 200);
    const hip1Kd = pairLat ? (hip1Soft ? num('SQC_HIP1_SOFT_KD', 20) : num('SQC_HIP1_ROLL_KD', 10)) : lock1 ? num('SQC_HIP1_LOCK_KD', 50) : hip1Soft ? num('SQC_HIP1_SOFT_KD', 20) : num('SQC_HIP1_ROLL_KD', 10);
    pdg.hip.hip1(s, hip1Cmd, hip1Kp * hubKpOut, hip1Kd * hubKdOut, Math.abs(pairLat ? num('SQC_HIP1_CAP', 60) : lock1 ? num('SQC_HIP1_LOCK_CAP', 300) : num('SQC_HIP1_CAP', 60)), 'squat.hip1', 0, PRI.reflex, cmdPosRaw(w, `hip_${s}`, 1, hip1Cmd, hip1Kp));
    const kneeAng = w.body.dofs[di(w, `knee_${s}`, 2)]?.angle ?? 0;
    const knee2Target = simpleBase ? (baseAng('knee', 2) ?? t[s].knee2) : baseSag.knee2Support;
    const kneeErr = knee2Target - kneeAng;
    const band = Math.abs(num('SQC_SUP_ONE_WAY_BAND', 0.3));
    const supScale = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SUP_ONE_WAY ?? '0') !== '0'
      ? (kneeErr >= 0 ? 1 : Math.max(0, Math.min(1, 1 + kneeErr / band))) : 1;
    const kneeSup = supFf * supScale * (1 - relax);
    const kneeLock = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_KNEE_LOCK ?? '0') !== '0';
    const knee2Out = clampKnee2(simpleBase ? (baseAng('knee', 2) ?? t[s].knee2) : baseSag.knee2Support);
    const knee2T = kneeLock ? leg.qKnee2 : knee2Out;
    const kneeFfBase = kneeLock ? 0 : (simpleBase ? baseTq('knee', 2) : baseSag.knee + rightStrength * kneeSup);
    const kneeFfOut = kneeFfBase;
    const kneeFfCmd = kneeFfOut + man.knee2Ff;
    const foot2T = clampFoot2(ik.foot2);
    let bHip = hipFfCmd;
    let bKnee = kneeFfCmd;
    let bAnkle = ankleFfOut;
    const bQpOn = num('SQC_WBC_ON', 1) === 1;
    if (bQpOn) {
      const cj = squatComJ(w, s);
      const loads = measureJointLoads(w);
      const hTau = (n: string): number => loads.find((l) => l.name === n)?.torque ?? 0;
      const staticTau = { hip: hTau(`hip_${s}`), knee: hTau(`knee_${s}`), ankle: hTau(`foot_${s}`) };
      const mHip = Math.max(1e-3, w.body.jointInertia(di(w, `hip_${s}`, 2)));
      const mKnee = Math.max(1e-3, w.body.jointInertia(di(w, `knee_${s}`, 2)));
      const mAnkle = Math.max(1e-3, w.body.jointInertia(di(w, `foot_${s}`, 2)));
      const hipCmd = solveSquatHipDynamics({
        com: [hipFrame.comX, hipFrame.comZ, hipFrame.comY], comTarget: [supportX, supportZ, 0.53], comVel: [hipFrame.comVX, hipFrame.comVZ, 0],
        jCom: [[cj[0][0], cj[1][0]], [cj[0][2], cj[1][2]], [cj[0][1], cj[1][1]]], m: [mHip, mKnee], h: [staticTau.hip, staticTau.knee],
        tauMin: [-Math.abs(num('SQC_HIP2_CAP', 150)), -Math.abs(num('SQC_SUPPORT_CAP', 120))], tauMax: [Math.abs(num('SQC_HIP2_CAP', 150)), Math.abs(num('SQC_SUPPORT_CAP', 120))],
        kp: num('SQC_ID_KP', 8), kd: num('SQC_ID_KD', 2.5), wTask: num('SQC_WBC_WCOM', 1), wReg: num('SQC_WBC_WB', 0.01),
      });
      const shankCmd = solveSquatShankDynamics({ cop: fc.copXFiltered, copTarget: fc.copXFiltered - eCopX, copMin: fc.footX - Math.max(0.005, fc.copHalfX - 0.015), copMax: fc.footX + Math.max(0.005, fc.copHalfX - 0.015), fz: fc.fzFiltered, m: mAnkle, h: staticTau.ankle,
        tauMin: -Math.abs(num('SQC_FOOT2_CAP', 80)), tauMax: Math.abs(num('SQC_FOOT2_CAP', 80)), kpCop: num('SQC_ID_KPCOP', 0.6), copCap: num('SQC_ID_COPCAP', 30) });
      const out = [hipCmd[0], hipCmd[1], shankCmd] as const;
      const capH = Math.abs(num('SQC_HIP2_CAP', 150));
      const capK = Math.abs(num('SQC_SUPPORT_CAP', 120));
      const capA = Math.abs(num('SQC_FOOT2_CAP', 80));
      const finite = out.every((v) => Number.isFinite(v));
      bHip = finite ? Math.max(-capH, Math.min(capH, out[0])) : hipFfCmd;
      bKnee = finite ? Math.max(-capK, Math.min(capK, out[1])) : kneeFfCmd;
      bAnkle = finite ? Math.max(-capA, Math.min(capA, out[2])) : ankleFfOut;
      (globalThis as { __WBC?: unknown }).__WBC = { s, base: [hipFfCmd, kneeFfCmd, ankleFfOut], out: [bHip, bKnee, bAnkle], h: [staticTau.hip, staticTau.knee, staticTau.ankle], finite, sat: [Math.abs(bHip) >= capH - 1e-6, Math.abs(bKnee) >= capK - 1e-6, Math.abs(bAnkle) >= capA - 1e-6] };
    }
    pdg.hip.hip2(s, hip2Cmd, num('SQC_SUPPORT_KP', 50) * hubKpOut, num('SQC_SUPPORT_KD', 2) * hubKdOut, Math.abs(num('SQC_HIP2_CAP', 150)), 'squat.hip2', bHip, PRI.reflex, cmdPosRaw(w, `hip_${s}`, 2, hip2Cmd, num('SQC_SUPPORT_KP', 50)), Math.max(-1, Math.min(1, bHip / Math.max(1e-6, Math.abs(num('SQC_HIP2_CAP', 150))))));
    let gripDbg = 0;
    let act0Dbg = 0;
    let act2Dbg = 0;
    {
      pdg.hip.knee2(s, knee2T + man.knee2, num('SQC_SUPPORT_KP', 50) * shankOut, num('SQC_SUPPORT_KD', 2) * shankOut, Math.abs(num('SQC_SUPPORT_CAP', 120)), 'squat.knee2', bKnee, PRI.reflex, cmdPosRaw(w, `knee_${s}`, 2, knee2T + man.knee2, num('SQC_SUPPORT_KP', 50)), Math.max(-1, Math.min(1, bKnee / Math.max(1e-6, Math.abs(num('SQC_SUPPORT_CAP', 120))))));
    }
    {
      pdg.hip.knee0(s, knee0Cmd, 300, 12, Math.abs(num('SQC_KNEE0_CAP', 100)), 'squat.knee0', lateralKneeFf, PRI.reflex, cmdPosRaw(w, `knee_${s}`, 0, knee0Cmd, 300), Math.max(-1, Math.min(1, lateralKneeFf / Math.max(1e-6, Math.abs(num('SQC_KNEE0_CAP', 100))))));
      pdg.hip.knee1(s, ang(w, `knee_${s}`, 1), 0, 0, Math.abs(num('SQC_KNEE1_CAP', 20)), 'squat.knee1', 0, PRI.reflex, 0);
      const latPdg = lateral.align;
      const latGain = latPdg ? lateral.soft : 0;
      const f0Kp = num('SQC_FOOT0_KP', 20) + (num('SQC_SHANK_FOOT0_KP', 160) - num('SQC_FOOT0_KP', 20)) * latGain;
      const f0Kd = num('SQC_FOOT0_KD', 0) + (num('SQC_SHANK_FOOT0_KD', 0) - num('SQC_FOOT0_KD', 0)) * latGain;
      const f0Cap = Math.abs(num('SQC_FOOT0_CAP', 25)) + (Math.abs(num('SQC_SHANK_FOOT0_CAP', 30)) - Math.abs(num('SQC_FOOT0_CAP', 25))) * latGain;
      const f0Src = latPdg ? 'squat.foot0.lat' : 'squat.foot0';
      const frictionUse = ctl.perception.feet[s === 'l' ? 0 : 1]!.frictionUse;
      const gripBudget = fc.contact
        ? Math.max(0, Math.min(1, Math.min(fc.fzFiltered / Math.max(1, fzTarget), 1 - frictionUse / Math.max(1e-6, frictionMax), 1 - fc.footSpeed / 0.5)))
        : 0;
      const actFoot0 = smoothAct(w, `foot0_${s}`, actOf(baseSag.foot0, cmdPosRaw(w, `foot_${s}`, 0, foot0Cmd, f0Kp), f0Cap) * gripBudget * Math.abs(num('SQC_COP_ANKLE_SHARE', 0.8)));
      gripDbg = gripBudget; act0Dbg = actFoot0;
      const foot0Ff = smoothCmd(w, `foot0ff_${s}`, baseSag.foot0);
      pdg.shank.foot0(s, foot0Cmd, f0Kp, f0Kd, f0Cap, f0Src, foot0Ff, PRI.reflex, 0, cmdPosRaw(w, `foot_${s}`, 0, foot0Cmd, f0Kp), actFoot0);
      const actFoot1 = smoothAct(w, `foot1_${s}`, (actFoot0 / Math.max(1e-6, Math.abs(num('SQC_COP_ANKLE_SHARE', 0.8)))) * gripBudget * Math.abs(num('SQC_COP_FOOT_SHARE', 0.05)));
      pdg.shank.foot1(s, shankPlan.foot1, 0, 0, Math.abs(num('SQC_FOOT1_CAP', 15)), 'squat.foot1', 0, PRI.reflex, 0, actFoot1);

    }
    // 矢状踝是承重链末端：接触短暂丢失时也保持关节角，不允许踝在卸载瞬间完全消失。
    // ★ 实测：-0.0005 会把左脚 CoP 推到 0.13、fz 201/346；关闭后恢复 331/333。
    // 踝不归矢状回正：只维持 base/IK，力链/抓地由小腿通道负责（架构 §12.1）。
    const frictionUse2 = ctl.perception.feet[s === 'l' ? 0 : 1]!.frictionUse;
    const gripBudget2 = fc.contact
      ? Math.max(0, Math.min(1, Math.min(fc.fzFiltered / Math.max(1, fzTarget), 1 - frictionUse2 / Math.max(1e-6, frictionMax), 1 - fc.footSpeed / 0.5)))
      : 0;
    const actFoot2 = smoothAct(w, `foot2_${s}`, Math.max(-1, Math.min(1, bAnkle / Math.max(1e-6, Math.abs(num('SQC_FOOT2_CAP', 80))))) * gripBudget2 * Math.abs(num('SQC_COP_ANKLE_SHARE', 0.8)));
    gripDbg = gripBudget2; act2Dbg = actFoot2;
    pdg.shank.foot2(s, foot2T, num('SQC_FOOT2_KP', 600) * shankOut, num('SQC_FOOT2_KD', 0) * shankOut, num('SQC_FOOT2_CAP', 80), 'squat.foot2', bAnkle, PRI.reflex, cmdPosRaw(w, `foot_${s}`, 2, foot2T, num('SQC_FOOT2_KP', 600)), actFoot2);
    if (num('SQC_TRACE', 1) === 1) {
      let tr = _trace.get(st);
      if (!tr) { tr = []; _trace.set(st, tr); }
      let tm = _traceT.get(st);
      if (!tm) { tm = new Map(); _traceT.set(st, tm); }
      const lastT = tm.get(s) ?? -1;
      if (st.t - lastT >= 0.008) {
      tm.set(s, st.t);
      const h2i = di(w, `hip_${s}`, 2);
      const led = h2i >= 0 ? w.executor.ledger[h2i] : null;
      const drv = w.drive as unknown as { lastBreakdown?: Array<Record<string, number>>; dampingParts?: Array<Record<string, number>> };
      const br = h2i >= 0 ? (drv.lastBreakdown?.[h2i] ?? {}) : {};
      const dp = h2i >= 0 ? (drv.dampingParts?.[h2i] ?? {}) : {};
      const f0i = di(w, `foot_${s}`, 0);
      const f2i = di(w, `foot_${s}`, 2);
      const l0 = f0i >= 0 ? w.executor.ledger[f0i] : null;
      const l2 = f2i >= 0 ? w.executor.ledger[f2i] : null;
      const h0i = di(w, `hip_${s}`, 0), h1i = di(w, `hip_${s}`, 1), k0i = di(w, `knee_${s}`, 0), k2i = di(w, `knee_${s}`, 2);
      const lh0 = h0i >= 0 ? w.executor.ledger[h0i] : null, lh1 = h1i >= 0 ? w.executor.ledger[h1i] : null, lk0 = k0i >= 0 ? w.executor.ledger[k0i] : null, lk2 = k2i >= 0 ? w.executor.ledger[k2i] : null;
      tr.push({
        t: st.t, s,
        hip2Q: leg.qHip2, hip2V: h2i >= 0 ? w.body.dofs[h2i]!.vel : 0,
        hip2T: hip2Out, hip2Cmd, hipFf: hipFfCmd, baseHipFf, thigh2: thigh.hip2Ff, bHip, bKnee, bAnkle, hip2Act: Math.max(-1, Math.min(1, bHip / Math.max(1e-6, Math.abs(num('SQC_HIP2_CAP', 150))))), kneeFf: kneeFfCmd,
        idHip2: 0, toneHip2: 0, righting2: rightingHip2Ff,
        applied: led?.applied ?? 0, cmd: led?.cmd ?? 0, writes: led?.writes ?? 0, sat: led?.saturated ? 1 : 0,
        pair: led?.pair ?? 0, passive: led?.passive ?? 0, limit: led?.limit ?? 0,
        servo: br.servo ?? 0, stiff: br.stiff ?? 0, damp: br.damp ?? 0, ff: br.ff ?? 0, act: br.act ?? 0, itb: br.itb ?? 0, lum: br.lum ?? 0,
        Bact: dp.actuator ?? 0, Bref: dp.reflex ?? 0, Btgt: dp.target ?? 0, Bjoint: dp.joint ?? 0,
        Bapp: dp.applied ?? 0, Bbmax: dp.bmax ?? 0, Btv: dp.targetValue ?? 0, Btk: dp.targetKp ?? 0,
        supP2: h2i >= 0 ? w.drive.supportTorque(h2i) : 0, tension: pdg.hip.tension(s, 'hip'),
        hipHigh, hipLow, relax, baseGate: baseSag.baseGate,
        copX: fc.copXFiltered, copZ: fc.copZFiltered, copMx: fc.copMarginX, copMz: fc.copMarginZ,
        comX: hipFrame.comX, comVX: hipFrame.comVX, fz: fc.fzFiltered,
        knee0: leg.qKnee0, hip0: leg.qHip0,
        foot0Q: ang(w, `foot_${s}`, 0), foot0T: foot0Cmd, foot0App: l0?.applied ?? 0, foot0Ff: baseSag.foot0,
        foot2Q: ang(w, `foot_${s}`, 2), foot2V: w.body.dofs[f2i]?.vel ?? 0, foot2T, foot2App: l2?.applied ?? 0, foot2Ff: ankleFfOut,
        actFoot0: act0Dbg, actFoot2: act2Dbg, gripBudget: gripDbg,
        hip0App: lh0?.applied ?? 0, hip1App: lh1?.applied ?? 0, knee0App: lk0?.applied ?? 0, knee2App: lk2?.applied ?? 0,
      });
      if (tr.length > 320) tr.shift();
      (globalThis as { __SQC_TRACE?: unknown }).__SQC_TRACE = JSON.stringify(tr);
      }
    }
    if (String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SQUAT_DBG ?? '0') === '1') {
      const g = globalThis as unknown as { __SQUAT_DBG?: Record<string, unknown> };
      const o = g.__SQUAT_DBG ?? {};
      o[s] = {
        hip0T: hip0Out, foot0T, knee0T: shankPlan.knee0, hip2T: hip2Out, knee2T, foot2T,
        supFf, hipFf: hipFfOut, relax: baseSag.relax, kneeSup, supScale,
        baseHip: baseSag.hip, baseGate: baseSag.baseGate, kneeHipFlex: baseSag.kneeHipFlex,
        baseKnee2Support: baseSag.knee2Support, baseHipFf: baseSag.hipFf,
        shankSelSide, lateralFoot0,
        latF: fActual.fLat, latPerp: fActual.fPerp, latChain: fActual.fParallel, latCopZ: fActual.copZ, latFric: fActual.frictionUtil, latCopIn: fActual.copInside,
        copX: fc.copXFiltered, copZ: fc.copZFiltered, copMarginX: fc.copMarginX, copMarginZ: fc.copMarginZ, copMarginNorm: fc.copMarginNorm, copVelX: fc.copVelX, copVelZ: fc.copVelZ, footX: fc.footX, footZ: fc.footZ,
        hipHigh, hipLow, hipTargetY: hipTarget.y, hipAnchorY: h2nowY, supportX, eSag: supportX - hipFrame.comX, thigh2: thigh.hip2Ff, hipBudget, hipBudgetRad, gripBudget: gripDbg, actFoot0: act0Dbg, actFoot2: act2Dbg, footY: (() => { const bi = w.body.indexByKey.get(`foot_${s}`); return bi !== undefined ? w.body.bodies[bi]!.translation().y : 0; })(), footVY: (() => { const bi = w.body.indexByKey.get(`foot_${s}`); return bi !== undefined ? w.body.bodies[bi]!.linvel().y : 0; })(), fz: fc.fzFiltered, gripFz: fc.fzFiltered / Math.max(1, fzTarget), gripFric: 1 - ctl.perception.feet[s === 'l' ? 0 : 1]!.frictionUse / Math.max(1e-6, frictionMax), gripSpeed: 1 - fc.footSpeed / 0.5, footSpeed: fc.footSpeed, frictionUse: ctl.perception.feet[s === 'l' ? 0 : 1]!.frictionUse,
        baseAnkle: baseSag.ankle, ikAnkle: ik.foot2, ankleFf: ankleFfOut, foot0Ff: baseSag.foot0, foot2Ff: ankleFfOut,
        hip2Q: h2 >= 0 ? w.body.dofs[h2]!.angle : 0, knee2Q: kneeAng,
        hipT: pdg.hip.tension(s, 'hip'), kneeT: pdg.hip.tension(s, 'knee'), shankT: pdg.shank.tension(s, 'foot'),
      };
      g.__SQUAT_DBG = o;
    }
    // 脚离地时不再写膝/踝 damp；接触丢失后不让阻尼继续制造高频力矩
  }
  {
    const gi = globalThis as unknown as { __ID?: Record<string, { margin?: number; mode?: string; feasible?: number }>; __ID_GLOBAL?: Record<string, unknown> };
    const oi = gi.__ID;
    const l = oi?.l, r = oi?.r;
    const feasible = !!l?.feasible && !!r?.feasible;
    const margin = Math.min(l?.margin ?? -1, r?.margin ?? -1);
    const prevState = _idMode.get(st);
    const prev = prevState?.mode ?? 'STABILIZE';
    const since = prevState?.since ?? w.clock;
    const enter = Math.abs(num('SQC_ID_RECOVER_ENTER', 0.06));
    const exit = Math.abs(num('SQC_ID_RECOVER_EXIT', 0.05));
    const hold = Math.abs(num('SQC_ID_MODE_HOLD', 0.20));
    let want: 'STABILIZE' | 'RECOVER' = prev === 'RECOVER'
      ? (margin > exit ? 'RECOVER' : 'STABILIZE')
      : (margin > enter ? 'RECOVER' : 'STABILIZE');
    // 只按 margin 切 mode；单侧 ID feasible 只做诊断，不再推翻全局 mode。
    if (want !== prev && w.clock - since < hold) want = prev;
    if (!prevState || want !== prev) _idMode.set(st, { mode: want, since: w.clock });
    const next = want;
    if (oi) {
      if (oi.l) oi.l.mode = next;
      if (oi.r) oi.r.mode = next;
    }
    gi.__ID_GLOBAL = { mode: next, margin, feasible: feasible ? 1 : 0, since: w.clock };
  }
  {
    const fL = sampleActualForceChain(w, 'l', fcS.l, w.clock, ctl.sensors.comVel[2]!);
    const fR = sampleActualForceChain(w, 'r', fcS.r, w.clock, ctl.sensors.comVel[2]!);
    const kneeOutL = (() => { const k = w.body.dofByName('knee_l', 2), a = w.body.dofByName('foot_l', 2); return k >= 0 && a >= 0 ? (w.body.dofs[k]!.anchorWorld[2]! - w.body.dofs[a]!.anchorWorld[2]!) : 0; })();
    const kneeOutR = (() => { const k = w.body.dofByName('knee_r', 2), a = w.body.dofByName('foot_r', 2); return k >= 0 && a >= 0 ? -(w.body.dofs[k]!.anchorWorld[2]! - w.body.dofs[a]!.anchorWorld[2]!) : 0; })();
    const hL = w.body.dofs[w.body.dofByName('hip_l', 0)]?.anchorWorld[1] ?? 0;
    const hR = w.body.dofs[w.body.dofByName('hip_r', 0)]?.anchorWorld[1] ?? 0;
    const vL = w.body.dofs[w.body.dofByName('hip_l', 0)]?.vel ?? 0;
    const vR = w.body.dofs[w.body.dofByName('hip_r', 0)]?.vel ?? 0;
    const b = solveBilateral(w, {
      fcL: fcS.l, fcR: fcS.r, hL, hR, vL, vR,
      kneeOutL, kneeOutR,
      kneeOutTarget: num('SQC_BID_KNEE_OUT_TARGET', 0.005),
      fLatL: fL.fLat, fLatR: fR.fLat,
      fPerpSagL: fL.fPerpSag, fPerpSagR: fR.fPerpSag,
      pParallelL: fL.fParallel, pParallelR: fR.fParallel,
      pelvisRoll: pelvisSense.roll,
      kHeight: num('SQC_BID_HEIGHT_K', 80),
      kHeightV: num('SQC_BID_HEIGHT_D', 0),
      deltaCap: Math.abs(num('SQC_BID_DELTA_CAP', w.sk.massTotal * 9.81 * 0.35)),
      kKneeOut: num('SQC_BID_KNEE_OUT_K', 1200),
      kneeOutCap: num('SQC_BID_KNEE_OUT_CAP', 60),
      kneeOutAngleCap: num('SQC_BID_KNEE_OUT_ANGLE_CAP', 0.12),
      hipStableEps: Math.abs(num('SQC_BID_HIP_STABLE', 0.01)),
      hipMoveCap: Math.abs(num('SQC_BID_HIP_MOVE_CAP', 0.04)),
    });
    (globalThis as unknown as { __BS?: unknown }).__BS = b;
  }
  {
    const g = globalThis as unknown as { __HIP_LEDGER?: Record<string, unknown> };
    const o = g.__HIP_LEDGER ?? {};
    for (const n of ['hip_l/0', 'hip_l/1', 'hip_l/2', 'hip_r/0', 'hip_r/1', 'hip_r/2'] as const) {
      const [jn, ax] = n.split('/');
      const i = di(w, jn!, Number(ax));
      const e = i >= 0 ? w.executor.ledger[i] : null;
      const pp = i >= 0 ? w.drive.passiveParts[i] : null;
      o[n] = e ? {
        cmd: e.cmd, applied: e.applied, passive: e.passive, pair: e.pair, limit: e.limit, writes: e.writes,
        ref: i >= 0 ? w.drive.supportRefOf(i) : 0,
        supportScale: w.drive.supportScaleOf(),
        pp: pp ? { ref: pp.ref, k: pp.k, b: pp.b, e: pp.e, tau: pp.tau } : null,
      } : null;
    }
    g.__HIP_LEDGER = o;
  }
  {
    const g = globalThis as unknown as {
      __SAG_FRAME?: unknown;
      __SAG_HISTORY?: unknown[];
      __SAG_HISTORY_ON?: boolean;
      __ID?: Record<string, unknown>;
      __HIP_SRC?: Record<string, unknown>;
      __HIP_LEDGER?: Record<string, unknown>;
      __BS?: unknown;
    };
    const id = g.__ID ?? {};
    const src = g.__HIP_SRC ?? {};
    const led = g.__HIP_LEDGER ?? {};
    const frame = {
      t: w.clock,
      courtT: st.t,
      mode: 'none',
      com: { x: hipFrame.comX, y: hipFrame.comY, z: hipFrame.comZ, vx: hipFrame.comVX, vz: hipFrame.comVZ },
      xcom: { z: hipFrame.comZ + hipFrame.comVZ / Math.sqrt(9.81 / Math.max(0.3, hipFrame.comY)) },
      target: { x: hipFrame.comTargetX, z: hipFrame.comTargetZ },
      pelvis: { roll: pelvisSense.roll, hL: hipFrame.left?.hipHeight ?? 0, hR: hipFrame.right?.hipHeight ?? 0 },
      eH: (hipFrame.left?.hipHeight ?? 0) - (hipFrame.right?.hipHeight ?? 0),
      fz: { l: fcS.l.fzFiltered, r: fcS.r.fzFiltered },
      fc: (g as unknown as { __FC_SAG?: unknown }).__FC_SAG ?? null,
      contact: { l: fcS.l.contact, r: fcS.r.contact },
      leg: { l: id.l ?? null, r: id.r ?? null },
      src: { l: src.l ?? null, r: src.r ?? null },
      ledger: { l: { hip0: led['hip_l/0'] ?? null, hip1: led['hip_l/1'] ?? null, hip2: led['hip_l/2'] ?? null }, r: { hip0: led['hip_r/0'] ?? null, hip1: led['hip_r/1'] ?? null, hip2: led['hip_r/2'] ?? null } },
      bs: g.__BS ?? null,
    };
    g.__SAG_FRAME = frame;
    if (g.__SAG_HISTORY_ON) {
      const h = g.__SAG_HISTORY ?? (g.__SAG_HISTORY = []);
      h.push(frame);
      if (h.length > 240) h.shift();
    }
  }
  const p2Scale = Math.max(0, Math.min(1, 1 - num('SQC_P2_HIP_SOFT', 0.8) * p2Soft));
  const drv = ctl.warner.drive as unknown as { setSupportScale?(s: number): void };
  drv.setSupportScale?.(p2Scale);
}
