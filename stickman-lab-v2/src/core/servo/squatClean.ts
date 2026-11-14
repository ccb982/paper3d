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
import { propose, PRI } from '../proposalBus';
import type { World } from '../world';
import type { ControlModule } from '../control';
import type { CourtState as CS } from '../court';
import { courtStep } from '../court';
import { sampleFootContact, resetFootSensor } from './footContact';
import { captureShankLeg, hipLateralTarget, solveShankIK, solveShankIK2, solveShankIKTarget, type ShankLegRef } from './shankIK';
import { measureActualForceChain } from './actualForceChain';
import { solveStaticLegTorques } from './legInverseDynamics';
import { solveBilateral } from './bilateralSolver';
import { estimateExternalBoundary, resetExternalBoundary } from './externalBoundary';
import { sensePelvis } from './pelvisSense';
import { senseSagittal } from './sagittalSense';
import { upperBodyCommand } from './upperBodyCommand';
import { UpperTaskPD } from './upperTaskPD';
import { planSupport } from './supportPlanner';
import { computeSagittalBase } from './sagittalBase';
import { clampHip2, clampKnee2, clampFoot2, clampHip0, clampComX, clampComZ, clampCopX, SQUAT_Q_MIN, SQUAT_Q_MAX } from './squatFeasible';
import { muscleTau } from './musclePd';
import { measureJointLoads } from './fullInverseDynamics';
import { solveSquatHipDynamics, solveSquatShankDynamics } from './squatWbc';
import { computeFloatingModel, resetFloatingCache, lowerAxes, type ContactSpec } from '../squat2/floatingModel';
import { solveWbc, type WbcOutput } from '../squat2/wbc';
import { solveWbcHard } from '../squat2/wbcHard';
import { computeFzBudget, resetFzBudget } from './fzBudget';
import type { HipRightingFrame } from './hipRightingInput';
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
}

/** 仅保存释放时的姿态目标；不在文档外新增目标。 */
const _target = new WeakMap<CS, { l: SideTarget; r: SideTarget }>();
const _legRef = new WeakMap<CS, { l: ShankLegRef; r: ShankLegRef }>();
const _upperPd = new WeakMap<World, UpperTaskPD>();
const _relaxLp = new WeakMap<CS, Map<'l' | 'r', number>>();
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
const _wbcCache = new WeakMap<World, { t: number; out: WbcOutput | null; warm?: { x: Float64Array; z: Float64Array; y: Float64Array }; lastOk?: WbcOutput; lastOkT?: number }>();
const _wbcBaseTarget = new WeakMap<World, { x: number; y: number; z: number; w: number }>();
const _modelH = new WeakMap<World, { t: number; h: Float64Array }>();
const _wbcApplyStart = new WeakMap<World, number>();

const num = (k: string, d: number): number => {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const v = Number(env[k]);
  return Number.isFinite(v) ? v : d;
};
const di = (w: World, n: string, a: number): number => w.body.dofByName(n, a);
const ang = (w: World, n: string, a: number): number => { const i = di(w, n, a); return i >= 0 ? w.body.dofs[i]!.angle : 0; };
/** 腿链 CoM 雅可比：脚踩地时身体绕关节转，用互补侧（与旧两 PD 命令层同口径）。 */
const squatComJ = (w: World, side: 'l' | 'r'): [number, number, number][] => {
  const n = w.body.dofs.length;
  const J = new Float64Array(n * 3);
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_CMD_J ?? 'comp') === 'sub') w.body.comJacobian(J);
  else w.body.comJacobianComplement(J);
  const row = (name: string): [number, number, number] => {
    const i = di(w, name, 2);
    return i >= 0 ? [J[3 * i]!, J[3 * i + 1]!, J[3 * i + 2]!] : [0, 0, 0];
  };
  return [row(`hip_${side}`), row(`knee_${side}`), row(`foot_${side}`)];
};
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
  _upperPd.delete(w);
  _idMode.delete(w as unknown as CS);
  resetFzBudget(w);
  resetHipTask2(w);
  _ikCache.delete(w);
  _hipHold.delete(w);
  _fcCache.delete(w);
  _ikBase.delete(w);
  resetFootSensor(w);
  resetExternalBoundary(w);
  resetFloatingCache(w);
  _modelH.delete(w);
}

function muscle(w: World, name: string, axis: number, tauCmd: number, src: string, b: number, k: number, dead: number, cap: number, qRef?: number): void {
  const i = di(w, name, axis);
  if (i < 0) return;
  const d = w.body.dofs[i]!;
  const ref = qRef ?? w.drive.supportRefOf(i) ?? 0;
  const tau = muscleTau(tauCmd, d.angle, d.vel, { b, k, dead, qRef: ref, cap });
  propose({ dof: i, kind: 'ext', pri: PRI.reflex, tau, src, channel: 'support' });
}

