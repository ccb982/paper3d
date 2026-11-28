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
import { sampleMotionAcceleration } from './motionAcceleration';
import { supportDynTorque } from './supportDyn';
import { supportJerkStep, type SupportJerkState } from './supportJerk';
import { updateContactLatch, type ContactLatchState } from './contactSet';
import { projectSupportWrench } from './supportWrench';
import { computeSupportDesired } from './supportDesired';
import { computeMuscleDamping, computeSoftGate } from './muscleDamping';
import { getMuscleImpedance } from './muscleImpedance';
import { captureShankLeg, hipLateralTarget, solveShankIK, solveShankIK2, solveShankIKTarget, solveShankIKToFoot, type ShankLegRef } from './shankIK';
import { measureActualForceChain } from './actualForceChain';
import { solveStaticLegTorques, type LegContactPoint } from './legInverseDynamics';
import { ankleSupportCommand } from './ankleSupportCommand';
import { evalFootContactTask } from './footContactTask';
import { planHipStrategy } from './hipStrategy';
import { footPoseRecovery } from './footPoseRecovery';
import { solveFloatingBaseId } from './floatingBaseId';
import { solveBilateral } from './bilateralSolver';
import { solveSagittalInverseDynamics } from './sagittalInverseDynamics';
import { computeSupportWbc } from './supportWbc';
import { estimateExternalBoundary, resetExternalBoundary } from './externalBoundary';
import { sensePelvis } from './pelvisSense';
import { senseSagittal } from './sagittalSense';
import { upperBodyCommand } from './upperBodyCommand';
import { UpperTaskPD } from './upperTaskPD';
import { planSupport } from './supportPlanner';
import { computeSagittalBase } from './sagittalBase';
import { computeThighPower } from './thighPower';
import { buildSagittalSensorFrame, type SagittalChainInput } from './sagittalSensorFrame';
import { solveSagittalId } from './sagittalIdSolver';
import type { SagittalBaseReference, SagittalTargets } from './sagittalIdTypes';
import { computeFzBudget, resetFzBudget } from './fzBudget';
import { solveSupportQp } from './supportQp';
import { readContact, contactActiveFlat, gripOk } from './contactRead';
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
const _owState = new WeakMap<World, Map<number, { t: number; hold: number; target: number }>>();
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
const _floatingCache = new WeakMap<World, { t: number; out: ReturnType<typeof solveFloatingBaseId> | null }>();
const _fzLoadState = new WeakMap<World, { l: { i: number; lp: number }; r: { i: number; lp: number } }>();
const _fzLoopState = new WeakMap<World, { l: number; r: number }>();
const _supportAccPlan = new WeakMap<World, { l: { a: number }; r: { a: number } }>();
const _gripWHold = new WeakMap<World, { l: { fz: number; copX: number; copZ: number } | null; r: { fz: number; copX: number; copZ: number } | null }>();
const _hipHold = new WeakMap<World, Map<'l' | 'r', { x: number; y: number; z: number }>>();
interface FCacheEntry { at: number; fChain: number; fPerp: number; fPerpSag: number; fLat: number; fLatLp: number; fParallel: number; fParallelSigned: number; copZ: number; frictionUtil: number; copInside: boolean; fChainLp: number; fPerpLp: number; feasible: boolean; feasibleRaw: boolean; tauUtil: number }
const _fcCache = new WeakMap<World, Map<'l' | 'r', FCacheEntry>>();
const _handoff = new WeakMap<CS, { t0: number; angles: Float64Array }>();
const _handoffHipApplied = new WeakMap<CS, { l: number; r: number }>();
const _handoffKneeApplied = new WeakMap<CS, { l: number; r: number }>();
const _kneeFfLp = new WeakMap<CS, { l: number; r: number }>();
const _postureFfLp = new WeakMap<CS, { l: { hip: number; knee: number; ankle: number }; r: { hip: number; knee: number; ankle: number } }>();
const _supportJerk = new WeakMap<CS, { l: { hip: SupportJerkState; knee: SupportJerkState; ankle: SupportJerkState }; r: { hip: SupportJerkState; knee: SupportJerkState; ankle: SupportJerkState } }>();
const _supportResidual = new WeakMap<CS, { l: { hip: number; knee: number; ankle: number }; r: { hip: number; knee: number; ankle: number } }>();
const _contactLatch = new WeakMap<CS, { l: ContactLatchState; r: ContactLatchState }>();
const _postureLatRef = new WeakMap<CS, { l: { hip0: number; hip1: number; knee0: number; knee1: number }; r: { hip0: number; hip1: number; knee0: number; knee1: number } }>();
const _postureHipYRef = new WeakMap<CS, number>();
const _supportComYRef = new WeakMap<CS, number>();
const _supportHandoffT = new WeakMap<CS, number>();
const _supportHipYRef = new WeakMap<CS, number>();
const _supportHipYPrev = new WeakMap<CS, number>();
const _supportHipXZRef = new WeakMap<CS, { l: { x: number; z: number }; r: { x: number; z: number } }>();
const _supportPure = new WeakMap<CS, { t: number; stable: boolean }>();
interface PostureHandoff { l: { hip: number; knee: number; ankle: number }; r: { hip: number; knee: number; ankle: number } }
const _postureHandoff = new WeakMap<CS, PostureHandoff>();
/** 释放瞬间捕获的稳定力链基线（fPerp0/fParallel0），侧向回正只追相对偏差。 */
const _ikBase = new WeakMap<World, Map<'l' | 'r', { hip: number; knee: number; ankle: number }>>();
interface PoseRef { hip0: number; hip1: number; hip2: number; knee0: number; knee2: number; foot0: number; foot2: number }
const _poseRef = new WeakMap<CS, Partial<Record<'l' | 'r', PoseRef>>>();

const num = (k: string, d: number): number => {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const v = Number(env[k]);
  return Number.isFinite(v) ? v : d;
};
const di = (w: World, n: string, a: number): number => w.body.dofByName(n, a);
const ang = (w: World, n: string, a: number): number => { const i = di(w, n, a); return i >= 0 ? w.body.dofs[i]!.angle : 0; };

function projectSecondaryToSupport(base: number, sec: number, lo: number, hi: number): number {
  const b = Math.max(lo, Math.min(hi, base));
  if (Math.abs(b) < 1e-9) return Math.max(lo, Math.min(hi, sec));
  const dir = Math.sign(b);
  const secAlong = sec * dir;
  const secUse = secAlong > 0 ? secAlong * dir : 0;
  return Math.max(lo, Math.min(hi, b + secUse));
}

/** 腿三关节的脚底力零空间：投影后不改变 (fx,fz)，即不改变支撑力/支撑加速度。 */
function projectLegForceNull(
  w: World, side: 'l' | 'r', copX: number, copZ: number, contactY: number,
  tau: [number, number, number],
): [number, number, number] {
  const names = [`hip_${side}`, `knee_${side}`, `foot_${side}`] as const;
  const cols: Array<[number, number, number]> = [];
  for (const nm of names) {
    const i = di(w, nm, 2);
    if (i < 0) { cols.push([0, 0, 0]); continue; }
    const d = w.body.dofs[i]!;
    const ax = d.axisWorld;
    const an = d.anchorWorld;
    const sgn = nm.startsWith('foot') ? 1 : -1;
    const axx = ax[0]! * sgn, axy = ax[1]! * sgn, axz = ax[2]! * sgn;
    const rx = copX - an[0]!, ry = contactY - an[1]!, rz = copZ - an[2]!;
    cols.push([axy * rz - axz * ry, axz * rx - axx * rz, axx * ry - axy * rx]);
  }
  const [c0, c1, c2] = cols as [[number, number, number], [number, number, number], [number, number, number]];
  const a00 = c0[0], a01 = c1[0], a02 = c2[0];
  const a10 = c0[2], a11 = c1[2], a12 = c2[2];
  const g00 = a00 * a00 + a01 * a01 + a02 * a02;
  const g01 = a00 * a10 + a01 * a11 + a02 * a12;
  const g11 = a10 * a10 + a11 * a11 + a12 * a12;
  const det = g00 * g11 - g01 * g01;
  if (!(det > 1e-12)) return [0, 0, 0];
  const i00 = g11 / det, i01 = -g01 / det, i11 = g00 / det;
  const A = [[a00, a01, a02], [a10, a11, a12]];
  const Ginv = [[i00, i01], [i01, i11]];
  const out: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    let v = 0;
    for (let j = 0; j < 3; j++) {
      let p = 0;
      for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) p += A[r]![k]! * Ginv[r]![c]! * A[c]![j]!;
      v += ((k === j ? 1 : 0) - p) * tau[j]!;
    }
    out[k] = v;
  }
  return out;
}

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

