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
import { computeFootControl } from './footControl';

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
function buildSupport(q: SideTarget, fc: ReturnType<typeof sampleFootContact>): SupportCommand {
  return {
    side: q === undefined ? 'l' : (fc.side),
    hip0: q.hip0,
    knee2: q.knee2,
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

/** 只生成回正关节目标，不生成 N。 */
function buildRighting(side: 'l' | 'r', q: SideTarget, fc: ReturnType<typeof sampleFootContact>): RightingCommand {
  const fcOut = computeFootControl(fc, { foot0: q.foot0, foot1: q.foot1, foot2: q.foot2 });
  return {
    side,
    knee0: q.knee0,
    foot0: fcOut.foot0,
    foot1: fcOut.foot1,
    foot2: fcOut.foot2,
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
  return t;
}

/** 只保留矢状基础力；侧向由 PD/被动层负责。 */
export function squatPairBase(w: World, ctl: ControlModule): void {
  if (baseState() !== 'squat') return;
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_PAIR_OFF ?? '0') === '1') return;
  const buf = (ctl.warner as unknown as { squatBaseBuf(): Float64Array | null }).squatBaseBuf();
  if (!buf) return;
  const c = Number(env.SQC_PAIR_C ?? (baseParams() as { pairC?: number }).pairC ?? 0.7);
  for (const d of w.body.dofs) {
    if (d.engineMotor || d.preRing || d.axis !== 2) continue;
    if (!/^(hip|knee|spine|neck|foot)/.test(d.name)) continue;
    const tau = buf[d.dofIndex] ?? 0;
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
  resetFootSensor(w);
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
  const dead = Math.abs(num('SQC_PD_DEADBAND', 4));
  const rawPd = Math.abs(rawPd0) < dead ? 0 : rawPd0;
  let m = _tauPrev.get(w);
  if (!m) { m = new Map(); _tauPrev.set(w, m); }
  const prev = m.get(i);
  const slew = Math.abs(num('SQC_TAU_SLEW', 3));
  const pd = prev === undefined ? rawPd : Math.max(prev - slew, Math.min(prev + slew, rawPd));
  m.set(i, pd);
  // 基础力前馈直接加在 PD 之后，不再被 PD slew 延迟
  const tau = Math.max(-cap, Math.min(cap, pd + ff));

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
    const ffCap = num('SQC_UPPER_FF_CAP', 40);
    const ff = Math.max(-ffCap, Math.min(ffCap, ffRaw));
    pd(w, d.name, d.axis, target, num('SQC_UPPER_KP', 150), num('SQC_UPPER_KD', 2), 80, 'squat.upperSupport', ff);
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

export function squatFrame(w: World, ctl: ControlModule, st: CS): void {
  courtStep(w, ctl, st);
  // 法庭已经判死后不再跑蹲下 PD，避免倒地把控制器带成高频抽搐
  if (st.fall >= 0) return;
  const pre = preload(st);
  // 冻结期除最后预载窗口外不允许任何原地 PD 写手
  if (!pre && !st.released) return;
  const baseBuf = (ctl.warner as unknown as { squatBaseBuf(): Float64Array | null }).squatBaseBuf();
  // 预载窗口内就让基础力就位，释放时不再从 0 ramp
  const baseRamp = (pre || st.released) ? 1 : 0;
  const ff = (name: string, axis: number): number => {
    const i = di(w, name, axis);
    return baseBuf && i >= 0 ? (baseBuf[i] ?? 0) * baseRamp * num('SQC_BASE_SCALE', 1) : 0;
  };
  const t = capture(w, st);
  upperSupport(w, st, baseBuf, baseRamp);
  for (const s of ['l', 'r'] as const) {
    const q = t[s];
    const fc = sampleFootContact(w, s);
    const has = fc.contact;
    const support = buildSupport(q, fc);
    const chain = buildChain(fc);
    pd(w, `hip_${s}`, 0, support.hip0, num('SQC_HIP0_KP', 1200), num('SQC_HIP0_KD', 20), 80, 'squat.hip0');
    const capFactor = chain.contact ? Math.max(0, Math.min(1, 1 - Math.max(0, chain.utilization - 0.8) / 0.2)) : 0;
    const k2Target = chain.capacity > 0 ? support.knee2 + capFactor * Math.max(-0.15, Math.min(0.15, support.fSupport * 0.0004)) : support.knee2;
    const h2 = di(w, `hip_${s}`, 2);
    const k2 = di(w, `knee_${s}`, 2);
    if (h2 >= 0) { const d = w.body.dofs[h2]!; const lim = num('SQC_HIP2_LIMIT_DEG', 8) / 57.3; d.min = q.hip2 - lim; d.max = q.hip2 + lim; }
    if (k2 >= 0) { const d = w.body.dofs[k2]!; const lim = num('SQC_KNEE2_LIMIT_DEG', 8) / 57.3; d.min = q.knee2 - lim; d.max = q.knee2 + lim; }
    pd(w, `hip_${s}`, 2, q.hip2, num('SQC_SUPPORT_KP', 50), num('SQC_SUPPORT_KD', 2), 80, 'squat.hip2', ff(`hip_${s}`, 2));
    pd(w, `knee_${s}`, 2, k2Target, num('SQC_SUPPORT_KP', 50), num('SQC_SUPPORT_KD', 2), 80, 'squat.knee2', ff(`knee_${s}`, 2));
    const right = buildRighting(s, q, fc);
    if (has) {
      pd(w, `knee_${s}`, 0, right.knee0, 300, 12, 40, 'squat.knee0');
      pd(w, `foot_${s}`, 0, right.foot0, 60, 4, 40, 'squat.foot0');
      pd(w, `foot_${s}`, 1, right.foot1, 40, 3, 30, 'squat.foot1');
      pd(w, `foot_${s}`, 2, right.foot2, 180, 12, 60, 'squat.foot2', ff(`foot_${s}`, 2));
    }
    // 脚离地时不再写膝/踝 damp；接触丢失后不让阻尼继续制造高频力矩
    const h1 = di(w, `hip_${s}`, 1);
    if (h1 >= 0) { const d = w.body.dofs[h1]!; d.min = q.hip1 - 2 / 57.3; d.max = q.hip1 + 2 / 57.3; }
  }
}