function getUpperPd(w: World): UpperTaskPD {
  let p = _upperPd.get(w);
  if (!p) { p = new UpperTaskPD(); _upperPd.set(w, p); }
  return p;
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
  const t = capture(w, st);
  // 足底检测单一来源：接触/fz/CoP 全部走 sampleFootContact（每帧缓存）；
  // 摩擦利用率仍来自 perception（它测的是切向力/摩擦锥，不是接触检测）。
  const fcS = { l: sampleFootContact(w, 'l'), r: sampleFootContact(w, 'r') };
  const cmdTarget = new Float64Array(w.body.dofs.length);
  for (let i = 0; i < cmdTarget.length; i++) cmdTarget[i] = w.body.dofs[i]!.angle;
  const envCmd = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  // WBC 默认关：30Hz 求解目前 100ms 级，先保证法庭不卡；评估用 SQC_WBC=shadow 显式开。
  const wbcMode = String(envCmd.SQC_WBC ?? 'off');
  const axesWbc = lowerAxes(w).axes;
  let wbcCache = _wbcCache.get(w);
  if (!wbcCache) { wbcCache = { t: -1, out: null }; _wbcCache.set(w, wbcCache); }
  const wbcPrev = wbcCache.out;
  const comZ = ctl.sensors.com[2]!;
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
    const wbcCur = wbcPrev?.ok === true;
    const wbcLast = wbcCache.lastOk;
    const wbcAge = wbcCache.lastOkT !== undefined ? w.clock - wbcCache.lastOkT : 1e9;
    const wbcHoldT = Math.max(0, Math.abs(num('SQC_WBC_HOLD_T', 0)));
    const wbcHold = wbcCur ? 1 : (wbcLast && wbcHoldT > 0 && wbcAge < wbcHoldT ? 1 - wbcAge / wbcHoldT : 0);
    const wbcApply = wbcMode === 'apply' && wbcHold > 0;
    const wbcBase = (n: string, a: number, fb: number): number => {
      if (!wbcApply) { _wbcApplyStart.delete(w); return fb; }
      if (num('SQC_WBC_APPLY_SAGITTAL', 0) === 1 && a !== 2) return fb;
      const src = wbcCur ? wbcPrev : wbcLast;
      const k = axesWbc.indexOf(di(w, n, a));
      const qp = k >= 0 ? (src?.tau[k] ?? fb) : fb;
      let t0 = _wbcApplyStart.get(w);
      if (t0 === undefined) { t0 = w.clock; _wbcApplyStart.set(w, t0); }
      const rampT = Math.max(1e-3, Math.abs(num('SQC_WBC_RAMP_T', 0.35)));
      const alphaMax = Math.max(0, Math.min(1, num('SQC_WBC_APPLY_ALPHA', 0.5)));
      const alpha = wbcHold * Math.min(alphaMax, Math.max(0, (w.clock - t0) / rampT));
      return qp * alpha + fb * (1 - alpha);
    };
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
    if (copCtrlOn && fc.contact) {
      const omega = Math.sqrt(9.81 / Math.max(0.3, hipFrame.comY));
      const xcp = hipFrame.comX + hipFrame.comVX / omega;
      const zcp = hipFrame.comZ + hipFrame.comVZ / omega;
      const safeX = Math.max(0.005, fc.copHalfX - Math.abs(num('SQC_COP_SAFE_MARGIN', 0.005)));
      const safeZ = Math.max(0.005, fc.copHalfZ - Math.abs(num('SQC_COP_SAFE_MARGIN', 0.005)));
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
    const supFf = supPlan.supFf;
    p2Soft = Math.max(p2Soft, baseSag.relax);
    const baseHip0Target = baseSag.hip0Target;
    const baseHip1Target = baseSag.hip1Target;
    const baseHip2Target = baseSag.hip2Target;
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
    }
    const hip0Out = baseHip0Target;
    const hip1Out = baseHip1Target;
    const hip0Soft = num('SQC_HIP0_SOFT_ON', 0) === 1;
    const supportZ = clampComZ(0.5 * (fcS.l.footZ + fcS.r.footZ));
    const eComZ = supportZ - hipFrame.comZ;
    const eComVZ = -hipFrame.comVZ;
    const hip0CmdRaw = clampHip0((hip0Soft ? t[s].hip0 : hip0Out) + man.hip0);
    const hip0Cmd = hip0CmdRaw;
    const hip1Soft = num('SQC_HIP1_SOFT_ON', 1) === 1;
    const hip1CmdRaw = (hip1Soft ? t[s].hip1 : hip1Out) + man.hip1;
    const hip1Cmd = hip1CmdRaw;
    const hip2Out = clampHip2(baseHip2Target);
    const hip2Cmd = hip2Out + man.hip2;
    {
      const g = globalThis as unknown as { __HIP_SRC?: Record<string, unknown> };
      const o = g.__HIP_SRC ?? {};
      o[s] = { base0: baseHip0Target, base1: baseHip1Target, out0: hip0Cmd, out1: hip1Cmd, loadEH, lowSide: loadLow };
      g.__HIP_SRC = o;
    }
    const hubKpOut = 1;
    const hubKdOut = 1;
    const shankOut = 1;
    {
      const gs = globalThis as unknown as { __SAG16?: Record<string, unknown> };
      const os = gs.__SAG16 ?? {};
      os[s] = { base: 1, hipFf: 0, idHip: 0, idKnee: 0 };
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
    muscle(w, `hip_${s}`, 0, wbcBase(`hip_${s}`, 0, 0), 'squat.hip0', 20, 0, 0, Math.abs(hip0Cap));
    const hip1Kp = pairLat ? (hip1Soft ? num('SQC_HIP1_SOFT_KP', 200) : num('SQC_HIP1_ROLL_KP', 200)) : lock1 ? num('SQC_HIP1_LOCK_KP', 2500) : hip1Soft ? num('SQC_HIP1_SOFT_KP', 200) : num('SQC_HIP1_ROLL_KP', 200);
    const hip1Kd = pairLat ? (hip1Soft ? num('SQC_HIP1_SOFT_KD', 20) : num('SQC_HIP1_ROLL_KD', 10)) : lock1 ? num('SQC_HIP1_LOCK_KD', 50) : hip1Soft ? num('SQC_HIP1_SOFT_KD', 20) : num('SQC_HIP1_ROLL_KD', 10);
    muscle(w, `hip_${s}`, 1, wbcBase(`hip_${s}`, 1, 0), 'squat.hip1', 10, 0, 0, Math.abs(pairLat ? num('SQC_HIP1_CAP', 80) : lock1 ? num('SQC_HIP1_LOCK_CAP', 300) : num('SQC_HIP1_CAP', 80)));
    const kneeAng = w.body.dofs[di(w, `knee_${s}`, 2)]?.angle ?? 0;
    const foot2T = clampFoot2(ik.foot2);
    {
      // 目标向量（WBC 姿态任务 / 旧的 QP 目标同口径；不参与 PD 执行）
      const hi = di(w, `hip_${s}`, 2);
      const ki = di(w, `knee_${s}`, 2);
      const fi = di(w, `foot_${s}`, 2);
      if (hi >= 0) cmdTarget[hi] = baseSag.hip2Target;
      if (ki >= 0) cmdTarget[ki] = baseSag.knee2Support;
      if (fi >= 0) cmdTarget[fi] = ik.foot2;
      const h0 = di(w, `hip_${s}`, 0); if (h0 >= 0) cmdTarget[h0] = hip0Cmd;
      const h1 = di(w, `hip_${s}`, 1); if (h1 >= 0) cmdTarget[h1] = hip1Cmd;
      const k0 = di(w, `knee_${s}`, 0); if (k0 >= 0) cmdTarget[k0] = knee0Cmd;
      const k1 = di(w, `knee_${s}`, 1); if (k1 >= 0) cmdTarget[k1] = ang(w, `knee_${s}`, 1);
      const f0 = di(w, `foot_${s}`, 0); if (f0 >= 0) cmdTarget[f0] = foot0Cmd;
      const f1 = di(w, `foot_${s}`, 1); if (f1 >= 0) cmdTarget[f1] = shankPlan.foot1;
    }
    // 命令层：大腿段 + 小腿段两段 PD（唯一命令层）。
    const cj = squatComJ(w, s);
    const hMode = String(envCmd.SQC_CMD_H ?? 'loads');
    let hHip = idTorque.hip;
    let hKnee = idTorque.knee;
    let hAnkle = idTorque.ankle;
    if (hMode === 'loads') {
      const loads = measureJointLoads(w);
      const hOf = (n: string): number => loads.find((l) => l.name === n)?.torque ?? 0;
      hHip = hOf(`hip_${s}`);
      hKnee = hOf(`knee_${s}`);
      hAnkle = hOf(`foot_${s}`);
    } else if (hMode === 'model') {
      // WBC 同款浮动基模型 h（重力+Coriolis，含上身负载），按低频缓存
      let mh = _modelH.get(w);
      const hzM = Math.max(1, Math.abs(num('SQC_CMD_MODEL_HZ', 15)));
      if (!mh || w.clock - mh.t >= 1 / hzM) {
        const contacts: ContactSpec[] = (['l', 'r'] as const).map((side) => {
          const f = fcS[side];
          const sx = Math.max(0.005, f.copHalfX - Math.abs(num('SQC_COP_SAFE_MARGIN', 0.005)));
          const sz = Math.max(0.005, f.copHalfZ - Math.abs(num('SQC_COP_SAFE_MARGIN', 0.005)));
          return { side, point: { x: f.footX, y: f.footY, z: f.footZ }, minX: f.footX - sx, maxX: f.footX + sx, minZ: f.footZ - sz, maxZ: f.footZ + sz };
        });
        const mm = computeFloatingModel(w, contacts, 1 / hzM);
        mh = { t: w.clock, h: mm.h };
        _modelH.set(w, mh);
      }
      const at = (n: string): number => axesWbc.indexOf(di(w, n, 2));
      hHip = mh.h[6 + at(`hip_${s}`)] ?? hHip;
      hKnee = mh.h[6 + at(`knee_${s}`)] ?? hKnee;
      hAnkle = mh.h[6 + at(`foot_${s}`)] ?? hAnkle;
    }
    hHip *= num('SQC_CMD_H_SGN', 1) * num('SQC_CMD_H_HIP_SGN', 1) * num('SQC_CMD_H_HIP_GAIN', 1) * num('SQC_CMD_H_GAIN', 1);
    hKnee *= num('SQC_CMD_H_SGN', 1) * num('SQC_CMD_H_KNEE_SGN', 1) * num('SQC_CMD_H_KNEE_GAIN', 1) * num('SQC_CMD_H_GAIN', 1);
    hAnkle *= num('SQC_CMD_H_SGN', 1) * num('SQC_CMD_H_ANKLE_SGN', 1) * num('SQC_CMD_H_ANKLE_GAIN', 1) * num('SQC_CMD_H_GAIN', 1);
    const copMin = fc.footX - Math.max(0.005, fc.copHalfX - Math.abs(num('SQC_COP_SAFE_MARGIN', 0.005)));
    const copMax = fc.footX + Math.max(0.005, fc.copHalfX - Math.abs(num('SQC_COP_SAFE_MARGIN', 0.005)));
    const capH = Math.abs(num('SQC_HIP2_CAP', 150));
    const capK = Math.abs(num('SQC_SUPPORT_CAP', 200));
    const capA = Math.abs(num('SQC_FOOT2_CAP', 120));
    const hipCmd = solveSquatHipDynamics({
      com: [hipFrame.comX, hipFrame.comZ, hipFrame.comY],
      comTarget: [supportX, supportZ, num('SQC_CMD_COM_Y', st.y0)],
      comVel: [hipFrame.comVX, hipFrame.comVZ, 0],
      jCom: [[cj[0][0], cj[1][0]], [cj[0][2], cj[1][2]], [cj[0][1], cj[1][1]]],
      h: [hHip, hKnee],
      tauMin: [-capH, -capK],
      tauMax: [capH, capK],
      kpF: num('SQC_ID_KPF', 600),
      kdF: num('SQC_ID_KDF', 60),
    });
    const shankCmd = solveSquatShankDynamics({
      cop: fc.copXFiltered,
      copTarget: fc.copXFiltered - eCopX,
      copMin,
      copMax,
      fz: fc.fzFiltered,
      h: hAnkle,
      tauMin: -capA,
      tauMax: capA,
      kpCop: num('SQC_ID_KPCOP', -3),
      copCap: num('SQC_ID_COPCAP', 80),
    });
    const ok = Number.isFinite(hipCmd[0]) && Number.isFinite(hipCmd[1]) && Number.isFinite(shankCmd);
    let bHip = ok ? Math.max(-capH, Math.min(capH, hipCmd[0])) : Math.max(-capH, Math.min(capH, hHip));
    let bKnee = ok ? Math.max(-capK, Math.min(capK, hipCmd[1])) : Math.max(-capK, Math.min(capK, hKnee));
    let bAnkle = ok ? Math.max(-capA, Math.min(capA, shankCmd)) : Math.max(-capA, Math.min(capA, hAnkle));
    bHip = wbcBase(`hip_${s}`, 2, bHip);
    bKnee = wbcBase(`knee_${s}`, 2, bKnee);
    bAnkle = wbcBase(`foot_${s}`, 2, bAnkle);
    // 髋高护栏（用户验收：髋不往上飞）：髋高于 IK 目标时，只做单向下压。
    // 符号来自关节实测：+hip2 / −knee2 使髋 anchor Y 下降。
    if (num('SQC_HIP_GUARD_ON', 1) === 1) {
      const over = Math.max(0, hipHigh - Math.abs(num('SQC_HIP_GUARD_DEAD', 0.01)));
      const gh = Math.min(Math.abs(num('SQC_HIP_GUARD_CAP', 80)), over * Math.abs(num('SQC_HIP_GUARD_K', 3000)));
      const gk = Math.min(Math.abs(num('SQC_HIP_GUARD_CAP', 80)), over * Math.abs(num('SQC_HIP_GUARD_KNEE_K', 2000)));
      bHip = Math.max(-capH, Math.min(capH, bHip + gh));
      bKnee = Math.max(-capK, Math.min(capK, bKnee - gk));
    }
    (globalThis as { __WBC?: unknown }).__WBC = {
      s,
      mode: 'pd',
      base: [idTorque.hip, idTorque.knee, idTorque.ankle],
      h: [hHip, hKnee, hAnkle],
      out: [bHip, bKnee, bAnkle],
      finite: ok,
      sat: [Math.abs(bHip) >= capH - 1e-6, Math.abs(bKnee) >= capK - 1e-6, Math.abs(bAnkle) >= capA - 1e-6],
    };
    const supportKd = num('SQC_PD_SUPPORT_KD', 10);
    const passiveStiffScale = 1 - Math.min(1, Math.max(0, baseSag.relax));
    muscle(w, `hip_${s}`, 2, bHip, 'squat.hip2', supportKd, num('SQC_HIP_PASSIVE_K', 10) * passiveStiffScale, 1 / 57.3, Math.abs(num('SQC_HIP2_CAP', 150)), t[s].hip2);
    let gripDbg = 0;
    let act0Dbg = 0;
    {
      muscle(w, `knee_${s}`, 2, bKnee, 'squat.knee2', supportKd, num('SQC_KNEE_PASSIVE_K', 5) * passiveStiffScale, 1 / 57.3, Math.abs(num('SQC_SUPPORT_CAP', 200)), t[s].knee2);
    }
    {
      muscle(w, `knee_${s}`, 0, wbcBase(`knee_${s}`, 0, 0), 'squat.knee0', 12, 0, 0, Math.abs(num('SQC_KNEE0_CAP', 120)));
      muscle(w, `knee_${s}`, 1, wbcBase(`knee_${s}`, 1, 0), 'squat.knee1', wbcApply ? num('SQC_WBC_LAT_KD', 5) : 0, 0, 0, Math.abs(num('SQC_KNEE1_CAP', 150)));
      const latPdg = lateral.align;
      const latGain = latPdg ? lateral.soft : 0;
      const f0Kp = num('SQC_FOOT0_KP', 20) + (num('SQC_SHANK_FOOT0_KP', 160) - num('SQC_FOOT0_KP', 20)) * latGain;
      const f0Kd = num('SQC_FOOT0_KD', 0) + (num('SQC_SHANK_FOOT0_KD', 0) - num('SQC_FOOT0_KD', 0)) * latGain;
      const f0Cap = Math.abs(num('SQC_FOOT0_CAP', 60)) + (Math.abs(num('SQC_SHANK_FOOT0_CAP', 60)) - Math.abs(num('SQC_FOOT0_CAP', 60))) * latGain;
      const f0Src = latPdg ? 'squat.foot0.lat' : 'squat.foot0';
      const frictionUse = ctl.perception.feet[s === 'l' ? 0 : 1]!.frictionUse;
      const gripBudget = fc.contact
        ? Math.max(0, Math.min(1, Math.min(fc.fzFiltered / Math.max(1, fzTarget), 1 - frictionUse / Math.max(1e-6, frictionMax), 1 - fc.footSpeed / 0.5)))
        : 0;
      const actFoot0 = smoothAct(w, `foot0_${s}`, actOf(baseSag.foot0, cmdPosRaw(w, `foot_${s}`, 0, foot0Cmd, f0Kp), f0Cap) * gripBudget * Math.abs(num('SQC_COP_ANKLE_SHARE', 0.8)));
      gripDbg = gripBudget; act0Dbg = actFoot0;
      const foot0Ff = smoothCmd(w, `foot0ff_${s}`, baseSag.foot0);
      muscle(w, `foot_${s}`, 0, wbcBase(`foot_${s}`, 0, actFoot0 * f0Cap), 'squat.foot0', wbcApply ? Math.max(f0Kd, num('SQC_WBC_FOOT_KD', 3)) : f0Kd, 0, 0, f0Cap);
      const actFoot1 = smoothAct(w, `foot1_${s}`, (actFoot0 / Math.max(1e-6, Math.abs(num('SQC_COP_ANKLE_SHARE', 0.8)))) * gripBudget * Math.abs(num('SQC_COP_FOOT_SHARE', 0.05)));
      muscle(w, `foot_${s}`, 1, wbcBase(`foot_${s}`, 1, actFoot1 * Math.abs(num('SQC_FOOT1_CAP', 120))), 'squat.foot1', wbcApply ? num('SQC_WBC_FOOT_KD', 3) : 0, 0, 0, Math.abs(num('SQC_FOOT1_CAP', 120)));

    }
    // 矢状踝是承重链末端：接触短暂丢失时也保持关节角，不允许踝在卸载瞬间完全消失。
    // ★ 实测：-0.0005 会把左脚 CoP 推到 0.13、fz 201/346；关闭后恢复 331/333。
    // 踝不归矢状回正：只维持 base/IK，力链/抓地由小腿通道负责（架构 §12.1）。
    muscle(w, `foot_${s}`, 2, bAnkle, 'squat.foot2', wbcApply ? Math.max(num('SQC_FOOT_PASSIVE_B', 2), num('SQC_WBC_FOOT2_B', 3)) : num('SQC_FOOT_PASSIVE_B', 2), num('SQC_FOOT_PASSIVE_K', 30) * (1 - 0.5 * Math.min(1, Math.max(0, baseSag.relax))), 1 / 57.3, Math.abs(num('SQC_FOOT2_CAP', 120)), t[s].foot2);
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
        hip2T: hip2Out, hip2Cmd, bHip, bKnee, bAnkle, hip2Act: Math.max(-1, Math.min(1, bHip / Math.max(1e-6, Math.abs(num('SQC_HIP2_CAP', 150))))),
        idHip2: 0, toneHip2: 0,
        applied: led?.applied ?? 0, cmd: led?.cmd ?? 0, writes: led?.writes ?? 0, sat: led?.saturated ? 1 : 0,
        pair: led?.pair ?? 0, passive: led?.passive ?? 0, limit: led?.limit ?? 0,
        servo: br.servo ?? 0, stiff: br.stiff ?? 0, damp: br.damp ?? 0, ff: br.ff ?? 0, act: br.act ?? 0, itb: br.itb ?? 0, lum: br.lum ?? 0,
        Bact: dp.actuator ?? 0, Bref: dp.reflex ?? 0, Btgt: dp.target ?? 0, Bjoint: dp.joint ?? 0,
        Bapp: dp.applied ?? 0, Bbmax: dp.bmax ?? 0, Btv: dp.targetValue ?? 0, Btk: dp.targetKp ?? 0,
        supP2: 0, tension: 0,
        hipHigh, hipLow, relax, baseGate: baseSag.baseGate,
        copX: fc.copXFiltered, copZ: fc.copZFiltered, copMx: fc.copMarginX, copMz: fc.copMarginZ,
        comX: hipFrame.comX, comVX: hipFrame.comVX, fz: fc.fzFiltered,
        knee0: leg.qKnee0, hip0: leg.qHip0,
        foot0Q: ang(w, `foot_${s}`, 0), foot0T: foot0Cmd, foot0App: l0?.applied ?? 0, foot0Ff: baseSag.foot0,
        foot2Q: ang(w, `foot_${s}`, 2), foot2V: w.body.dofs[f2i]?.vel ?? 0, foot2T, foot2App: l2?.applied ?? 0, foot2Ff: ankleFfOut,
        actFoot0: act0Dbg, gripBudget: gripDbg,
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
        hip0T: hip0Out, foot0T, knee0T: shankPlan.knee0, hip2T: hip2Out, foot2T,
        supFf, relax: baseSag.relax,
        baseHip: baseSag.hip, baseGate: baseSag.baseGate, kneeHipFlex: baseSag.kneeHipFlex,
        baseKnee2Support: baseSag.knee2Support,
        lateralFoot0,
        latF: fActual.fLat, latPerp: fActual.fPerp, latChain: fActual.fParallel, latCopZ: fActual.copZ, latFric: fActual.frictionUtil, latCopIn: fActual.copInside,
        copX: fc.copXFiltered, copZ: fc.copZFiltered, copMarginX: fc.copMarginX, copMarginZ: fc.copMarginZ, copMarginNorm: fc.copMarginNorm, copVelX: fc.copVelX, copVelZ: fc.copVelZ, footX: fc.footX, footZ: fc.footZ,
        hipHigh, hipLow, hipTargetY: hipTarget.y, hipAnchorY: h2nowY, eSag: supportX - hipFrame.comX, gripBudget: gripDbg, actFoot0: act0Dbg, footY: (() => { const bi = w.body.indexByKey.get(`foot_${s}`); return bi !== undefined ? w.body.bodies[bi]!.translation().y : 0; })(), footVY: (() => { const bi = w.body.indexByKey.get(`foot_${s}`); return bi !== undefined ? w.body.bodies[bi]!.linvel().y : 0; })(), fz: fc.fzFiltered, gripFz: fc.fzFiltered / Math.max(1, fzTarget), gripFric: 1 - ctl.perception.feet[s === 'l' ? 0 : 1]!.frictionUse / Math.max(1e-6, frictionMax), gripSpeed: 1 - fc.footSpeed / 0.5, footSpeed: fc.footSpeed, frictionUse: ctl.perception.feet[s === 'l' ? 0 : 1]!.frictionUse,
        baseAnkle: baseSag.ankle, ikAnkle: ik.foot2, ankleFf: ankleFfOut, foot0Ff: baseSag.foot0, foot2Ff: ankleFfOut,
        hip2Q: h2 >= 0 ? w.body.dofs[h2]!.angle : 0, knee2Q: kneeAng,
        hipT: 0, kneeT: 0, shankT: 0,
      };
      g.__SQUAT_DBG = o;
    }
    // 脚离地时不再写膝/踝 damp；接触丢失后不让阻尼继续制造高频力矩
  }
  // ── 浮动基 WBC（shadow 默认；SQC_WBC=apply 才施加）──
  if (wbcMode !== 'off') {
    const hz = Math.max(1, Math.abs(num('SQC_WBC_HZ', 10)));
    if (w.clock - wbcCache.t >= 1 / hz) {
      const t0 = Date.now();
      const contacts: ContactSpec[] = (['l', 'r'] as const).map((side) => {
        const f = fcS[side];
        const sx = Math.max(0.005, f.copHalfX - Math.abs(num('SQC_COP_SAFE_MARGIN', 0.005)));
        const sz = Math.max(0.005, f.copHalfZ - Math.abs(num('SQC_COP_SAFE_MARGIN', 0.005)));
        let px = f.footX, py = f.footY, pz = f.footZ;
        if (num('SQC_CONTACT_PHYS', 0) === 1) {
          const fbi = w.body.indexByKey.get(`foot_${side}`);
          if (fbi !== undefined) { const c = w.body.bodies[fbi]!.worldCom(); px = c.x; py = c.y; pz = c.z; }
        }
        return {
          side,
          point: { x: px, y: py, z: pz },
          minX: f.footX - sx, maxX: f.footX + sx,
          minZ: f.footZ - sz, maxZ: f.footZ + sz,
        };
      });
      const capAt = (n: string, a: number): number => {
        if (/^hip_/.test(n)) return a === 0 ? num('SQC_HIP0_CAP', 150) : a === 1 ? num('SQC_HIP1_CAP', 80) : num('SQC_HIP2_CAP', 150);
        if (/^knee_/.test(n)) return a === 0 ? num('SQC_KNEE0_CAP', 120) : a === 1 ? num('SQC_KNEE1_CAP', 150) : num('SQC_SUPPORT_CAP', 200);
        if (/^foot_/.test(n)) return a === 0 ? num('SQC_FOOT0_CAP', 60) : a === 1 ? num('SQC_FOOT1_CAP', 120) : num('SQC_FOOT2_CAP', 120);
        return 200;
      };
      const q18 = axesWbc.map((a) => w.body.dofs[a]!.angle);
      const qMin = axesWbc.map((a) => w.body.dofs[a]!.min);
      const qMax = axesWbc.map((a) => w.body.dofs[a]!.max);
      const tauMin = axesWbc.map((a) => -capAt(w.body.dofs[a]!.name, w.body.dofs[a]!.axis));
      const tauMax = axesWbc.map((a) => capAt(w.body.dofs[a]!.name, w.body.dofs[a]!.axis));
      let bt = _wbcBaseTarget.get(w);
      if (!bt) {
        const bi = w.body.indexByKey.get('torso');
        if (bi !== undefined) { const q = w.body.bodies[bi]!.rotation(); bt = { x: q.x, y: q.y, z: q.z, w: q.w }; _wbcBaseTarget.set(w, bt); }
        else bt = { x: 0, y: 0, z: 0, w: 1 };
      }
      const model = computeFloatingModel(w, contacts, 1 / hz);
      const qd18 = Array.from(model.qd18);
      const out = String(envCmd.SQC_WBC_SOFT ?? '0') === '1' ? solveWbc({
        model,
        q18,
        qd18,
        qMin,
        qMax,
        tauMin,
        tauMax,
        qTarget18: axesWbc.map((a) => cmdTarget[a]!),
        comTarget: [
          clampComX(0.5 * (fcS.l.footX + fcS.r.footX)),
          clampComZ(0.5 * (fcS.l.footZ + fcS.r.footZ)),
          num('SQC_WBC_COM_Y', st.y0),
        ],
        comKp: num('SQC_WBC_COM_KP', 8),
        comKd: num('SQC_WBC_COM_KD', 2.5),
        baseTarget: bt,
        baseKp: num('SQC_WBC_BASE_KP', 30),
        baseKd: num('SQC_WBC_BASE_KD', 8),
        postureKp: num('SQC_WBC_POST_KP', 8),
        postureKd: num('SQC_WBC_POST_KD', 2.5),
        dt: 1 / hz,
        mu: num('SQC_WBC_MU', 0.8),
        qddCap: num('SQC_WBC_QDD_CAP', 100),
        wCom: num('SQC_WBC_WCOM', 1000),
        wBase: num('SQC_WBC_WBASE', 1000),
        wPost: num('SQC_WBC_WPOST', 1),
        wTau: num('SQC_WBC_WTAU', 1e-2),
        wForce: num('SQC_WBC_WFORCE', 1e-3),
        wQdd: num('SQC_WBC_WQDD', 1e-2),
        wSlack: num('SQC_WBC_WSLACK', 1000),
        maxIter: num('SQC_WBC_IT', 2000),
        warm: wbcCache.warm,
      }) : solveWbcHard({
        model,
        q18,
        qd18,
        qMin,
        qMax,
        tauMin,
        tauMax,
        qTarget18: axesWbc.map((a) => cmdTarget[a]!),
        comTarget: [
          clampComX(0.5 * (fcS.l.footX + fcS.r.footX)),
          clampComZ(0.5 * (fcS.l.footZ + fcS.r.footZ)),
          num('SQC_WBC_COM_Y', st.y0),
        ],
        comKp: num('SQC_WBC_COM_KP', 8),
        comKd: num('SQC_WBC_COM_KD', 2.5),
        baseTarget: bt,
        baseKp: num('SQC_WBC_BASE_KP', 30),
        baseKd: num('SQC_WBC_BASE_KD', 8),
        postureKp: num('SQC_WBC_POST_KP', 8),
        postureKd: num('SQC_WBC_POST_KD', 2.5),
        dt: 1 / hz,
        mu: num('SQC_WBC_MU', 0.8),
        qddCap: num('SQC_WBC_QDD_CAP', 100),
        wCom: num('SQC_WBC_WCOM', 1000),
        wBase: num('SQC_WBC_WBASE', 1000),
        wPost: num('SQC_WBC_WPOST', 1),
        wTau: num('SQC_WBC_WTAU', 1e-2),
        wForce: num('SQC_WBC_WFORCE', 1e-3),
        wQdd: num('SQC_WBC_WQDD', 1e-2),
        wSlack: num('SQC_WBC_WSLACK', 1000),
        wCwc: num('SQC_WBC_WCWC', 1000),
        wContact: num('SQC_WBC_WCONTACT', 1e4),
        wCop: num('SQC_WBC_WCOP', 10),
        wForceLat: num('SQC_WBC_WFORCELAT', 1),
        maxIter: num('SQC_WBC_IT_HARD', 800),
      });
      wbcCache.t = w.clock;
      wbcCache.out = out;
      wbcCache.warm = { x: out.warmX, z: out.warmZ, y: out.warmY };
      if (out.ok) { wbcCache.lastOk = out; wbcCache.lastOkT = w.clock; }
      let sTauMax = 0;
      for (const v of out.sTau) sTauMax = Math.max(sTauMax, v);
      let sJointMax = 0;
      for (const v of out.sJoint) sJointMax = Math.max(sJointMax, v);
      (globalThis as { __WBC2?: unknown }).__WBC2 = {
        t: w.clock,
        mode: wbcMode,
        ok: out.ok,
        maxViol: out.maxViolation,
        qddMax: out.qddMax,
        qddJointMax: out.qddJointMax,
        tauMax: out.tauMax,
        slackMax: out.slackMax,
        sContactMax: out.sContactMax ?? 0,
        sCwcMax: out.sCwcMax ?? 0,
        sTauMax,
        sJointMax,
        iters: out.iterations,
        prim: out.primalRes,
        dual: out.dualRes,
        ms: Date.now() - t0,
        tau: Array.from(out.tau),
        fL: Array.from(out.fL),
        fR: Array.from(out.fR),
      };
    }
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