export function captureSquatIK(w: World, ctl: ControlModule): void {
  const comZ = ctl.sensors.com[2]!;
  for (const side of ['l', 'r'] as const) {
    const leg = captureShankLeg(w, side);
    const H = hipLateralTarget(w, leg);
    const ik = solveShankIKTarget(w, leg, H);
    let hm = _hipHold.get(w);
    if (!hm) { hm = new Map(); _hipHold.set(w, hm); }
    hm.set(side, H);
    let im = _ikCache.get(w);
    if (!im) { im = new Map(); _ikCache.set(w, im); }
    im.set(side, { at: w.clock, contact: true, H, hipTask: null, ik });
  }
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
    delete g.__QP;
    delete g.__SQC_MUSCLE_GATE;
    delete g.__MUSCLE_PD;
  }
  resetPdGroups(w);
  _pdGroups.delete(w);
  _upperPd.delete(w);
  _tauPrev.delete(w);
  _velLp.delete(w);
  _owState.delete(w);
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
function pd(w: World, name: string, axis: number, target: number, kp: number, kd: number, cap: number, src: string, ff = 0, pri: number = PRI.reflex, passive = 0): void {
  const i = di(w, name, axis);
  if (i < 0) return;
  const d = w.body.dofs[i]!;
  const inertia = Math.max(1e-6, (d as unknown as { inertiaLow?: number }).inertiaLow ?? 0.05);
  const accObs = (globalThis as { __ACC_OBS?: Record<string, number> }).__ACC_OBS ?? {};
  const qdd = /^hip_/.test(name) ? (accObs.qddHip ?? 0) : /^knee_/.test(name) ? (accObs.qddKnee ?? 0) : /^(foot_|ankle_)/.test(name) ? (accObs.qddAnkle ?? 0) : 0;
  const jointKey = /^hip_/.test(name) ? 'HIP' : /^knee_/.test(name) ? 'KNEE' : /^(foot_|ankle_)/.test(name) ? 'ANKLE' : /^spine/.test(name) ? 'SPINE' : /^neck/.test(name) ? 'NECK' : 'LIMB';
  const side = /_(l|r)$/.test(name) ? name.slice(-1) : '';
  const supportGate = side ? ((globalThis as { __SQC_MUSCLE_GATE?: { l: number; r: number } }).__SQC_MUSCLE_GATE?.[side as 'l' | 'r'] ?? 1) : 1;
  const legMuscleJoint = jointKey === 'ANKLE' || jointKey === 'KNEE' || jointKey === 'HIP';
  const wnDef = jointKey === 'ANKLE' ? 30 : jointKey === 'KNEE' ? 25 : jointKey === 'HIP' ? 20 : jointKey === 'SPINE' ? 15 : jointKey === 'NECK' ? 12 : 15;
  const zetaDef = legMuscleJoint ? 1.0 : 0.9;
  const amaxDef = jointKey === 'ANKLE' ? 60 : jointKey === 'KNEE' ? 60 : jointKey === 'HIP' ? 60 : jointKey === 'SPINE' ? 30 : jointKey === 'NECK' ? 20 : 30;
  const srsDef = legMuscleJoint ? 0.5 : 0.3;
  const cM = Math.abs(num('SQC_MUSCLE_C', 0.5));
  const c0M = Math.abs(num('SQC_MUSCLE_C0', cM));
  const wn = Math.abs(num(`SQC_MUSCLE_WN_${jointKey}`, wnDef));
  const zeta = Math.abs(num(`SQC_MUSCLE_ZETA_${jointKey}`, zetaDef));
  const amax = Math.abs(num(`SQC_MUSCLE_AMAX_${jointKey}`, amaxDef));
  const accGain = num(`SQC_MUSCLE_ACC_GAIN_${jointKey}`, num('SQC_MUSCLE_ACC_GAIN', 0.03));
  const cmd = getMuscleImpedance(w.body, name, axis);
  const dev = target - d.angle;
  const softBase = cmd?.soft ?? computeSoftGate({
    vel: d.vel, acc: qdd, dev,
    softMin: num(`SQC_MUSCLE_SOFT_MIN_${jointKey}`, num('SQC_MUSCLE_SOFT_MIN', 0.5)),
    vScale: num(`SQC_MUSCLE_SOFT_V_${jointKey}`, num('SQC_MUSCLE_SOFT_V', 2)),
    aScale: num(`SQC_MUSCLE_SOFT_A_${jointKey}`, num('SQC_MUSCLE_SOFT_A', 20)),
    xScale: num(`SQC_MUSCLE_SOFT_X_${jointKey}`, num('SQC_MUSCLE_SOFT_X', 0.5)),
  });
  const soft = Math.min(softBase, supportGate);
  const md = computeMuscleDamping({
    mass: inertia, wn, zeta, amax, c: cM, c0: c0M,
    acc: qdd, accRef: cmd?.accRef ?? 0,
    accGain: cmd?.accGain ?? accGain,
    vel: d.vel, cmdK: cmd?.k, cmdD: cmd?.d, soft, dev,
    srsFrac: num(`SQC_MUSCLE_SRS_FRAC_${jointKey}`, srsDef),
    srsYield: num(`SQC_MUSCLE_SRS_YIELD_${jointKey}`, num('SQC_MUSCLE_SRS_YIELD', 0.06)),
    eccGain: num(`SQC_MUSCLE_ECC_GAIN_${jointKey}`, num('SQC_MUSCLE_ECC_GAIN', 0.6)),
    conGain: num(`SQC_MUSCLE_CON_GAIN_${jointKey}`, num('SQC_MUSCLE_CON_GAIN', 0.3)),
    vRef: num(`SQC_MUSCLE_V_REF_${jointKey}`, num('SQC_MUSCLE_V_REF', 2)),
    dGain: Math.abs(num('SQC_MUSCLE_D_GAIN', 2.0)),
    tauCap: Math.abs(cap) * Math.abs(num('SQC_MUSCLE_TAU_CAP_FRAC', 0.5)),
    softD: supportGate * Math.max(0.5, Math.min(1, 0.75 + 0.25 * softBase)),
  });
  kp = md.kp;
  kd = md.kd;
  const supportLegDamp = src === 'squat.hip2' || src === 'squat.knee2';
  if (supportLegDamp) kd = 0;
  {
    const gm = globalThis as { __MUSCLE_PD?: Record<string, Record<string, number>> };
    gm.__MUSCLE_PD = gm.__MUSCLE_PD ?? {};
    gm.__MUSCLE_PD[`${name}/${axis}`] = { kp, kd, wn, zeta, amax, accGain: cmd?.accGain ?? accGain, acc: qdd, tauAcc: md.tauAcc, soft: md.soft, kPassive: md.kPassive, dScale: md.dScale, cmdK: cmd?.k ?? -1, cmdD: cmd?.d ?? -1 };
  }
  let vm = _velLp.get(w);
  if (!vm) { vm = new Map(); _velLp.set(w, vm); }
  const vPrev = vm.get(i) ?? d.vel;
  const vLp = vPrev + (d.vel - vPrev) * Math.max(0, Math.min(1, num('SQC_PD_VEL_LP', 0.2)));
  vm.set(i, vLp);
  const h = (globalThis as { __SQC_HANDOFF?: { u: number; angles: Float64Array } | null }).__SQC_HANDOFF;
  if (h && h.u < 1 && i < h.angles.length) {
    const u = h.u * h.u * (3 - 2 * h.u);
    target = h.angles[i]! + (target - h.angles[i]!) * u;
  }
  const posTerm = kp * (target - d.angle);
  const dampTerm = -kd * vLp;
  const latAxis = axis === 0 && /^(hip|knee|foot)_/.test(name);
  const dampCap = Math.abs(num('SQC_LAT_DAMP_CAP', 15));
  const dampUse = latAxis ? Math.max(-dampCap, Math.min(dampCap, dampTerm)) : dampTerm;
  // ★ 近目标、向外运动时的单向内部阻尼：回正到位后限制往外抖，不拖慢回正接近段。
  const err = target - d.angle;
  const owBand = Math.abs(num('SQC_OW_BAND', 0.05));
  const owDead = Math.abs(num('SQC_OW_DEAD', 0.02));
  const owCap = Math.abs(num('SQC_OW_CAP', 10));
  const owGain = Math.abs(num('SQC_OW_GAIN', 1));
  const owHoldReq = Math.abs(num('SQC_OW_HOLD', 0.05));
  const owHipOnly = num('SQC_OW_HIP_ONLY', 0) !== 0;
  const owTgtMax = Math.abs(num('SQC_OW_TGT_MAX', 0.02));
  let owDamp = 0;
  let owWin = 0;
  let owHold = 0;
  if (num('SQC_OW_DAMP', 1) !== 0 && (owHipOnly ? /^hip_/.test(name) : /^(hip|knee|foot|ankle)_/.test(name))) {
    let sm = _owState.get(w);
    if (!sm) { sm = new Map(); _owState.set(w, sm); }
    let st = sm.get(i);
    if (!st) { st = { t: -1, hold: 0, target: Number.NaN }; sm.set(i, st); }
    const targetJump = !Number.isFinite(st.target) || Math.abs(target - st.target) > owTgtMax;
    if (st.t !== w.clock) {
      if (!targetJump && Math.abs(err) < owBand) st.hold += Math.min(w.dt, 0.05);
      else st.hold = 0;
      st.t = w.clock;
    }
    st.target = target;
    owHold = st.hold;
    const outward = err * d.vel < 0;
    if (st.hold >= owHoldReq && Math.abs(err) < owBand && Math.abs(d.vel) > owDead && outward) {
      const u = Math.max(0, Math.min(1, 1 - Math.abs(err) / Math.max(1e-6, owBand)));
      owWin = u * u * (3 - 2 * u);
      owDamp = -owGain * kd * owWin * d.vel;
      owDamp = Math.max(-owCap, Math.min(owCap, owDamp));
    }
  }
  const rawPd0 = posTerm + dampUse + owDamp + md.tauAcc * supportGate;
  const legJoint = /^squat\.(knee0|foot0|foot2)$/.test(src);
  const dead = Math.abs(legJoint ? num('SQC_LEG_DEAD', 0.5) : num('SQC_PD_DEADBAND', 4));
  const rawPd = Math.abs(rawPd0) < dead ? 0 : rawPd0;
  let m = _tauPrev.get(w);
  if (!m) { m = new Map(); _tauPrev.set(w, m); }
  const prev = m.get(i);
  const slew = Math.abs(num('SQC_TAU_SLEW', 3));
  const pdVal = prev === undefined ? rawPd : Math.max(prev - slew, Math.min(prev + slew, rawPd));
  m.set(i, pdVal);
  const split = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_PD_FF_SPLIT ?? '0') === '1';
  const qpUse = (globalThis as { __SQC_SUPPORT_QP?: { useQp?: number } }).__SQC_SUPPORT_QP?.useQp === 1;
  let tau: number;
  if (qpUse && Math.abs(ff) > 1e-9) {
    tau = Math.max(-cap, Math.min(cap, ff + pdVal));
  } else if (split) {
    const pdCap = Math.abs(num('SQC_PD_CAP_FRAC', 0.5)) * cap;
    const ffCap = Math.max(0, cap - pdCap);
    const ffPart = Math.max(-ffCap, Math.min(ffCap, ff));
    const pdPart = Math.max(-pdCap, Math.min(pdCap, pdVal));
    tau = Math.max(-cap, Math.min(cap, ffPart + pdPart));
  } else {
    tau = projectSecondaryToSupport(ff, pdVal, -cap, cap);
  }
  // 被动组织只产生被动力矩，独立于主动 tau；Executor 的 passive 通道自封顶 τmax。
  if (Math.abs(passive) > 1e-9) w.executor.addPassiveTorque(i, passive);

  if (String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SQUAT_DBG ?? '0') === '1') {
    const g = globalThis as unknown as { __PD_TAU?: Record<string, number> };
    const o = g.__PD_TAU ?? {};
    o[`${name}/${axis}`] = rawPd;
    g.__PD_TAU = o;
  }

  if (String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_PD_DBG ?? '0') === '1') {
    const g = globalThis as unknown as { __PD_PARTS?: Record<string, unknown> };
    const o = g.__PD_PARTS ?? {};
    o[`${name}/${axis}`] = { target, angle: d.angle, vel: d.vel, vLp, posTerm, dampTerm, dampUse, owDamp, owWin, owHold, rawPd0, dead, rawPd, slew, prev, cap, ff, passive, tau, legJoint };
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


function legContactPoints(w: World, side: 'l' | 'r'): LegContactPoint[] {
  const ji = w.sk.joints.findIndex((j) => j.name === `hip_${side}`);
  if (ji < 0) return [];
  const sub = new Set(w.body.subtree[ji] ?? []);
  return w.body.allContactSamples(w.dt)
    .filter((c) => sub.has(c.body))
    .map((c) => ({ x: c.x, y: c.y, z: c.z, weight: c.jn }));
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

function postureHoldFrame(w: World, ctl: ControlModule, st: CS): void {
  if (!_legRef.get(st)) {
    _legRef.set(st, { l: captureShankLeg(w, 'l'), r: captureShankLeg(w, 'r') });
  }
  const pdg = getPdGroups(w);
  let lat = _postureLatRef.get(st);
  if (!lat) {
    const q = (n: string, a: number): number => { const i = di(w, n, a); return i >= 0 ? w.body.dofs[i]!.angle : 0; };
    lat = {
      l: { hip0: q('hip_l', 0), hip1: q('hip_l', 1), knee0: q('knee_l', 0), knee1: q('knee_l', 1) },
      r: { hip0: q('hip_r', 0), hip1: q('hip_r', 1), knee0: q('knee_r', 0), knee1: q('knee_r', 1) },
    };
    _postureLatRef.set(st, lat);
  }
  const upperCmd = upperBodyCommand(w, st);
  let postureOn = !(num('SQC_SUPPORT_PURE', 1) === 1) || (_supportPure.get(st)?.stable ?? false);
  const upperTargets = new Map(upperCmd.targets);
  for (const n of ['spine1', 'spine2', 'spine3'] as const) {
    const i = w.body.dofByName(n, 2);
    if (i >= 0) upperTargets.set(i, upperCmd.targets.get(i) ?? w.body.dofs[i]!.angle);
  }
  if (!postureOn) {
    for (const n of ['spine1', 'spine2', 'spine3', 'neck'] as const) {
      const i = w.body.dofByName(n, 2);
      if (i >= 0) upperTargets.set(i, w.body.dofs[i]!.angle);
    }
  }
  getUpperPd(w).step(w, { ...upperCmd, targets: upperTargets });
  const fcL = sampleFootContact(w, 'l');
  const fcR = sampleFootContact(w, 'r');
  const zL = w.body.bodies[w.body.indexByKey.get('foot_l') ?? 0]?.translation().z ?? 0;
  const zR = w.body.bodies[w.body.indexByKey.get('foot_r') ?? 0]?.translation().z ?? 0;
  const fzBudget = computeFzBudget(w, {
    fzTotal: fcL.fzFiltered + fcR.fzFiltered,
    fzNominal: w.sk.massTotal * 9.81,
    comZ: ctl.sensors.com[2]!, comVZ: ctl.sensors.comVel[2]!, comTargetZ: ctl.warner.getComTarget().z, comY: ctl.sensors.com[1]!,
    zL, zR,
    contactL: fcL.contact, contactR: fcR.contact,
    copValidL: fcL.copValid, copValidR: fcR.copValid,
    dt: w.dt,
  });
  (globalThis as { __FZ_BUDGET?: typeof fzBudget }).__FZ_BUDGET = fzBudget;
  const evalGrip = (side: 'l' | 'r', fc: ReturnType<typeof sampleFootContact>) => {
    const bi = w.body.indexByKey.get(`foot_${side}`);
    const target = ctl.footAnkle.world.pose.get(side);
    if (bi === undefined || !target) return null;
    const rb = w.body.bodies[bi]!;
    const pNow = rb.translation();
    const qNow = rb.rotation() as { x: number; y: number; z: number; w: number };
    const vNow = rb.linvel();
    const wNow = rb.angvel();
    const task = evalFootContactTask({
      contact: fc.contact, copInside: fc.copInside, fz: fc.fzFiltered,
      fzMin: Math.abs(num('SQC_FOOT_FZ_MIN', 5)),
      targetP: target.p, actualP: { x: pNow.x, y: pNow.y, z: pNow.z },
      targetQ: target.q, actualQ: qNow,
      linVel: { x: vNow.x, y: vNow.y, z: vNow.z },
      angVel: { x: wNow.x, y: wNow.y, z: wNow.z },
      posMargin: Math.abs(num('SQC_FOOT_POS_MARGIN', 0.02)),
      rotMargin: Math.abs(num('SQC_FOOT_ROT_MARGIN', 0.12)),
      linVelMargin: Math.abs(num('SQC_FOOT_LINVEL_MARGIN', 0.2)),
      angVelMargin: Math.abs(num('SQC_FOOT_ANGVEL_MARGIN', 1.5)),
    });
    const g = globalThis as { __SQC_FOOT_CONTACT?: Record<string, unknown> };
    g.__SQC_FOOT_CONTACT = g.__SQC_FOOT_CONTACT ?? {};
    g.__SQC_FOOT_CONTACT[side] = task;
    return task;
  };
  const gripTaskL = evalGrip('l', fcL);
  const gripTaskR = evalGrip('r', fcR);
  const gripOkL = gripTaskL?.gripOk ?? true;
  const gripOkR = gripTaskR?.gripOk ?? true;
  const gripScaleOf = (t: ReturnType<typeof evalFootContactTask> | null): number => {
    if (!t) return 1;
    const e = Math.max(
      t.posErr / Math.max(1e-6, Math.abs(num('SQC_FOOT_POS_MARGIN', 0.02))),
      t.rotErr / Math.max(1e-6, Math.abs(num('SQC_FOOT_ROT_MARGIN', 0.12))),
      t.linVelErr / Math.max(1e-6, Math.abs(num('SQC_FOOT_LINVEL_MARGIN', 0.2))),
      t.angVelErr / Math.max(1e-6, Math.abs(num('SQC_FOOT_ANGVEL_MARGIN', 1.5))),
    );
    return Math.max(0.2, Math.min(1, 1 - e));
  };
  const gripScaleL = gripScaleOf(gripTaskL);
  const gripScaleR = gripScaleOf(gripTaskR);
  if (num('SQC_FOOT_ROT_DAMP', 1) > 0) {
    const kd = Math.abs(num('SQC_FOOT_ROT_DAMP', 1));
    const cap = Math.abs(num('SQC_FOOT_ROT_DAMP_CAP', 20));
    const angTh = Math.abs(num('SQC_FOOT_ROT_DAMP_ANGVEL', 0.5));
    for (const side of ['l', 'r'] as const) {
      const fc = side === 'l' ? fcL : fcR;
      const ft = side === 'l' ? gripTaskL : gripTaskR;
      if (!fc.contact || !ft || ft.angVelErr < angTh) continue;
      const bi = w.body.indexByKey.get(`foot_${side}`);
      if (bi === undefined) continue;
      const wv = w.body.bodies[bi]!.angvel();
      for (const ax of [0, 2] as const) {
        const j = w.body.dofByName(`foot_${side}`, ax);
        if (j < 0) continue;
        const a = w.body.dofs[j]!.axisWorld;
        const omega = wv.x * a[0]! + wv.y * a[1]! + wv.z * a[2]!;
        const tau = Math.max(-cap, Math.min(cap, -kd * omega));
        if (Math.abs(tau) > 1e-9) propose({ dof: j, kind: 'ext', pri: PRI.direct, channel: 'support', tau, src: 'foot.rotationDamp' });
      }
    }
  }
  if (num('SQC_FOOT_RECOVER', 0) !== 0) {
    const recoverFzMin = Math.abs(num('SQC_FOOT_RECOVER_FZ', 0.4)) * w.sk.massTotal * 9.81 * 0.5;
    for (const side of ['l', 'r'] as const) {
      const target = ctl.footAnkle.world.pose.get(side);
      if (!target) continue;
      const fc = side === 'l' ? fcL : fcR;
      if (fc.fzFiltered < recoverFzMin) continue;
      const rec = footPoseRecovery({
        w, side, targetQ: target.q,
        kp: Math.abs(num('SQC_FOOT_RECOVER_KP', 200)),
        kd: Math.abs(num('SQC_FOOT_RECOVER_KD', 20)),
        cap: Math.abs(num('SQC_FOOT_RECOVER_CAP', 30)),
      });
      for (const ax of [0, 1, 2] as const) {
        if (Math.abs(rec[ax]!) > 1e-6) {
          const j = w.body.dofByName(`foot_${side}`, ax);
          if (j >= 0) propose({ dof: j, kind: 'ext', pri: PRI.direct, channel: 'active', tau: rec[ax]!, src: 'lowerCommand.footRecover' });
        }
      }
    }
  }
  const footPitchOf = (side: 'l' | 'r'): number => {
    const bi = w.body.indexByKey.get(`foot_${side}`);
    if (bi === undefined) return 0;
    const q = w.body.bodies[bi]!.rotation();
    const ux = 2 * (q.x * q.y - q.w * q.z);
    const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
    return Math.atan2(ux, uy);
  };
  const footPitchL = footPitchOf('l');
  const footPitchR = footPitchOf('r');
  const flatMax = Math.abs(num('SQC_FOOT_FLAT_MAX_DEG', 12)) / 57.29578;
  const flatL = Math.abs(footPitchL) < flatMax;
  const flatR = Math.abs(footPitchR) < flatMax;
  const gateL = flatL && (fcL.contact || fcL.loadValid) ? 1 : 0.15;
  const gateR = flatR && (fcR.contact || fcR.loadValid) ? 1 : 0.15;
  (globalThis as { __SQC_MUSCLE_GATE?: { l: number; r: number } }).__SQC_MUSCLE_GATE = { l: gateL, r: gateR };
  const fzNominalTotal = Math.max(1e-6, w.sk.massTotal * 9.81);
  const fzAbsMax = fzNominalTotal * Math.abs(num('SQC_SUPPORT_FZ_ABS_MAX', 1.5));
  const comFzOn = num('SQC_SUPPORT_COM_FZ_ON', 1) === 1;
  const comY = ctl.sensors.com[1]!;
  const comVY = ctl.sensors.comVel[1]!;
  let comYTarget = _supportComYRef.get(st);
  if (comYTarget === undefined) { comYTarget = comY; _supportComYRef.set(st, comYTarget); }
  let handoffT = _supportHandoffT.get(st);
  if (handoffT === undefined) { handoffT = w.clock; _supportHandoffT.set(st, handoffT); }
  const handoffAge = w.clock - handoffT;
  const accMinHandoff = handoffAge < Math.abs(num('SQC_HANDOFF_FZ_MIN_T', 0.15)) ? 0 : -Math.abs(num('SQC_SUPPORT_HIP_ACC_CAP', 3));
  const hipLi = di(w, 'hip_l', 2);
  const hipRi = di(w, 'hip_r', 2);
  const hipYPos = 0.5 * ((hipLi >= 0 ? w.body.dofs[hipLi]!.anchorWorld[1]! : 0) + (hipRi >= 0 ? w.body.dofs[hipRi]!.anchorWorld[1]! : 0));
  let hipYTarget = _supportHipYRef.get(st);
  if (hipYTarget === undefined) { hipYTarget = hipYPos; _supportHipYRef.set(st, hipYTarget); }
  const prevHipY = _supportHipYPrev.get(st);
  const hipVY = prevHipY === undefined ? 0 : (hipYPos - prevHipY) / Math.max(1e-6, w.dt);
  _supportHipYPrev.set(st, hipYPos);
  const pureOn = num('SQC_SUPPORT_PURE', 1) === 1;
  const stableT = Math.abs(num('SQC_SUPPORT_STABLE_T', 0.25));
  const stableVel = Math.abs(num('SQC_SUPPORT_STABLE_VEL', 0.08));
  const stableFzFrac = Math.abs(num('SQC_SUPPORT_STABLE_FZ', 0.25));
  let pure = _supportPure.get(st);
  if (!pure) { pure = { t: 0, stable: false }; _supportPure.set(st, pure); }
  const fzErrL = Math.abs(fcL.fzFiltered - fzBudget.fzLTarget);
  const fzErrR = Math.abs(fcR.fzFiltered - fzBudget.fzRTarget);
  const stableNow = fcL.contact && fcR.contact
    && Math.abs(hipVY) < stableVel && Math.abs(comVY) < stableVel * 1.5
    && fzErrL < stableFzFrac * Math.max(1, fzBudget.fzLTarget)
    && fzErrR < stableFzFrac * Math.max(1, fzBudget.fzRTarget);
  pure.t = stableNow ? pure.t + w.dt : 0;
  pure.stable = pure.t >= stableT;
  postureOn = !pureOn || pure.stable;
  (globalThis as { __SQC_SUPPORT_PURE?: Record<string, number> }).__SQC_SUPPORT_PURE = {
    pureOn: pureOn ? 1 : 0, postureOn: postureOn ? 1 : 0, stable: pure.stable ? 1 : 0,
    stableT: pure.t, stableNow: stableNow ? 1 : 0, fzErrL, fzErrR,
  };
  const supportFzGate = Math.max(5, num('SQC_ANKLE_SUPPORT_FZ', 0.03) * w.sk.massTotal * 9.81);
  const crL = readContact(w, 'l', supportFzGate);
  const crR = readContact(w, 'r', supportFzGate);
  const contactL = crL.active;
  const contactR = crR.active;
  const comX = ctl.sensors.com[0]!;
  const comVX = ctl.sensors.comVel[0]!;
  const gripFzMin = Math.max(5, Math.abs(num('SQC_GRIP_FZ_MIN', 0.02)) * w.sk.massTotal * 9.81);
  const gripSpeedMax = Math.abs(num('SQC_GRIP_FOOT_SPEED', 0.15));
  const gripL = gripOk(crL, { fzMin: gripFzMin, footSpeedMax: gripSpeedMax });
  const gripR = gripOk(crR, { fzMin: gripFzMin, footSpeedMax: gripSpeedMax });
  if (!gripL || !gripR) postureOn = false;
  (globalThis as { __SQC_GRIP?: Record<string, number> }).__SQC_GRIP = {
    gripL: gripL ? 1 : 0, gripR: gripR ? 1 : 0,
    copInsideL: crL.copInside ? 1 : 0, copInsideR: crR.copInside ? 1 : 0,
    fzL: crL.fz, fzR: crR.fz, speedL: crL.footSpeed, speedR: crR.footSpeed,
  };
  const copMargin = Math.abs(num('SQC_SUPPORT_COP_MARGIN', 0.02));
  const qpOn = num('SQC_SUPPORT_QP', 1) === 1;
  const hipKp = Math.abs(num('SQC_SUPPORT_HIP_KP', 500));
  const hipKd = Math.abs(num('SQC_SUPPORT_HIP_KD', 20));
  const hipAccCap = Math.abs(num('SQC_SUPPORT_HIP_ACC_CAP', 3));
  const aY = Math.max(accMinHandoff, Math.min(hipAccCap, hipKp * (hipYTarget - hipYPos) - hipKd * hipVY));
  const qpFzTotal = Math.max(0, w.sk.massTotal * (9.81 + aY));
  const fzRefScale = qpFzTotal / Math.max(1, fzNominalTotal);
  const fzRefL = Math.max(0, fzBudget.fzLTarget * fzRefScale);
  const fzRefR = Math.max(0, fzBudget.fzRTarget * fzRefScale);
  const omegaCop = Math.sqrt(9.81 / Math.max(0.3, comY));
  const xcp = comX + comVX / omegaCop;
  const qpHalfXL = Math.max(0.005, fcL.copHalfX - copMargin);
  const qpHalfXR = Math.max(0.005, fcR.copHalfX - copMargin);
  const copBias = num('SQC_COP_X_BIAS', 0);
  const copCenterBlend = Math.max(0, Math.min(1, Math.abs(num('SQC_COP_CENTER_BLEND', 0))));
  const qpCopXL = num('SQC_COP_RECENTER', 0) !== 0 && !gripOkL ? fcL.footX : Math.max(fcL.footX - qpHalfXL, Math.min(fcL.footX + qpHalfXL, fcL.footX + (xcp + copBias - fcL.footX) * (1 - copCenterBlend)));
  const qpCopXR = num('SQC_COP_RECENTER', 0) !== 0 && !gripOkR ? fcR.footX : Math.max(fcR.footX - qpHalfXR, Math.min(fcR.footX + qpHalfXR, fcR.footX + (xcp + copBias - fcR.footX) * (1 - copCenterBlend)));
  const qpFzMin = contactL && contactR ? Math.min(0.45 * qpFzTotal, Math.abs(num('SQC_SUPPORT_QP_FZ_MIN', 0)) * qpFzTotal) : 0;
  const qp = qpOn ? solveSupportQp({
    mass: w.sk.massTotal,
    gravity: 9.81,
    aY,
    feet: [
      { active: contactL, x: fcL.footX, halfX: qpHalfXL, fzRef: fzRefL, copXRef: qpCopXL, fzMax: fzAbsMax, fzMin: qpFzMin, mu: Math.abs(num('SQC_SUPPORT_MU', 0.7)) },
      { active: contactR, x: fcR.footX, halfX: qpHalfXR, fzRef: fzRefR, copXRef: qpCopXR, fzMax: fzAbsMax, fzMin: qpFzMin, mu: Math.abs(num('SQC_SUPPORT_MU', 0.7)) },
    ],
  }) : null;
  const useQp = qp?.feasible === true && (contactL || contactR);
  const floatingPressureRatio = qp && qp.fz[0] + qp.fz[1] > 1e-6 ? qp.fz[0] / (qp.fz[0] + qp.fz[1]) : 0.5;
  const floatingOn = num('SQC_FLOATING_ID', 1) !== 0;
  const floatingMix = Math.max(0, Math.min(1, num('SQC_FLOATING_MIX', 1)));
  let floating: ReturnType<typeof solveFloatingBaseId> | null = null;
  if (floatingOn) {
    const hz = Math.max(1, Math.abs(num('SQC_FLOATING_HZ', 10)));
    const cached = _floatingCache.get(w);
    if (cached && w.clock - cached.t < 1 / hz) {
      floating = cached.out;
    } else {
    const dofN = w.body.dofs.length;
    const qdd = new Array<number>(dofN + 6).fill(0);
    const acc = (globalThis as { __ACC_OBS?: Record<string, number> }).__ACC_OBS ?? {};
    qdd[0] = 0;
    qdd[1] = aY;
    qdd[2] = 0;
    const addAx2 = (name: string, v: number): void => { const j = w.body.dofByName(name, 2); if (j >= 0) qdd[6 + j] = v; };
    addAx2('hip_l', acc.qddHip ?? 0);
    addAx2('hip_r', acc.qddHip ?? 0);
    addAx2('knee_l', acc.qddKnee ?? 0);
    addAx2('knee_r', acc.qddKnee ?? 0);
    addAx2('foot_l', acc.qddAnkle ?? 0);
    addAx2('foot_r', acc.qddAnkle ?? 0);
    const footW = (s: 'l' | 'r') => {
      const fc = s === 'l' ? fcL : fcR;
      const bi = w.body.indexByKey.get(`foot_${s}`);
      if (bi === undefined || !fc.contact) return null;
      const gripTask = s === 'l' ? gripTaskL : gripTaskR;
      const gripOk = !(num('SQC_FOOT_GRIP_FREEZE', 1) !== 0) || (gripTask?.gripOk ?? true);
      let fz = qp ? qp.fz[s === 'l' ? 0 : 1]! : fc.fzFiltered;
      let cx = qp ? qp.copX[s === 'l' ? 0 : 1]! : fc.copXFiltered;
      let hold = _gripWHold.get(w);
      if (!hold) { hold = { l: null, r: null }; _gripWHold.set(w, hold); }
      if (gripOk) {
        hold[s] = { fz, copX: cx, copZ: fc.copZFiltered };
      } else if (hold[s]) {
        fz = hold[s]!.fz;
        cx = hold[s]!.copX;
      }
      if (num('SQC_FOOT_GRIP_GATE', 0) !== 0 && !gripOk && !hold[s]) return null;
      const footX = fc.footX;
      const footZ = fc.footZ;
      const gripQpScale = num('SQC_FOOT_GRIP_QP', 0) !== 0 ? gripScaleOf(gripTask) : 1;
      return { body: bi, x: footX, y: fc.footY, z: footZ, fx: 0, fy: fz, fz: 0, tx: 0, ty: 0, tz: (cx - footX) * fz, halfX: fc.copHalfX * gripQpScale, halfZ: fc.copHalfZ * gripQpScale, mu: 0.7, fzMin: 0 };
    };
    let contacts = [footW('l'), footW('r')].filter((x): x is NonNullable<typeof x> => !!x);
    floating = solveFloatingBaseId({ w, qdd, contacts, baseCorrect: num('SQC_FLOATING_BASE_SOLVE', 1) !== 0, ankleWeight: num('SQC_FLOATING_W_ANKLE_W', 0.2), pressureWeight: num('SQC_FLOATING_W_PRESSURE_W', 20), pressureRatio: floatingPressureRatio, baseWeight: num('SQC_FLOATING_W_BASE_W', 1000) });
    if (num('SQC_FLOATING_BASE_TRIM', 1) !== 0 && contacts.length > 0) {
      const per = -floating.baseResidual[1]! / contacts.length;
      contacts = contacts.map((c) => ({ ...c, fy: Math.max(0, c.fy + per) }));
      floating = solveFloatingBaseId({ w, qdd, contacts, baseCorrect: num('SQC_FLOATING_BASE_SOLVE', 1) !== 0, ankleWeight: num('SQC_FLOATING_W_ANKLE_W', 0.2), pressureWeight: num('SQC_FLOATING_W_PRESSURE_W', 20), pressureRatio: floatingPressureRatio, baseWeight: num('SQC_FLOATING_W_BASE_W', 1000) });
    }
    _floatingCache.set(w, { t: w.clock, out: floating });
    (globalThis as { __SQC_FLOATING_ID?: unknown }).__SQC_FLOATING_ID = floating;
    const ft = floating.tau;
    (globalThis as { __SQC_FLOATING_TAU?: Record<string, number> }).__SQC_FLOATING_TAU = {
      hipL: ft[di(w, 'hip_l', 2)] ?? 0,
      kneeL: ft[di(w, 'knee_l', 2)] ?? 0,
      ankleL: ft[di(w, 'foot_l', 2)] ?? 0,
      hipR: ft[di(w, 'hip_r', 2)] ?? 0,
      kneeR: ft[di(w, 'knee_r', 2)] ?? 0,
      ankleR: ft[di(w, 'foot_r', 2)] ?? 0,
    };
    }
  }
  if (qp) {
    (globalThis as { __SQC_SUPPORT_QP?: Record<string, unknown> }).__SQC_SUPPORT_QP = {
      feasible: qp.feasible ? 1 : 0, useQp: useQp ? 1 : 0,
      fzL: qp.fz[0], fzR: qp.fz[1],
      copXL: qp.copX[0], copXR: qp.copX[1], totalFz: qp.totalFz,
      fzRefL, fzRefR, aY, qpFzTotal, contactL: contactL ? 1 : 0, contactR: contactR ? 1 : 0,
    };
  }
  const comYKp = Math.abs(num('SQC_SUPPORT_COM_Y_KP', 12));
  const comYKd = Math.abs(num('SQC_SUPPORT_COM_Y_KD', 6));
  const comYCap = Math.abs(num('SQC_SUPPORT_COM_Y_ACC_CAP', 5));
  const comYAcc = Math.max(-comYCap, Math.min(comYCap, -comYKp * (comY - comYTarget) - comYKd * comVY));
  const fzCom = 0.5 * w.sk.massTotal * (9.81 + comYAcc);
  for (const s of ['l', 'r'] as const) {
    const hi = di(w, `hip_${s}`, 2);
    const ki = di(w, `knee_${s}`, 2);
    const ai = di(w, `foot_${s}`, 2);
    let hipFf = 0;
    let kneeFf = 0;
    let kneeBudget = 0;
    let hipT = 0;
    let kneeT = 0;
    const lr = s === 'l' ? lat.l : lat.r;
    pdg.hip.hip0(s, lr.hip0, Math.abs(num('SQC_HIP0_KP', 1200)), Math.abs(num('SQC_HIP0_KD', 20)), Math.abs(num('SQC_HIP0_CAP', 150)), 'squat.hip0', 0, PRI.reflex, 1);
    pdg.hip.hip1(s, lr.hip1, Math.abs(num('SQC_HIP1_ROLL_KP', 600)), Math.abs(num('SQC_HIP1_ROLL_KD', 30)), Math.abs(num('SQC_HIP1_CAP', 80)), 'squat.hip1', 0);
    pdg.shank.knee0(s, lr.knee0, 300, 12, Math.abs(num('SQC_KNEE0_CAP', 100)), 'squat.knee0');
    pdg.shank.knee1(s, lr.knee1, Math.abs(num('SQC_KNEE1_ROLL_KP', 400)), Math.abs(num('SQC_KNEE1_ROLL_KD', 20)), Math.abs(num('SQC_KNEE1_CAP', 80)), 'squat.knee1');
    const fcS = sampleFootContact(w, s);
    const legS = _legRef.get(st)?.[s] ?? captureShankLeg(w, s);
    let hipXZ = _supportHipXZRef.get(st);
    if (!hipXZ) { hipXZ = { l: { x: Number.NaN, z: Number.NaN }, r: { x: Number.NaN, z: Number.NaN } }; _supportHipXZRef.set(st, hipXZ); }
    if (!Number.isFinite(hipXZ[s].x)) { hipXZ[s].x = legS.hip.x; hipXZ[s].z = legS.hip.z; }
    const worldGripOn = num('SQC_WORLD_GRIP_IK', 1) === 1;
    const footTargetPose = ctl.footAnkle.world.pose.get(s);
    const fzTarget = s === 'l' ? fzBudget.fzLTarget : fzBudget.fzRTarget;
    const fzMax = Math.abs(num('SQC_SUPPORT_FZ_MAX', 1.4));
    const fzAbsFloor = 0.5 * w.sk.massTotal * 9.81 * Math.abs(num('SQC_SUPPORT_FZ_ABS_FLOOR', 0.7));
    const flat = s === 'l' ? flatL : flatR;
    const otherFlat = s === 'l' ? flatR : flatL;
    const fzShareBudget = fzTarget / fzNominalTotal;
    const fzShare = flat === otherFlat ? fzShareBudget : (flat ? 1 : 0);
    const supportContact = useQp
      ? (s === 'l' ? contactL : contactR)
      : contactActiveFlat(readContact(w, s, supportFzGate), flat);
    const hipYForFz = hipYPos;
    const hipTargetForFz = hipYTarget;
    const hipVYForFz = hipVY;
    const fzHipOn = num('SQC_SUPPORT_HIP_FZ_ON', 1) === 1;
    const hipKp = Math.abs(num('SQC_SUPPORT_HIP_KP', 500));
    const hipKd = Math.abs(num('SQC_SUPPORT_HIP_KD', 20));
    const hipAccCap = Math.abs(num('SQC_SUPPORT_HIP_ACC_CAP', 3));
    const hipErrPlan = hipTargetForFz - hipYForFz;
    const aDesRaw = Math.max(accMinHandoff, Math.min(hipAccCap, hipKp * hipErrPlan - hipKd * hipVYForFz));
    let accPlan = _supportAccPlan.get(w);
    if (!accPlan) { accPlan = { l: { a: aDesRaw }, r: { a: aDesRaw } }; _supportAccPlan.set(w, accPlan); }
    const accState = s === 'l' ? accPlan.l : accPlan.r;
    const accPrev = accState.a;
    const accAlpha = Math.max(0.01, Math.min(1, num('SQC_SUPPORT_ACC_LP', 0.1)));
    const accJerk = Math.abs(num('SQC_SUPPORT_ACC_JERK', 10));
    accState.a += (aDesRaw - accState.a) * accAlpha;
    accState.a = Math.max(accPrev - accJerk * w.dt, Math.min(accPrev + accJerk * w.dt, accState.a));
    const desired = computeSupportDesired({
      hipY: hipYForFz, hipVY: hipVYForFz, hipTarget: hipTargetForFz,
      mass: w.sk.massTotal,
      kp: hipKp,
      kd: hipKd,
      accCap: hipAccCap,
      accMin: accMinHandoff,
      aDesOverride: accState.a,
      fzMin: 0,
      fzMax: fzAbsMax,
      fzFeedback: Math.abs(num('SQC_SUPPORT_FZ_FEEDBACK', 0.25)),
      fzActual: fcS.fzFiltered,
      share: fzShare,
      fzTrimMax: Math.abs(num('SQC_SUPPORT_FZ_TRIM_MAX', 0.2)),
    });
    const fzForceErr = useQp ? 0 : desired.fzCmd - fcS.fzFiltered;
    const fzDownK = Math.abs(num('SQC_SUPPORT_FZ_DOWN_K', 0.0006));
    const fzDownCap = Math.abs(num('SQC_SUPPORT_FZ_DOWN_CAP', 0.06));
    const footTargetY = footTargetPose ? footTargetPose.p.y - Math.max(-fzDownCap, Math.min(fzDownCap, fzDownK * fzForceErr)) : 0;
    const hipTargetIk = { x: hipXZ[s].x, y: legS.hip.y, z: hipXZ[s].z };
    const worldIk = postureOn && worldGripOn && footTargetPose ? solveShankIKToFoot(w, legS, hipTargetIk, { x: footTargetPose.p.x, y: footTargetY, z: footTargetPose.p.z }) : null;
    const fzNom = Math.max(1, w.sk.massTotal * 9.81 * Math.max(0.1, Math.min(0.9, num('SQC_POSTURE_FZ_FRAC', 0.5))));
    const useActualLoad = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_POSTURE_ACTUAL_LOAD ?? '1') !== '0';
    const useActualFz = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_POSTURE_FZ_ACTUAL ?? '1') !== '0';
    const fzActual = fcS.contact && fcS.fzFiltered > 1 ? fcS.fzFiltered : fzTarget;
    const fzBand = Math.abs(num('SQC_POSTURE_FZ_BAND', 0.35));
    const fzBlend = Math.max(0, Math.min(1, num('SQC_POSTURE_FZ_BLEND', 1)));
    const fzWithin = Math.abs(fzActual - fzTarget) <= fzBand * Math.max(1, fzTarget);
    const fzRawUse = useActualLoad ? (useActualFz && fzWithin ? fzTarget + (fzActual - fzTarget) * fzBlend : fzTarget) : fzNom;
    const fzFloor = Math.abs(num('SQC_SUPPORT_FZ_FLOOR', 0.85));
    const fzUseRaw = fzHipOn
      ? Math.max(0, desired.fzCmd)
      : (useActualLoad ? Math.max(fzTarget * fzFloor, fzAbsFloor, comFzOn ? fzCom : 0, fzRawUse) : fzRawUse);
    const fzUsePre = fzHipOn
      ? Math.min(fzUseRaw, fzAbsMax)
      : Math.min(fzUseRaw, fzTarget * fzMax, fzAbsMax);
    const copHalfXUse = Math.max(0.005, fcS.copHalfX - copMargin);
    const copHalfZUse = Math.max(0.005, fcS.copHalfZ - copMargin);
    const omegaCop = Math.sqrt(9.81 / Math.max(0.3, comY));
    const xcp = ctl.sensors.com[0]! + ctl.sensors.comVel[0]! / omegaCop;
    const centerBlend = Math.max(0, Math.min(1, Math.abs(num('SQC_COP_CENTER_BLEND', 0))));
    let copXDesired = num('SQC_COP_RECENTER', 0) !== 0 && !(s === 'l' ? gripOkL : gripOkR) ? fcS.footX : Math.max(fcS.footX - copHalfXUse, Math.min(fcS.footX + copHalfXUse, fcS.footX + (xcp + num('SQC_COP_X_BIAS', 0) - fcS.footX) * (1 - centerBlend)));
    const copZDesired = useActualLoad && fcS.copValid ? fcS.copZFiltered : fcS.footZ;
    const wrench = projectSupportWrench({
      fz: fzUsePre, copX: copXDesired, copZ: copZDesired,
      footX: fcS.footX, footZ: fcS.footZ,
      halfX: copHalfXUse, halfZ: copHalfZUse,
      fzMax: fzHipOn ? fzAbsMax : fzTarget * fzMax,
      mu: Math.abs(num('SQC_SUPPORT_MU', 0.7)),
    });
    const qi = s === 'l' ? 0 : 1;
    const fzUseBase = useQp ? qp!.fz[qi]! : wrench.fz;
    const fzLoopOn = num('SQC_SUPPORT_FZ_CLOSED_LOOP', 0) !== 0;
    let fzLoop = 0;
    if (fzLoopOn) {
      let m = _fzLoopState.get(w);
      if (!m) { m = { l: 0, r: 0 }; _fzLoopState.set(w, m); }
      const gain = Math.abs(num('SQC_SUPPORT_FZ_LOOP_KI', 0.05));
      const cap = Math.abs(num('SQC_SUPPORT_FZ_LOOP_CAP', 0.2)) * Math.max(1, fzUseBase);
      m[s] = Math.max(-cap, Math.min(cap, m[s] + (fzUseBase - fcS.fzFiltered) * w.dt * gain));
      fzLoop = m[s];
    }
    const fzScale = Math.abs(num('SQC_SUPPORT_FZ_SCALE', 1.1));
    const fzUse0 = Math.max(0, (fzUseBase + fzLoop) * fzScale);
    let fzCopShift = 0;
    const fzShareOn = num('SQC_SUPPORT_FZ_COP_SHARE', 1) !== 0;
    const fzShareMax = Math.abs(num('SQC_SUPPORT_FZ_COP_SHARE_MAX', 5));
    const fzShareTotal = fzBudget.fzLTarget + fzBudget.fzRTarget;
    const fzActBoth = fcL.fzFiltered + fcR.fzFiltered;
    const fzShareMin = Math.abs(num('SQC_SUPPORT_FZ_COP_SHARE_MIN', 0.2)) * 0.5 * w.sk.massTotal * 9.81;
    const fzBothLoaded = Math.min(fcL.fzFiltered, fcR.fzFiltered) > fzShareMin;
    if (fzShareOn && fzShareTotal > 1 && fzBothLoaded && gripL && gripR && fcL.copInside && fcR.copInside && fcL.copValid && fcR.copValid) {
      const pAct = (fcL.copXFiltered * fcL.fzFiltered + fcR.copXFiltered * fcR.fzFiltered) / fzActBoth;
      const omegaShare = Math.sqrt(9.81 / Math.max(0.3, comY));
      const pDes = ctl.sensors.com[0]! + ctl.sensors.comVel[0]! / omegaShare;
      const dx = fcL.footX - fcR.footX;
      if (Math.abs(dx) > 1e-4) fzCopShift = Math.max(-fzShareMax, Math.min(fzShareMax, (pAct - pDes) * fzShareTotal / dx));
    }
    const fzUseRawFinal = Math.max(0, fzUse0 + (s === 'l' ? fzCopShift : -fzCopShift));
    const supportGripNow = s === 'l' ? gripL : gripR;
    const supportGripGate = num('SQC_SUPPORT_GRIP_GATE', 0) !== 0;
    const fzUse = supportGripGate && !supportGripNow ? 0 : fzUseRawFinal;
    const fxUse = useQp ? qp!.fx[qi]! : 0;
    const copXUse = useQp ? qp!.copX[qi]! : wrench.copX;
    // Support uses the measured CoP when valid; the target CoP is reserved for righting.
    const copXSupport = num('SQC_SUPPORT_ACTUAL_COP', 1) !== 0 && fcS.copValid && fcS.contact ? fcS.copXFiltered : copXUse;
    const copZSupport = num('SQC_SUPPORT_ACTUAL_COP', 1) !== 0 && fcS.copValid && fcS.contact ? fcS.copZFiltered : wrench.copZ;
    const fcUse = { ...fcS, copX: copXSupport, copZ: copZSupport };
    const contacts = useQp ? [] : (num('SQC_SUPPORT_CONTACTS', 1) === 1 ? legContactPoints(w, s) : []);
    let cl = _contactLatch.get(st);
    if (!cl) { cl = { l: { active: false, since: 0, lostAt: -1, count: 0, fzLp: 0 }, r: { active: false, since: 0, lostAt: -1, count: 0, fzLp: 0 } }; _contactLatch.set(st, cl); }
    const contactState = updateContactLatch(cl[s], fcS.fzFiltered, contacts.length, w.clock, w.dt, {
      onFz: Math.abs(num('SQC_CONTACT_ON_FZ', 5)),
      offFz: Math.abs(num('SQC_CONTACT_OFF_FZ', 2)),
      minOnTime: Math.abs(num('SQC_CONTACT_MIN_ON', 0.05)),
    });
    cl[s] = contactState;
    const contactNow = contactState.active;
    const idS = solveStaticLegTorques(w, s, fcUse, fzUse, {}, {}, contacts, fxUse);
    let idUse = idS;
    if (floating) {
      const cOn = num('SQC_FLOATING_C', 0) !== 0;
      const cDyn = cOn ? supportDynTorque(w, s, [0, 0, 0]) : [0, 0, 0];
      const ft = s === 'l' ? gripTaskL : gripTaskR;
      const guardOn = num('SQC_FLOATING_FOOT_GUARD', 1) !== 0;
      const posM = Math.abs(num('SQC_FOOT_POS_MARGIN', 0.02));
      const rotM = Math.abs(num('SQC_FOOT_ROT_MARGIN', 0.12));
      const angM = Math.abs(num('SQC_FOOT_ANGVEL_MARGIN', 1.5));
      const footSafe = !guardOn || (!!ft && !!fcS.contact && ft.posErr <= posM && ft.rotErr <= rotM && ft.angVelErr <= angM);
      const mixUse = footSafe ? floatingMix : 0.05;
      const getTau = (name: string, ci: number): number => {
        const j = w.body.dofByName(name, 2);
        return j >= 0 ? (floating!.tau[j] ?? 0) + (cDyn[ci] ?? 0) : 0;
      };
      idUse = {
        ...idS,
        hip: idS.hip + (getTau(`hip_${s}`, 0) - idS.hip) * mixUse,
        knee: idS.knee + (getTau(`knee_${s}`, 1) - idS.knee) * mixUse,
        ankle: idS.ankle + (getTau(`foot_${s}`, 2) - idS.ankle) * mixUse,
      };
    }
    const fcDesired = { ...fcS, copX: fcS.footX, copZ: fcS.footZ };

    let jm = _supportJerk.get(st);
    if (!jm) { jm = { l: { hip: { tau: idS.hip, dot: 0, acc: 0 }, knee: { tau: idS.knee, dot: 0, acc: 0 }, ankle: { tau: idS.ankle, dot: 0, acc: 0 } }, r: { hip: { tau: idS.hip, dot: 0, acc: 0 }, knee: { tau: idS.knee, dot: 0, acc: 0 }, ankle: { tau: idS.ankle, dot: 0, acc: 0 } } }; _supportJerk.set(st, jm); }
    const jState = s === 'l' ? jm.l : jm.r;
    const jCfg = {
      acc: Math.abs(num('SQC_SUPPORT_ACC', 900)),
      jerk: Math.abs(num('SQC_SUPPORT_JERK', 4000)),
      slew: Math.abs(num('SQC_SUPPORT_SLEW', 180)),
    };
    const hipTauMax = hi >= 0 ? Math.max(1, w.body.dofs[hi]!.tauMax) : 150;
    const kneeTauMax = ki >= 0 ? Math.max(1, w.body.dofs[ki]!.tauMax) : 150;
    const ankleTauMax = ai >= 0 ? Math.max(1, w.body.dofs[ai]!.tauMax) : 150;
    const budgetMargin = Math.abs(num('SQC_SUPPORT_BUDGET_MARGIN', 10));
    const clampBudget = (v: number, mx: number): number => Math.max(-Math.max(0, mx - budgetMargin), Math.min(Math.max(0, mx - budgetMargin), v));
    const hipYNow = hi >= 0 ? w.body.dofs[hi]!.anchorWorld[1]! : 0;
    let hipY0 = _postureHipYRef.get(st);
    if (hipY0 === undefined) { hipY0 = hipYNow; _postureHipYRef.set(st, hipY0); }
    const hipLift = hipYNow - hipY0;
    const liftK = Math.abs(num('SQC_POSTURE_HIPY_K', 2.5));
    const hipLiftScale = Math.max(0.35, Math.min(1, 1 - liftK * Math.max(0, hipLift)));
    const kneeLiftK = Math.abs(num('SQC_POSTURE_HIPY_KNEE_K', 5));
    const ankleLiftK = Math.abs(num('SQC_POSTURE_HIPY_ANKLE_K', 6));
    const kneeLiftScale = Math.max(0.2, Math.min(1, 1 - kneeLiftK * Math.max(0, hipLift)));
    const ankleLiftScale = Math.max(0.2, Math.min(1, 1 - ankleLiftK * Math.max(0, hipLift)));
    const hipDropK = Math.abs(num('SQC_POSTURE_HIPY_DROP_K', 3));
    const hipBoostMax = Math.max(1, Math.abs(num('SQC_POSTURE_HIPY_BOOST_MAX', 1.5)));
    const hipHeightScale = Math.min(hipBoostMax, 1 + hipDropK * Math.max(0, -hipLift));
    const hipTarget = clampBudget(idUse.hip * hipLiftScale * hipHeightScale, hipTauMax);
    const kneeTarget = clampBudget(idUse.knee * kneeLiftScale * hipHeightScale, kneeTauMax);
    const ankleTarget = clampBudget(idUse.ankle * ankleLiftScale * hipHeightScale, ankleTauMax);
    const nextHip = supportJerkStep(jState.hip, hipTarget, w.dt, jCfg);
    const nextKnee = supportJerkStep(jState.knee, kneeTarget, w.dt, jCfg);
    const nextAnkle = supportJerkStep(jState.ankle, ankleTarget, w.dt, jCfg);
    let handoffU = 1;
    let handHip = 0;
    let handKnee = 0;
    let handAnkle = 0;
    let prevHip = 0;
    let prevKnee = 0;
    let prevAnkle = 0;
    const hg = (globalThis as { __SQC_HANDOFF?: { u: number } | null }).__SQC_HANDOFF;
    if (st.handoff && hg && num('SQC_HANDOFF_CORR_ON', 1) === 1) {
      handoffU = Math.max(0, Math.min(1, hg.u));
      let ph = _postureHandoff.get(st);
      if (!ph) {
        ph = { l: { hip: Number.NaN, knee: Number.NaN, ankle: Number.NaN }, r: { hip: Number.NaN, knee: Number.NaN, ankle: Number.NaN } };
        _postureHandoff.set(st, ph);
      }
      const p = s === 'l' ? ph.l : ph.r;
      const htq = (globalThis as { __SQC_HANDOFF_TORQUE?: Record<string, number> }).__SQC_HANDOFF_TORQUE;
      if (!Number.isFinite(p.hip)) p.hip = htq?.[`hip_${s}`] ?? (hi >= 0 ? (w.executor.ledger[hi]?.applied ?? 0) : 0);
      if (!Number.isFinite(p.knee)) p.knee = htq?.[`knee_${s}`] ?? (ki >= 0 ? (w.executor.ledger[ki]?.applied ?? 0) : 0);
      if (!Number.isFinite(p.ankle)) p.ankle = htq?.[`foot_${s}`] ?? (ai >= 0 ? (w.executor.ledger[ai]?.applied ?? 0) : 0);
      prevHip = p.hip;
      prevKnee = p.knee;
      prevAnkle = p.ankle;
      const k = 1 - handoffU;
      const capHip = Math.abs(num('SQC_HANDOFF_CORR_CAP_HIP', 250));
      const capKnee = Math.abs(num('SQC_HANDOFF_CORR_CAP_KNEE', 250));
      const capAnkle = Math.abs(num('SQC_HANDOFF_CORR_CAP_ANKLE', 100));
      handHip = Math.max(-capHip, Math.min(capHip, (p.hip - nextHip) * k));
      handKnee = Math.max(-capKnee, Math.min(capKnee, (p.knee - nextKnee) * k));
      handAnkle = Math.max(-capAnkle, Math.min(capAnkle, (p.ankle - nextAnkle) * k));
    }
    const fcSNow = sampleFootContact(w, s);
    const gripOkNow = s === 'l' ? gripOkL : gripOkR;
    const copHalfUse = Math.max(0.005, fcS.copHalfX - copMargin);
    const ankleSupportCmdOn = num('SQC_ANKLE_SUPPORT_CMD', 1) !== 0;
    const ankleSupportCmd = ankleSupportCmdOn && supportContact && (num('SQC_FOOT_GRIP_ANKLE_GATE', 0) === 0 || gripOkNow) && fcSNow.copValid
      ? ankleSupportCommand({
        fzDes: fzUse,
        fzAct: fcSNow.fzFiltered,
        copDes: num('SQC_ANKLE_SUPPORT_CMD_USE_QP', 0) !== 0 ? copXUse : copXDesired,
        copAct: fcSNow.copXFiltered,
        copVel: fcSNow.copVelX,
        ankleX: fcS.footX,
        copMin: fcS.footX - copHalfUse,
        copMax: fcS.footX + copHalfUse,
        tauMax: Math.abs(num('SQC_ANKLE_SUPPORT_CMD_CAP', 120)),
        kp: Math.abs(num('SQC_ANKLE_SUPPORT_CMD_KP', 4)),
        kd: Math.abs(num('SQC_ANKLE_SUPPORT_CMD_KD', 0.2)),
        sign: num('SQC_ANKLE_SUPPORT_CMD_SIGN', -1),
      })
      : null;
    let accHip = 0;
    let accKnee = 0;
    let accAnkle = 0;
    let dynRawHip = 0;
    let dynRawKnee = 0;
    let dynRawAnkle = 0;
    let dynM: number[] = [0, 0, 0];
    let dynC: number[] = [0, 0, 0];
    if (supportContact && num('SQC_DYN_SUPPORT_ON', 1) === 1) {
      const j = (globalThis as { __JOINT_EKF_PRED?: Record<string, number> }).__JOINT_EKF_PRED ?? {};
      const ma = (globalThis as { __MOTION_ACC?: Record<string, number> }).__MOTION_ACC ?? {};
      const mix = Math.max(0, Math.min(1, num('SQC_DYN_SUPPORT_RAW_MIX', 0)));
      const qdd = [
        (j.hip ?? 0) + mix * ((ma.hip2Acc ?? 0) - (j.hip ?? 0)),
        (j.knee ?? 0) + mix * ((ma.knee2Acc ?? 0) - (j.knee ?? 0)),
        (j.ankle ?? 0) + mix * ((ma.ankle2Acc ?? 0) - (j.ankle ?? 0)),
      ];
      const dyn = supportDynTorque(w, s, qdd);
      dynRawHip = dyn[0]!; dynRawKnee = dyn[1]!; dynRawAnkle = dyn[2]!;
      const dp = (globalThis as { __SUPPORT_DYN?: Record<string, number[]> }).__SUPPORT_DYN?.[s] ?? [];
      dynM = [dp[0]!, dp[1]!, dp[2]!];
      dynC = [dp[3]!, dp[4]!, dp[5]!];
      const capH = Math.abs(num('SQC_DYN_SUPPORT_CAP_HIP', 15));
      const capK = Math.abs(num('SQC_DYN_SUPPORT_CAP_KNEE', 10));
      const capA = Math.abs(num('SQC_DYN_SUPPORT_CAP_ANKLE', 6));
      const dynSign = num('SQC_DYN_SUPPORT_SIGN', 1);
      const obs = (globalThis as { __ACC_OBS?: Record<string, number> }).__ACC_OBS ?? {};
      const comAcc = Math.hypot(obs.obsComAccX ?? 0, obs.obsComAccY ?? 0);
      const comMin = Math.abs(num('SQC_DYN_COM_MIN', 0.3));
      const comFull = Math.max(comMin + 1e-3, Math.abs(num('SQC_DYN_COM_FULL', 2.0)));
      const comGate = Math.max(0, Math.min(1, (comAcc - comMin) / (comFull - comMin)));
      const dynScale = Math.max(Math.abs(num('SQC_DYN_GATE_FLOOR', 0.6)), comGate * Math.max(0, Math.min(1, obs.confidence ?? 1)));
      accHip = Math.max(-capH, Math.min(capH, dynSign * dyn[0]! * dynScale));
      accKnee = Math.max(-capK, Math.min(capK, dynSign * dyn[1]! * dynScale));
      accAnkle = Math.max(-capA, Math.min(capA, dynSign * dyn[2]! * dynScale));
      (globalThis as { __DYN_GATE?: Record<string, number> }).__DYN_GATE = { comAcc, comGate, dynScale };
    }
    let sr = _supportResidual.get(st);
    if (!sr) { sr = { l: { hip: 0, knee: 0, ankle: 0 }, r: { hip: 0, knee: 0, ankle: 0 } }; _supportResidual.set(st, sr); }
    const resPrev = s === 'l' ? sr.l : sr.r;
    const corrGain = Math.abs(num('SQC_TAUCORR_ACC_GAIN', 0.45));
    const corrCapHip = Math.abs(num('SQC_TAUCORR_ACC_CAP_HIP', 24));
    const corrCapKnee = Math.abs(num('SQC_TAUCORR_ACC_CAP_KNEE', 18));
    const corrCapAnkle = Math.abs(num('SQC_TAUCORR_ACC_CAP_ANKLE', 10));
    const tauCorrAccHip = contactNow ? Math.max(-corrCapHip, Math.min(corrCapHip, -resPrev.hip * corrGain)) : 0;
    const tauCorrAccKnee = contactNow ? Math.max(-corrCapKnee, Math.min(corrCapKnee, -resPrev.knee * corrGain)) : 0;
    const tauCorrAccAnkle = contactNow ? Math.max(-corrCapAnkle, Math.min(corrCapAnkle, -resPrev.ankle * corrGain)) : 0;
    const supportPdScale = Math.abs(num('SQC_SUPPORT_PD_SCALE', 0.3));
    const idSign = num('SQC_SUPPORT_ID_SIGN', 1);
    const hipBudget = Math.abs(num('SQC_HIP2_CAP', 400));
    const kneeBudgetMin = Math.abs(num('SQC_KNEE_SUPPORT_MIN', 250));
    kneeBudget = Math.min(
      Math.abs(num('SQC_KNEE_SUPPORT_CAP', 250)),
      Math.max(kneeBudgetMin, Math.abs(idUse.knee) + Math.abs(num('SQC_KNEE_SUPPORT_MARGIN', 10))),
    );
    const ankleCap = Math.abs(num('SQC_ANKLE_BASE_CAP', 120));
    const ankleSign = num('SQC_ANKLE_BASE_SIGN', -1);
    const ankleWeight = Math.max(0, Math.min(1, num('SQC_ANKLE_BASE_W', 1)));
    const fzLoadK = num('SQC_SUPPORT_FZ_LOAD_K', 0);
    const fzLoadKi = num('SQC_SUPPORT_FZ_LOAD_KI', 0);
    const fzLoadErr = fzUse - fcSNow.fzFiltered;
    const fzLoadCap = Math.abs(num('SQC_SUPPORT_FZ_LOAD_CAP', 30));
    let fzState = _fzLoadState.get(w);
    if (!fzState) { fzState = { l: { i: 0, lp: 0 }, r: { i: 0, lp: 0 } }; _fzLoadState.set(w, fzState); }
    const fst = s === 'l' ? fzState.l : fzState.r;
    const fzLpA = Math.max(0, Math.min(1, Math.abs(num('SQC_SUPPORT_FZ_LOAD_LP', 0.08))));
    fst.lp += (fzLoadErr - fst.lp) * fzLpA;
    fst.i = Math.max(-fzLoadCap, Math.min(fzLoadCap, fst.i + fst.lp * w.dt * Math.abs(num('SQC_SUPPORT_FZ_LOAD_KI_T', 1))));
    const fzLoadRaw = fzLoadK * fst.lp + fzLoadKi * fst.i;
    const hipLoadTrim = Math.max(-fzLoadCap, Math.min(fzLoadCap, fzLoadRaw)) * num('SQC_SUPPORT_FZ_LOAD_HIP', 1);
    const kneeLoadTrim = Math.max(-fzLoadCap, Math.min(fzLoadCap, fzLoadRaw)) * num('SQC_SUPPORT_FZ_LOAD_KNEE', 1);
    const hipBase = idSign * idUse.hip + (useQp ? 0 : handHip) + hipLoadTrim;
    const hipDof = hi >= 0 ? w.body.dofs[hi] : undefined;
    const kneeDof = ki >= 0 ? w.body.dofs[ki] : undefined;
    const hipDampMd = hipDof ? computeMuscleDamping({
      mass: Math.max(1e-6, (hipDof as unknown as { inertiaLow?: number }).inertiaLow ?? 0.05),
      wn: 20, zeta: 1, amax: 60, c: 0.5, c0: 0.5,
      acc: ((globalThis as { __ACC_OBS?: Record<string, number> }).__ACC_OBS ?? {}).qddHip ?? 0,
      accRef: 0, accGain: 0.03, vel: hipDof.vel,
      dGain: 2, tauCap: Math.max(1, hipDof.tauMax) * 0.5,
      soft: 1, softD: 1, dev: 0, srsFrac: 0.5, srsYield: 0.06,
      eccGain: 0.6, conGain: 0.3, vRef: 2,
    }) : null;
    const kneeDampMd = kneeDof ? computeMuscleDamping({
      mass: Math.max(1e-6, (kneeDof as unknown as { inertiaLow?: number }).inertiaLow ?? 0.05),
      wn: 25, zeta: 1, amax: 60, c: 0.5, c0: 0.5,
      acc: ((globalThis as { __ACC_OBS?: Record<string, number> }).__ACC_OBS ?? {}).qddKnee ?? 0,
      accRef: 0, accGain: 0.03, vel: kneeDof.vel,
      dGain: 2, tauCap: Math.max(1, kneeDof.tauMax) * 0.5,
      soft: 1, softD: 1, dev: 0, srsFrac: 0.5, srsYield: 0.06,
      eccGain: 0.6, conGain: 0.3, vRef: 2,
    }) : null;
    let hipSec = (useQp ? handHip : 0) + accHip + tauCorrAccHip + (hipDampMd?.tauDyn ?? 0);
    const kneeBase = idSign * idUse.knee + (useQp ? 0 : handKnee) + kneeLoadTrim;
    const kneeSec = (useQp ? handKnee : 0) + accKnee + tauCorrAccKnee + (kneeDampMd?.tauDyn ?? 0);
    const qpTauZ = useQp ? qp!.tauZ[qi]! : 0;
    const actualTauZ = (copXSupport - fcS.footX) * fzUse;
    const ankleCmdTrim = ankleSupportCmd ? ankleSupportCmd.tau - actualTauZ : 0;
    const ankleBase = idSign * nextAnkle * ankleSign * ankleWeight + (useQp ? 0 : handAnkle) + (ankleSupportCmdOn ? ankleCmdTrim : 0) + num('SQC_ANKLE_FF', 10);
    const ankleSec = (useQp ? handAnkle : 0) + accAnkle + tauCorrAccAnkle;
    const hipStrategyOn = num('SQC_HIP_STRATEGY', 1) !== 0;
    const hipStrategy = hipStrategyOn ? planHipStrategy({
      mass: w.sk.massTotal,
      height: comY,
      comX: ctl.sensors.com[0]!,
      comVX: ctl.sensors.comVel[0]!,
      targetX: ctl.warner.getComTarget().x,
      comZ: ctl.sensors.com[2]!,
      comVZ: ctl.sensors.comVel[2]!,
      targetZ: ctl.warner.getComTarget().z,
      contact: fcSNow.contact,
      ankleTau: ankleBase,
      ankleTauMax: ankleCap,
      copMargin,
      tauMax: Math.abs(num('SQC_HIP_STRATEGY_CAP', 15)),
      accMax: Math.abs(num('SQC_HIP_STRATEGY_ACC', 3)),
      marginMin: Math.abs(num('SQC_HIP_STRATEGY_MARGIN', 0.015)),
    }) : null;
    (globalThis as { __SQC_HIP_STRATEGY?: unknown }).__SQC_HIP_STRATEGY = hipStrategy;
    if (hipStrategy?.active) hipSec += hipStrategy.tauSagittal;

    const proj = supportContact
      ? projectLegForceNull(w, s, copXSupport, copZSupport, fcS.footY, [hipSec, kneeSec, ankleSec])
      : [0, 0, 0];
    if (hi >= 0) {
      const q = w.body.dofs[hi]!.angle;
      const target = worldIk ? worldIk.hip2 : q;
      hipT = target;
      hipFf = supportContact ? Math.max(-hipBudget, Math.min(hipBudget, hipBase + proj[0]!)) : 0;
      pdg.hip.hip2(s, target, Math.abs(num('SQC_HIP2_KP', 50)) * supportPdScale, Math.abs(num('SQC_HIP2_KD', 2)) * supportPdScale, Math.abs(num('SQC_HIP2_CAP', 400)), 'squat.hip2', hipFf);
    }
    if (ki >= 0) {
      const q = w.body.dofs[ki]!.angle;
      const target = worldIk ? worldIk.knee2 : q;
      kneeT = target;
      kneeFf = supportContact ? Math.max(-kneeBudget, Math.min(kneeBudget, kneeBase + proj[1]!)) : 0;
      const kp = Math.abs(num('SQC_SUPPORT_KP', 50) + num('SQC_KNEE_PAS_K', 120));
      const kd = Math.abs(num('SQC_KNEE_KD', 8) + num('SQC_KNEE_PAS_B', 6));
      pdg.shank.knee2(s, target, kp * supportPdScale, kd * supportPdScale, Math.min(Math.abs(num('SQC_SUPPORT_CAP', 250)), kneeBudget), 'squat.knee2', kneeFf);
    }
    let ankleFf = 0;
    if (num('SQC_ANKLE_BASE_ON', 1) === 1 && supportContact && (num('SQC_FOOT_GRIP_ANKLE_GATE', 0) === 0 || gripOkNow)) {
      ankleFf = Math.max(-ankleCap, Math.min(ankleCap, ankleBase + proj[2]!));
      const footIdx = w.body.indexByKey.get(`foot_${s}`);
      const footP = footIdx !== undefined ? w.body.bodies[footIdx]!.translation() : { x: 0, z: 0 };
      const copMarginX = fcSNow.copHalfX - Math.abs(fcSNow.copXFiltered - footP.x);
      const copMarginZ = fcSNow.copHalfZ - Math.abs(fcSNow.copZFiltered - footP.z);
      const copMargin = Math.min(copMarginX, copMarginZ);
      const footTask = (globalThis as { __SQC_FOOT_CONTACT?: Record<string, { gripOk?: boolean; rotErr?: number; posErr?: number; angVelErr?: number }> }).__SQC_FOOT_CONTACT?.[s];
      const gripNow = s === 'l' ? gripL : gripR;
      const rotErrNow = footTask?.rotErr ?? 0;
      const posErrNow = footTask?.posErr ?? Number.POSITIVE_INFINITY;
      const angVelErrNow = footTask?.angVelErr ?? Number.POSITIVE_INFINITY;
      const footStable = !!footTask
        && posErrNow <= Math.abs(num('SQC_ANKLE_SMALL_POS_ERR', 0.03))
        && Math.abs(rotErrNow) <= Math.abs(num('SQC_ANKLE_SMALL_ROT_ERR', 0.25))
        && angVelErrNow <= Math.abs(num('SQC_ANKLE_SMALL_ANGVEL_ERR', 0.5));
      const smallGrip = !!gripNow && footStable && fcSNow.copInside && (ankleSupportCmd?.feasible ?? false) && Math.abs(fcSNow.copXFiltered - fcSNow.footX) < Math.abs(num('SQC_ANKLE_SMALL_COP_ERR', 0.03));
      const directScale = smallGrip ? Math.abs(num('SQC_ANKLE_DIRECT_SCALE_SMALL', 1)) : Math.abs(num('SQC_ANKLE_DIRECT_SCALE', 1));
      const ankleTauNeed = ankleSupportCmd?.tau ?? 0;
      (globalThis as { __SQC_SUPPORT_CMD?: Record<string, { fz: number; copX: number; tau: number; tauDes: number; tauAct: number; tauErr: number; fzErr: number; copErr: number; fzAct: number; copAct: number; gripOk: boolean; copMargin: number; copInside: boolean; rotErr: number; angVelErr: number; smallGrip: boolean; footStable: boolean; directScale: number; ankleTauNeed: number; ankleFeasible: boolean }> }).__SQC_SUPPORT_CMD = {
        ...((globalThis as { __SQC_SUPPORT_CMD?: Record<string, { fz: number; copX: number; tau: number; tauDes: number; tauAct: number; tauErr: number; fzErr: number; copErr: number; fzAct: number; copAct: number; gripOk: boolean; copMargin: number; copInside: boolean; rotErr: number; angVelErr: number; smallGrip: boolean; footStable: boolean; directScale: number; ankleTauNeed: number; ankleFeasible: boolean }> }).__SQC_SUPPORT_CMD ?? {}),
        [s]: { fz: fzUse, copX: copXUse, tau: ankleFf, tauDes: ankleFf, tauAct: 0, tauErr: 0, fzErr: fzUse - fcSNow.fzFiltered, copErr: copXUse - fcSNow.copXFiltered, fzAct: fcSNow.fzFiltered, copAct: fcSNow.copXFiltered, gripOk: gripNow, copMargin, copInside: fcSNow.copInside, rotErr: rotErrNow, angVelErr: footTask?.angVelErr ?? 0, smallGrip, footStable, directScale, ankleTauNeed, ankleFeasible: ankleSupportCmd?.feasible ?? false },
      };
      if (ai >= 0 && Math.abs(ankleFf) > 1e-9) {
        const directSign = num('SQC_ANKLE_DIRECT_SIGN', 1);
        propose({ dof: ai, kind: 'ext', pri: PRI.direct, channel: 'support', tau: ankleFf * directSign * directScale, src: 'lowerCommand.ankleSupport' });
      }
    }
    {
      const ledHip = hi >= 0 ? w.executor.ledger[hi] : undefined;
      const ledKnee = ki >= 0 ? w.executor.ledger[ki] : undefined;
      const ledAnkle = ai >= 0 ? w.executor.ledger[ai] : undefined;
      const appliedHip = ledHip?.applied ?? 0;
      const appliedKnee = ledKnee?.applied ?? 0;
      const appliedAnkle = ledAnkle?.applied ?? 0;
      const supportCmdNow = (globalThis as { __SQC_SUPPORT_CMD?: Record<string, { fz: number; copX: number; tau: number; tauDes: number; tauAct: number; tauErr: number; fzErr: number; copErr: number; fzAct: number; copAct: number }> }).__SQC_SUPPORT_CMD;
      if (supportCmdNow?.[s]) {
        const sc = supportCmdNow[s]!;
        sc.tau = appliedAnkle;
        sc.tauAct = appliedAnkle;
        sc.tauErr = sc.tauDes - appliedAnkle;
        sc.fzErr = sc.fz - sc.fzAct;
        sc.copErr = sc.copX - sc.copAct;
      }
      const resHip = appliedHip - (idS.hip + accHip);
      const resKnee = appliedKnee - (idS.knee + accKnee);
      const resAnkle = appliedAnkle - (idS.ankle + accAnkle);
      sr[s] = { hip: resHip, knee: resKnee, ankle: resAnkle };
      const legS = _legRef.get(st)?.[s] ?? captureShankLeg(w, s);
      const chain = measureActualForceChain(w, s, legS.hip, legS.knee, legS.ankle);
      const g = globalThis as { __SQC_KNEE_FOOT_DBG?: Record<string, unknown> };
      const o = g.__SQC_KNEE_FOOT_DBG ?? {};
      o[s] = { t: w.clock, knee2T: kneeT, knee2Cmd: kneeT, kneeFf, kneeBudget, worldGripOn: worldGripOn ? 1 : 0, worldIkHip: worldIk?.hip2 ?? 0, worldIkKnee: worldIk?.knee2 ?? 0, contactLatch: contactState.active ? 1 : 0, contactLatchSince: contactState.since, contactLatchLost: contactState.lostAt, contactFzLp: contactState.fzLp, hip2T: hipT, hip2Cmd: hipT, hipFf, idHip: idS.hip, idKnee: idS.knee, idAnkle: idS.ankle, fzUse, fzRawUse, fzFloor, fzCom, comY, comYTarget, comYAcc, supportCopX: wrench.copX, supportCopZ: wrench.copZ, supportWrenchFeasible: wrench.feasible ? 1 : 0, fzAbsMax, fzAbsFloor, hipErrFz: desired.hipErr, hipAccDes: desired.aDes, accMinHandoff, handoffAge, footPitch: s === 'l' ? footPitchL : footPitchR, flat: flat ? 1 : 0, fzTotalDesired: desired.fzTotalDes, fzShare, fzDesired: desired.fzDes, fzCmd: desired.fzCmd, hipTargetForFz, hipYForFz, copXUse: fcUse.copX, kneePasK: 120, kneePasB: 6, supportContact: supportContact ? 1 : 0, contact: fcSNow.contact ? 1 : 0, fz: fcSNow.fzFiltered, copValid: fcSNow.copValid ? 1 : 0, handoffU, handHip, handKnee, handAnkle, prevHip, prevKnee, prevAnkle, accHip, accKnee, accAnkle, dynRawHip, dynRawKnee, dynRawAnkle, dynMHip: dynM[0]!, dynMKnee: dynM[1]!, dynMAnkle: dynM[2]!, dynCHip: dynC[0]!, dynCKnee: dynC[1]!, dynCAnkle: dynC[2]!, appliedHip, appliedKnee, appliedAnkle, pdHip: appliedHip - hipFf, pdKnee: appliedKnee - kneeFf, pdAnkle: appliedAnkle - ankleFf, tauCorrAccHip, tauCorrAccKnee, tauCorrAccAnkle, resHip, resKnee, resAnkle, hipCmdT: ledHip?.cmd ?? 0, kneeCmdT: ledKnee?.cmd ?? 0, hipPassive: ledHip?.passive ?? 0, kneePassive: ledKnee?.passive ?? 0, chainHip: chain.tau.hip, chainKnee: chain.tau.knee, chainAnkle: chain.tau.ankle, hipYNow, hipY0, hipLift, hipLiftScale, kneeLiftScale, ankleLiftScale, hipHeightScale,
      hipTarget, kneeTarget, ankleTarget, hipTauMax, kneeTauMax, ankleTauMax, supportAcc: jCfg.acc, supportJerk: jCfg.jerk, supportSlew: jCfg.slew, chainFx: chain.F.x, chainFy: chain.F.y, chainFz: chain.F.z, chainCopX: chain.cop.x, chainCopZ: chain.cop.z, chainContact: chain.contact ? 1 : 0, chainCopInside: chain.copInside ? 1 : 0, chainResHip: appliedHip - chain.tau.hip, chainResKnee: appliedKnee - chain.tau.knee, chainResAnkle: appliedAnkle - chain.tau.ankle };
      g.__SQC_KNEE_FOOT_DBG = o;
    }
  }
}

export function squatFrame(w: World, ctl: ControlModule, st: CS): void {
  const g = globalThis as { __V3_SQUAT_FRAME_CLOCK?: number };
  if (g.__V3_SQUAT_FRAME_CLOCK === w.clock) return;
  g.__V3_SQUAT_FRAME_CLOCK = w.clock;
  sampleMotionAcceleration(w);
  courtStep(w, ctl, st);
  if (st.handoff) {
    let h = _handoff.get(st);
    if (!h) {
      const angles = new Float64Array(w.body.dofs.length);
      for (let i = 0; i < angles.length; i++) angles[i] = w.body.dofs[i]!.angle;
      h = { t0: w.clock, angles };
      _handoff.set(st, h);
    }
    const u = Math.max(0, Math.min(1, (w.clock - h.t0) / 0.50));
    (globalThis as { __SQC_HANDOFF?: { u: number; angles: Float64Array } | null }).__SQC_HANDOFF = { u, angles: h.angles };
  } else {
    (globalThis as { __SQC_HANDOFF?: { u: number; angles: Float64Array } | null }).__SQC_HANDOFF = null;
  }
  // 法庭已经判死后不再跑蹲下 PD，避免倒地把控制器带成高频抽搐
  if (st.fall >= 0) return;
  const pre = preload(st);
  // 冻结期不跑主动 PD，但被动层必须在场；否则静置期也会无支撑漂移。
  if (!pre && !st.released) {
    if (String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_PASSIVE2 ?? '1') === '1') armSupportCurrent(w, ctl);
      return;
  }
  if (num('SQC_POSTURE_HOLD', 1) === 1) {
    postureHoldFrame(w, ctl, st);
    return;
  }
  // 旧 supportWbc / sagittalBase 链只允许显式打开；默认归档，不参与主链。
  if (num('SQC_LEGACY_SUPPORT', 0) !== 1) {
    postureHoldFrame(w, ctl, st);
    return;
  }
  const pdg = getPdGroups(w);
  const t = capture(w, st);
  let shankSelSide = pickShankSide(w, st);
  // 足底检测单一来源：接触/fz/CoP 全部走 sampleFootContact（每帧缓存）；
  // 摩擦利用率仍来自 perception（它测的是切向力/摩擦锥，不是接触检测）。
  const fcS = { l: sampleFootContact(w, 'l'), r: sampleFootContact(w, 'r') };
  const supW = st.handoff ? computeSupportWbc(w, ctl.sensors) : null;
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
  const bsPrev = (globalThis as unknown as { __BS?: { hipL?: number; kneeL?: number; hipR?: number; kneeR?: number; feasible?: boolean; hipStable?: boolean; hip0CorrL?: number; hip1CorrL?: number; hip0CorrR?: number; hip1CorrR?: number; mode?: 'FORCE' | 'HIP'; ikHip2L?: number; ikKnee2L?: number; ikHip2R?: number; ikKnee2R?: number; ikFeasible?: boolean } }).__BS;
  const qpPrev = (globalThis as unknown as { __QP?: { command?: { feasible?: boolean; deltaHip0L?: number; deltaHip0R?: number; deltaHip1L?: number; deltaHip1R?: number; deltaHip2L?: number; deltaHip2R?: number; deltaKnee2L?: number; deltaKnee2R?: number; deltaHip2FfL?: number; deltaHip2FfR?: number; deltaKnee2FfL?: number; deltaKnee2FfR?: number } } }).__QP?.command;
  const rightingOff = num('SQC_RIGHTING_OFF', 1) === 1;
  const kneeOutActive = num('SQC_KNEEOUT_ACTIVE', 0) === 1;
  const kneeOutScale = Math.max(-1, Math.min(1, num('SQC_KNEEOUT_SCALE', 0.3)));
  const qpApply = !rightingOff && num('SQC_QP_APPLY', 1) === 1 && !!qpPrev?.feasible;
  const qpApplyScale = Math.max(0, Math.min(1, num('SQC_QP_APPLY_SCALE', 1)));
  const qpIk: Partial<Record<'l' | 'r', ReturnType<typeof solveShankIK2>['ik']>> = {};

  const qpChain: Partial<Record<'l' | 'r', SagittalChainInput>> = {};
  const qpBase: Partial<Record<'l' | 'r', SagittalBaseReference>> = {};
  const loadHL = w.body.dofs[di(w, 'hip_l', 0)]?.anchorWorld[1] ?? 0;
  const loadHR = w.body.dofs[di(w, 'hip_r', 0)]?.anchorWorld[1] ?? 0;
  const loadEH = loadHL - loadHR;
  const loadLow = loadEH > 0 ? 'r' : 'l';
  const loadHigh = loadEH > 0 ? 'l' : 'r';
  const qpModeBySide: Partial<Record<'l' | 'r', 'STABILIZE' | 'RECOVER'>> = {};
  const qpMarginBySide: Partial<Record<'l' | 'r', number>> = {};
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
    let pref: PoseRef | undefined;
    {
      let pm = _poseRef.get(st);
      if (!pm) { pm = {}; _poseRef.set(st, pm); }
      pref = pm[s];
      if (!pref && st.released) {
        pref = { hip0: ik.hip0, hip1: Number.NaN, hip2: ik.hip2, knee0: ik.knee0, knee2: ik.knee2, foot0: ik.foot0, foot2: ik.foot2 };
        pm[s] = pref;
      }
    }
    const holdShank = num('SQC_IK_HOLD_SHANK', 0) === 1 && !!pref;
    const holdHip = num('SQC_IK_HOLD_HIP', 0) === 1 && !!pref;
    const ikOnly = num('SQC_IK_TARGET_ONLY', 0) === 1;
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
    qpModeBySide[s] = idMode;
    qpMarginBySide[s] = margin;
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
    const idHip0Corr = (!rightingOff || kneeOutActive) && bsPrev ? kneeOutScale * (s === 'l' ? bsPrev.hip0CorrL ?? 0 : bsPrev.hip0CorrR ?? 0) : 0;
    const idHip1Corr = (!rightingOff || kneeOutActive) && bsPrev ? kneeOutScale * (s === 'l' ? bsPrev.hip1CorrL ?? 0 : bsPrev.hip1CorrR ?? 0) : 0;
    const idCmd = solveSagittalInverseDynamics(w, {
      side: s, fc, fzTarget, ik, hip1Base,
      hip0Corr: idArch ? idHip0Corr : 0,
      hip1Corr: idArch ? idHip1Corr : 0,
    });
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
    const knee0Cmd = holdShank ? pref!.knee0 : ik.knee0;
    const foot0Cmd = holdShank ? pref!.foot0 : ik.foot0;
    shankPlan.knee0 = knee0Cmd;
    shankPlan.foot0 = foot0Cmd;
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
      contact: chain.contact || fc.loadValid, fz: fc.fzHeld, targetFz: fzTarget,
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
    const baseSag = computeSagittalBase({
      ik: _ikBase.get(w)?.get(s),
      hip2Base, foot2Base: right.foot2, hip0Base: hip0T, hip1Base,
      knee2Base: k2Target, hipLow, hipHigh, hipTargetY: hipTarget.y, hipAnchorY: h2nowY,
      relax, baseGateK: num('SQC_BASE_HIP_GATE', 0.8), kneeFlexK: num('SQC_KNEE_HIP_FLEX', 0.12),
      heightK: num('SQC_HIP2_ERR_K', 300), heightCap: num('SQC_HIP2_ERR_CAP', 40),
    });
    const supportX = 0.5 * (fcS.l.footX + fcS.r.footX);
    const comOn = num('SQC_COM_ON', 1) === 1;
    const comDead = Math.max(0, num('SQC_COM_DEAD', 0.005));
    const comRaw = supportX - hipFrame.comX;
    const comEx = Math.abs(comRaw) <= comDead ? 0 : Math.sign(comRaw) * (Math.abs(comRaw) - comDead);
    const comKx = num('SQC_COM_KX', 2500);
    const comFf = comOn ? {
      hip: Math.max(-Math.abs(num('SQC_COM_CAP_HIP', 30)), Math.min(Math.abs(num('SQC_COM_CAP_HIP', 30)), num('SQC_COM_W_HIP', 0.25) * comKx * comEx)),
      knee: Math.max(-Math.abs(num('SQC_COM_CAP_KNEE', 40)), Math.min(Math.abs(num('SQC_COM_CAP_KNEE', 40)), num('SQC_COM_W_KNEE', 0.30) * comKx * comEx)),
      foot: Math.max(-Math.abs(num('SQC_COM_CAP_FOOT', 50)), Math.min(Math.abs(num('SQC_COM_CAP_FOOT', 50)), num('SQC_COM_W_FOOT', 0.45) * comKx * comEx)),
    } : { hip: 0, knee: 0, foot: 0 };
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
    if (pref && !Number.isFinite(pref.hip1)) pref.hip1 = baseHip1Target;
    const contactHold = !fc.contact && fc.fzHeld < 20;
    const baseHip2Target = contactHold ? leg.qHip2 : (simpleBase ? (baseAng('hip', 2) ?? t[s].hip2) : baseSag.hip2Target);
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
    const hip0QpDelta = qpApply ? qpApplyScale * (s === 'l' ? qpPrev?.deltaHip0L ?? 0 : qpPrev?.deltaHip0R ?? 0) : 0;
    const hip1QpDelta = qpApply ? qpApplyScale * (s === 'l' ? qpPrev?.deltaHip1L ?? 0 : qpPrev?.deltaHip1R ?? 0) : 0;
    const rightingHip0 = idHip0Corr + hip0QpDelta;
    const rightingHip1 = idHip1Corr + hip1QpDelta;
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
    const hip0Out = baseHip0Target + rightingHip0;
    const hip1Out = baseHip1Target + rightingHip1;
    const hip0Soft = num('SQC_HIP0_SOFT_ON', 0) === 1;
    const hipBudgetRad = Math.abs(num('SQC_HIP_BUDGET_RAD', 0.3)) * hipBudget;
    const hip0CmdRaw = (hip0Soft ? t[s].hip0 : hip0Out) + man.hip0;
    const hip0Cmd = holdHip ? pref!.hip0 : (ikOnly ? ik.hip0 : Math.max(baseHip0Target - hipBudgetRad, Math.min(baseHip0Target + hipBudgetRad, hip0CmdRaw)));
    const hip1Soft = num('SQC_HIP1_SOFT_ON', 1) === 1;
    const hip1CmdRaw = (hip1Soft ? t[s].hip1 : hip1Out) + man.hip1;
    const hip1Cmd = holdHip ? pref!.hip1 : (ikOnly ? baseHip1Target : Math.max(baseHip1Target - hipBudgetRad, Math.min(baseHip1Target + hipBudgetRad, hip1CmdRaw)));
    // hip2 只走基础目标 + 唯一 PD；矢状回正由踝/CoP 负责。
    const hip2Out = baseHip2Target;
    const hipFfOut = baseHipFf + rightingHip2Ff;
    const hip2Cmd = holdHip ? pref!.hip2 : (ikOnly ? ik.hip2 : hip2Out + man.hip2);
    const hipFfCmd = hipFfOut + man.hip2Ff + num('SQC_HIP2_ASSIST', 0);
    const ankleFfOut = baseSag.ankle;
    const supportFzGate = Math.max(5, num('SQC_ANKLE_SUPPORT_FZ', 0.03) * w.sk.massTotal * 9.81);
    const supportContact = fc.contact || fc.loadValid || fc.fzHeld > supportFzGate;

    {
      const g = globalThis as unknown as { __HIP_SRC?: Record<string, unknown> };
      const o = g.__HIP_SRC ?? {};
      o[s] = { base0: baseHip0Target, base1: baseHip1Target, id0: idHip0Corr, id1: idHip1Corr, qp0: hip0QpDelta, qp1: hip1QpDelta, right0: rightingHip0, right1: rightingHip1, out0: hip0Cmd, out1: hip1Cmd, thigh2: thigh.hip2Ff, loadEH, lowSide: loadLow, base2Ff: baseHipFf, out2Ff: hipFfOut };
      g.__HIP_SRC = o;
    }
    const hubKpOut = 1;
    const hubKdOut = 1;
    const shankOut = 1;
    {
      const gs = globalThis as unknown as { __SAG16?: Record<string, unknown> };
      const os = gs.__SAG16 ?? {};
      os[s] = { base: 1, hipFf: hipFfOut, idHip: idCmd.hip2Ff, idKnee: idCmd.knee2Ff };
      gs.__SAG16 = os;
    }
    // kneeOut 是 bilateral 逆动力学的约束项，不是独立 hip0 前馈。
    // 独立 kneeOutFf 的 A/B 会破坏平衡，已撤回；只在求解释放后联合输出。
    const passiveHigh = Math.max(0, Math.min(2, num('SQC_PASSIVE_AUTH_HIGH', 1)));
    const passiveLow = Math.max(0, Math.min(2, num('SQC_PASSIVE_AUTH_LOW', 1)));
    const passiveScale = Math.abs(loadEH) > Math.abs(num('SQC_PASSIVE_AUTH_DEADBAND', 0.005))
      ? (s === loadHigh ? passiveHigh : s === loadLow ? passiveLow : 1)
      : 1;
    const hip0Kp = hip0Soft ? num('SQC_HIP0_SOFT_KP', 600) : num('SQC_HIP0_KP', 1200);
    const hip0Kd = hip0Soft ? num('SQC_HIP0_SOFT_KD', 20) : num('SQC_HIP0_KD', 20);
    const hip0Cap = hip0Soft ? num('SQC_HIP0_SOFT_CAP', 60) : num('SQC_HIP0_CAP', 150);
    pdg.hip.hip0(s, hip0Cmd, hip0Kp * hubKpOut, hip0Kd * hubKdOut, Math.abs(hip0Cap), 'squat.hip0', 0, PRI.reflex, passiveScale);
    const hip1Kp = hip1Soft ? num('SQC_HIP1_SOFT_KP', 200) : num('SQC_HIP1_ROLL_KP', 200);
    const hip1Kd = hip1Soft ? num('SQC_HIP1_SOFT_KD', 20) : num('SQC_HIP1_ROLL_KD', 10);
    pdg.hip.hip1(s, hip1Cmd, hip1Kp * hubKpOut, hip1Kd * hubKdOut, Math.abs(num('SQC_HIP1_CAP', 60)), 'squat.hip1', 0);
    {
      const h1p = di(w, `hip_${s}`, 1);
      const drvP = ctl.warner.drive as unknown as { supportTorque(i: number): number };
      if (h1p >= 0) {
        const tau = drvP.supportTorque(h1p);
        if (Math.abs(tau) > 1e-6) propose({ dof: h1p, kind: 'ext', pri: PRI.reflex, channel: 'passive', tau, src: 'squat.hip1.passive' });
      }
    }
    const handoff = (globalThis as { __SQC_HANDOFF?: { u: number; angles: Float64Array } | null }).__SQC_HANDOFF;
    let handoffHip = _handoffHipApplied.get(st);
    if (!handoffHip && handoff) {
      const il = di(w, 'hip_l', 2);
      const ir = di(w, 'hip_r', 2);
      handoffHip = { l: il >= 0 ? w.executor.ledger[il]!.applied : 0, r: ir >= 0 ? w.executor.ledger[ir]!.applied : 0 };
      _handoffHipApplied.set(st, handoffHip);
    }
    const handoffRampRaw = handoff ? Math.max(0, Math.min(1, (handoff.u * 0.50) / Math.max(0.01, num('SQC_HANDOFF_RAMP', 0.12)))) : 1;
    const handoffRamp = handoffRampRaw * handoffRampRaw * (3 - 2 * handoffRampRaw);

    const supwHipScale = Math.max(0, num('SQC_SUPW_HIP_SCALE', 1));
    const supHipFf = (supW ? (s === 'l' ? supW.hipL : supW.hipR) * supwHipScale : hipFfCmd) + comFf.hip;
    const prevHipFf = handoffHip ? (s === 'l' ? handoffHip.l : handoffHip.r) : supHipFf;
    const hip2FfUse = prevHipFf + (supHipFf - prevHipFf) * handoffRamp;
    pdg.hip.hip2(s, hip2Cmd, num('SQC_HIP2_KP', 50) * hubKpOut, num('SQC_HIP2_KD', 2) * hubKdOut, Math.abs(num('SQC_HIP2_CAP', 150)), 'squat.hip2', hip2FfUse);
    let handoffKnee = _handoffKneeApplied.get(st);
    if (!handoffKnee && handoff) {
      const kl = di(w, 'knee_l', 2);
      const kr = di(w, 'knee_r', 2);
      handoffKnee = { l: kl >= 0 ? w.executor.ledger[kl]!.applied : 0, r: kr >= 0 ? w.executor.ledger[kr]!.applied : 0 };
      _handoffKneeApplied.set(st, handoffKnee);
    }
    const kneeAng = w.body.dofs[di(w, `knee_${s}`, 2)]?.angle ?? 0;
    const knee2Target = simpleBase ? (baseAng('knee', 2) ?? t[s].knee2) : baseSag.knee2Support;
    const kneeErr = knee2Target - kneeAng;
    const band = Math.abs(num('SQC_SUP_ONE_WAY_BAND', 0.3));
    const supScale = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SUP_ONE_WAY ?? '0') !== '0'
      ? (kneeErr >= 0 ? 1 : Math.max(0, Math.min(1, 1 + kneeErr / band))) : 1;
    const kneeSup = supFf * supScale * (1 - relax);
    const kneeLock = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_KNEE_LOCK ?? '0') !== '0';
    const knee2Out = contactHold ? kneeAng : (simpleBase ? (baseAng('knee', 2) ?? t[s].knee2) : baseSag.knee2Support);
    const kneeEarlyLock = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_KNEE_LOCK_EARLY ?? '0') !== '0' && !!handoff;
    const kneeEarlyRef = kneeEarlyLock ? handoff!.angles[di(w, `knee_${s}`, 2)] : undefined;
    const knee2T = kneeEarlyLock && Number.isFinite(kneeEarlyRef)
      ? kneeEarlyRef!
      : kneeLock ? leg.qKnee2 : (holdShank ? pref!.knee2 : (ikOnly ? ik.knee2 : knee2Out));
    const kneeBaseFf = kneeLock || kneeEarlyLock ? 0 : (simpleBase ? baseTq('knee', 2) : baseSag.knee);
    const kneeSupportFf = kneeLock || kneeEarlyLock || simpleBase ? 0 : rightStrength * kneeSup;
    const kneeFfOut = kneeBaseFf + kneeSupportFf;
    const kneeSupScale = Math.max(0, Math.min(1, num('SQC_KNEE_SUP_SCALE', 0.5)));
    const kneeFfRaw = kneeBaseFf + kneeSupportFf * kneeSupScale + man.knee2Ff + num('SQC_KNEE2_ASSIST', 0) + comFf.knee;
    let kfLp = _kneeFfLp.get(st);
    if (!kfLp) { kfLp = { l: kneeFfRaw, r: kneeFfRaw }; _kneeFfLp.set(st, kfLp); }
    const kfPrev = s === 'l' ? kfLp.l : kfLp.r;
    const kfA = 1 - Math.exp(-w.dt / Math.max(0.005, num('SQC_KNEE_FF_LP', 0.04)));
    const kneeFfCmd = kfPrev + (kneeFfRaw - kfPrev) * kfA;
    if (s === 'l') kfLp.l = kneeFfCmd; else kfLp.r = kneeFfCmd;
    qpIk[s] = ik;
    qpChain[s] = fActual;
    qpBase[s] = {
      fzL: fzBudget.fzLTarget, fzR: fzBudget.fzRTarget,
      hip0TargetL: baseHip0Target + idHip0Corr, hip0TargetR: baseHip0Target + idHip0Corr,
      hip1TargetL: baseHip1Target + idHip1Corr, hip1TargetR: baseHip1Target + idHip1Corr,
      hip2TargetL: hip2Out, hip2TargetR: hip2Out,
      knee2TargetL: knee2Out, knee2TargetR: knee2Out,
      foot2TargetL: baseSag.foot2Target, foot2TargetR: baseSag.foot2Target,
      hip2FfL: baseHipFf + thigh.hip2Ff, hip2FfR: baseHipFf + thigh.hip2Ff,
      knee2FfL: kneeFfOut, knee2FfR: kneeFfOut,
      ankleFfL: baseSag.ankle, ankleFfR: baseSag.ankle,
      valid: true,
    };
    {
      // 交接后 knee2 不再用 supportWbc.knee 覆盖命令层；只保留这一个 PD 的 ff。
      const kneePasBase = Math.max(0, num('SQC_KNEE_PAS_K', 120));
      const kneePasGain = num('SQC_KNEE_PAS_GAIN', 0);
      const kneePasMax = Math.max(0, num('SQC_KNEE_PAS_MAX', 180));
      // e>0：膝还差支撑，K 补；e<0：支撑过头，K 退。
      const kneePasK = Math.max(0, Math.min(kneePasMax, kneePasBase + kneePasGain * kneeErr));
      const kneePasB = Math.max(0, num('SQC_KNEE_PAS_B', 6));
      const kneePrev = handoffKnee ? (s === 'l' ? handoffKnee.l : handoffKnee.r) : kneeFfCmd;
      const kneeFfUse = kneePrev + (kneeFfCmd - kneePrev) * handoffRamp;
      pdg.shank.knee2(s, knee2T + man.knee2, (num('SQC_SUPPORT_KP', 50) + kneePasK) * shankOut, (num('SQC_KNEE_KD', 8) + kneePasB) * shankOut, Math.abs(num('SQC_SUPPORT_CAP', 150)), 'squat.knee2', kneeFfUse);
      {
        const g = globalThis as { __SQC_KNEE_FOOT_DBG?: Record<string, unknown> };
        const o = g.__SQC_KNEE_FOOT_DBG ?? {};
        o[s] = {
          t: st.t, knee2T, knee2Cmd: knee2T + man.knee2, kneeFf: kneeFfCmd,
          hip2T: hip2Out, hip2Cmd, hipFf: hip2FfUse, baseHipFf,
          supHip: supW ? (s === 'l' ? supW.hipL : supW.hipR) : 0,
          comHip: comFf.hip, thigh2: thigh.hip2Ff, handoffRamp,
          kneePasK, kneePasB, kneeKp: num('SQC_SUPPORT_KP', 50), kneeKd: num('SQC_SUPPORT_KD', 2), kneeCap: num('SQC_SUPPORT_CAP', 150),
          supportContact: supportContact ? 1 : 0, contact: fc.contact ? 1 : 0, fz: fc.fzFiltered, copValid: fc.copValid ? 1 : 0,
        };
        g.__SQC_KNEE_FOOT_DBG = o;
      }
    }
    {
      pdg.shank.knee0(s, knee0Cmd, 300, 12, Math.abs(num('SQC_KNEE0_CAP', 100)), 'squat.knee0', lateralKneeFf);
    }
    // 矢状踝是承重链末端：接触短暂丢失时也保持关节角，不允许踝在卸载瞬间完全消失。
    // ★ 实测：-0.0005 会把左脚 CoP 推到 0.13、fz 201/346；关闭后恢复 331/333。
    // 踝不归矢状回正：只维持 base/IK，力链/抓地由小腿通道负责（架构 §12.1）。
    const foot2T = holdShank ? pref!.foot2 : (ikOnly ? ik.foot2 : baseSag.foot2Target);


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
      tr.push({
        t: st.t, s,
        hip2Q: leg.qHip2, hip2V: h2i >= 0 ? w.body.dofs[h2i]!.vel : 0,
        hip2T: hip2Out, hip2Cmd, hipFf: hipFfCmd, baseHipFf, thigh2: thigh.hip2Ff,
        idHip2: idCmd.hip2Ff, toneHip2: 0, righting2: rightingHip2Ff,
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
      });
      if (tr.length > 320) tr.shift();
      (globalThis as { __SQC_TRACE?: unknown }).__SQC_TRACE = JSON.stringify(tr);
      }
    }
    if (String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SQUAT_DBG ?? '0') === '1') {
      const g = globalThis as unknown as { __SQUAT_DBG?: Record<string, unknown> };
      const o = g.__SQUAT_DBG ?? {};
      o[s] = {
        hip0T: hip0Out, foot0T, knee0T: shankPlan.knee0, hip2T: hip2Out, knee2T, knee2Cmd: knee2T + man.knee2, knee2Kp: num('SQC_SUPPORT_KP', 50), knee2Kd: num('SQC_SUPPORT_KD', 2), knee2Cap: Math.abs(num('SQC_SUPPORT_CAP', 150)), kneeFf: kneeFfCmd, foot2T,
        supFf, hipFf: hipFfOut, relax: baseSag.relax, kneeSup, supScale,
        baseHip: baseSag.hip, baseKnee: baseSag.knee, baseGate: baseSag.baseGate, kneeHipFlex: baseSag.kneeHipFlex,
        baseKnee2Support: baseSag.knee2Support, baseHipFf: baseSag.hipFf,
        shankSelSide, lateralFoot0,
        latF: fActual.fLat, latPerp: fActual.fPerp, latChain: fActual.fParallel, latCopZ: fActual.copZ, latFric: fActual.frictionUtil, latCopIn: fActual.copInside,
        copX: fc.copXFiltered, copZ: fc.copZFiltered, copMarginX: fc.copMarginX, copMarginZ: fc.copMarginZ, copMarginNorm: fc.copMarginNorm, copVelX: fc.copVelX, copVelZ: fc.copVelZ, footX: fc.footX, footZ: fc.footZ,
        hipHigh, hipLow, hipTargetY: hipTarget.y, hipAnchorY: h2nowY, supportX, eSag: supportX - hipFrame.comX, thigh2: thigh.hip2Ff, hipBudget, hipBudgetRad,
        baseAnkle: baseSag.ankle, ikAnkle: ik.foot2, ankleFf: ankleFfOut, foot0Ff: lateral.foot0Ff,
        hip2Q: h2 >= 0 ? w.body.dofs[h2]!.angle : 0, knee2Q: kneeAng,
        hipT: pdg.hip.tension(s, 'hip'), kneeT: pdg.shank.tension(s, 'knee'), shankT: pdg.shank.tension(s, 'foot'),
      };
      g.__SQUAT_DBG = o;
    }
    // 脚离地时不再写膝/踝 damp；接触丢失后不让阻尼继续制造高频力矩
  }
  if (qpIk.l && qpIk.r && qpChain.l && qpChain.r && qpBase.l && qpBase.r) {
    const prev = (globalThis as unknown as { __QP?: { command?: import('./sagittalIdTypes').CommandFrame } }).__QP;
    const qpPrevModeState = _idMode.get(st);
    const qpPrevMode = qpPrevModeState?.mode ?? 'STABILIZE';
    const qpSince = qpPrevModeState?.since ?? w.clock;
    const qpMargin = Math.min(qpMarginBySide.l ?? -1, qpMarginBySide.r ?? -1);
    const qpEnter = Math.abs(num('SQC_ID_RECOVER_ENTER', 0.06));
    const qpExit = Math.abs(num('SQC_ID_RECOVER_EXIT', 0.05));
    const qpHold = Math.abs(num('SQC_ID_MODE_HOLD', 0.20));
    let qpWant: 'STABILIZE' | 'RECOVER' = qpPrevMode === 'RECOVER'
      ? (qpMargin > qpExit ? 'RECOVER' : 'STABILIZE')
      : (qpMargin > qpEnter ? 'RECOVER' : 'STABILIZE');
    if (qpWant !== qpPrevMode && w.clock - qpSince < qpHold) qpWant = qpPrevMode;
    const sensor = buildSagittalSensorFrame({
      world: w, control: ctl, now: w.clock, dt: w.dt, physicsStep: w.steps,
      fc: fcS, leg: { l: _legRef.get(st)!.l, r: _legRef.get(st)!.r },
      ik: { l: qpIk.l, r: qpIk.r }, chain: { l: qpChain.l, r: qpChain.r },
      base: {
        ...qpBase.l,
        fzL: qpBase.l.fzL, fzR: qpBase.r.fzR,
        hip0TargetL: qpBase.l.hip0TargetL, hip0TargetR: qpBase.r.hip0TargetL,
        hip1TargetL: qpBase.l.hip1TargetL, hip1TargetR: qpBase.r.hip1TargetL,
        hip2TargetL: qpBase.l.hip2TargetL, hip2TargetR: qpBase.r.hip2TargetL,
        knee2TargetL: qpBase.l.knee2TargetL, knee2TargetR: qpBase.r.knee2TargetL,
        foot2TargetL: qpBase.l.foot2TargetL, foot2TargetR: qpBase.r.foot2TargetL,
        hip2FfL: qpBase.l.hip2FfL, hip2FfR: qpBase.r.hip2FfL,
        knee2FfL: qpBase.l.knee2FfL, knee2FfR: qpBase.r.knee2FfL,
        ankleFfL: qpBase.l.ankleFfL, ankleFfR: qpBase.r.ankleFfL,
      },
      mode: qpWant,
      forceMode: bsPrev?.mode === 'HIP' ? 'HIP' : 'FORCE',
    });
    const bl = qpBase.l;
    const br = qpBase.r;
    const il = qpIk.l;
    const ir = qpIk.r;
    const targets: SagittalTargets = {
      qStableL: [bl.hip0TargetL, bl.hip1TargetL, bl.hip2TargetL, bl.knee2TargetL],
      qStableR: [br.hip0TargetR, br.hip1TargetR, br.hip2TargetR, br.knee2TargetR],
      qIkL: [num('SQC_QP_IK_HIP01', 0) === 1 ? il.hip0 : bl.hip0TargetL, bl.hip1TargetL, bl.hip2TargetL, bl.knee2TargetL],
      qIkR: [num('SQC_QP_IK_HIP01', 0) === 1 ? ir.hip0 : br.hip0TargetR, br.hip1TargetR, br.hip2TargetR, br.knee2TargetR],
      kneeOutMinL: Math.max(0, num('SQC_BID_KNEE_OUT_TARGET', 0.005)),
      kneeOutMinR: Math.max(0, num('SQC_BID_KNEE_OUT_TARGET', 0.005)),
      comTargetX: hipFrame.comTargetX, comTargetZ: hipFrame.comTargetZ,
      xcomTargetZ: sensor.com.xcomZ, copTargetZ: sensor.com.supportMidZ,
      pelvisRollTarget: 0, pelvisHeightTarget: hipFrame.comY,
      fzLowMargin: Math.max(0, num('SQC_QP_FZ_LOW_MARGIN', 5)),
      fzHighMargin: Math.max(0, num('SQC_QP_FZ_HIGH_MARGIN', 5)),
      fzDiffGain: Math.max(0, num('SQC_QP_FZ_DIFF_K', 80)),
      fzDiffCap: Math.max(0, num('SQC_QP_FZ_DIFF_CAP', 240)),
      fzDeadband: Math.max(0, num('SQC_QP_FZ_DEADBAND', 0.005)),
      kneeOutAngleCap: Math.abs(num('SQC_BID_KNEE_OUT_ANGLE_CAP', 0.12)),
      hipCommonWeight: Math.max(0, num('SQC_QP_HIP_COMMON_W', 1)),
      pelvisRollWeight: Math.max(0, num('SQC_QP_PELVIS_ROLL_W', 1)),
    };
    const qp = solveSagittalId({ sensor, targets, previous: prev?.command ?? null, now: w.clock, solveDt: 1 / Math.max(1, num('SQC_QP_HZ', 30)) });
    (globalThis as unknown as { __QP?: unknown }).__QP = qp;
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
      __QP?: unknown;
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
      qp: g.__QP ?? null,
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
