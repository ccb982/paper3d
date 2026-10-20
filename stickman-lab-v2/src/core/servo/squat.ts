/** squat.ts —— 蹲下模块（唯一入口，2026-10-21 重建）
 *
 * 职责只有两件：
 *   ① 脚：FootPad（自主抓地）+ 踝软限位（在 supportClean 的 ft 分支保留）
 *   ② 阻尼：td（drive 全局）+ srs + ow（kernel.dampTorque）
 *
 * 铁律：
 *   · 本模块**不写任何关节基础力/回正力/主动力矩**；
 *   · 目标姿势 = 法庭捕获的 ref（只读，永不跟随）；
 *   · 后续要加基础力/回正力，必须作为独立函数显式接入，并在本文档登记。
 */

import { baseState, baseParams } from './baseTable';
import { dampTorque } from './kernel';

export interface SquatCtx {
  body: {
    dofs: Array<{ name: string; axis: number; dofIndex: number; angle: number; vel: number }>;
  };
  dt: number;
}

/** 蹲姿每帧：只返回阻尼力矩（三层的 srs/ow 分量；td 由 drive 自己算） */
export function squatDamp(ctx: SquatCtx, dt: number, outwardOf: (dofIndex: number) => boolean): Array<{ dof: number; tau: number; src: string }> {
  if (baseState() !== 'squat') return [];
  const out: Array<{ dof: number; tau: number; src: string }> = [];
  const bp = baseParams();
  void bp;
  for (const d of ctx.body.dofs) {
    const part = /^(hip|knee|foot|ankle)/.test(d.name) ? 'leg'
      : /^spine/.test(d.name) ? 'spine'
      : /^neck/.test(d.name) ? 'neck'
      : /^(shoulder|elbow)/.test(d.name) ? 'arm' : 'other';
    const outward = outwardOf(d.dofIndex);
    const r = dampTorque({ part, vel: d.vel, velPrev: d.vel, tauMax: 200, inertiaLow: 0.01, velMax: 0, inertia: 0.01, dev: 0, outward, dt, b: 0, kd: NaN, tgt: NaN, acted: true, srsK: 0, kdBase: 0 });
    const tau = r.srs + r.ow;
    if (Math.abs(tau) > 0.01) out.push({ dof: d.dofIndex, tau, src: 'squat.damp' });
  }
  return out;
}


// ── 蹲姿基础力：脚主动蹬地（Jᵀ·F）+ 踝接触力闭环（2026-10-21 用户定稿）──
import { propose, PRI } from '../proposalBus';

/**
 * 力从脚来（唯一外力=地面反力）：
 *   1. 需求：每脚 N=W/2，作用点 CoP（初始姿势 CoM 投影，钳位脚内）
 *   2. 关节力矩 = Jᵀ·F：τ_j = −[子树重力 + N·(CoP−x_j)]（踝/膝/髋；脊柱只子树）
 *   3. **脚主动补足**：τ_ankle += Kf·(N − fz_measured)（接触力闭环，要多少发多少）
 * 全部走提案总线（kind:'torque' → drive.ff → squat 路径 out=bd.ff+td）。
 */
export function squatForce(w: World, ctl: ControlModule): void {
  void ctl;
  if (baseState() !== 'squat') return;
  const body = w.body;
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const g = 9.81;
  let mTot = 0;
  for (const rb of body.bodies) mTot += rb.mass();
  const N = (mTot * g) * 0.5;
  const com = new Float64Array(3);
  body.com(com);
  const comX = com[0]!;
  const fpos = (s: 'l' | 'r'): { x: number } => {
    const bi = body.indexByKey.get(`foot_${s}`);
    return bi === undefined ? { x: 0 } : { x: body.bodies[bi]!.translation().x };
  };
  const pl = fpos('l'), pr = fpos('r');
  const cl = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  const copL = cl(comX, pl.x - 0.12, pl.x + 0.12);
  const copR = cl(comX, pr.x - 0.12, pr.x + 0.12);
  const fzL = body.footNormalForce('l', w.dt);
  const fzR = body.footNormalForce('r', w.dt);
  const kF = Number(env.SQC_KF ?? 0.03);   // 接触力闭环增益（N·m/N）
  for (const d of body.dofs) {
    if (d.engineMotor) continue;
    const a = d.anchorWorld, u = d.axisWorld;
    let tau = 0;
    // 子树重力
    for (const bi of body.subtree[d.joint]!) {
      const rb = body.bodies[bi]!;
      const c = rb.worldCom();
      const Fy = rb.mass() * -g;
      tau += u[0]! * (-(c.z - a[2]!) * Fy) + u[2]! * ((c.x - a[0]!) * Fy);
    }
    // Jᵀ·F（脚蹬地需求；腿链）
    const isLeg = /^(hip|knee|foot|ankle)_/.test(d.name);
    if (isLeg) {
      const isL = d.name.endsWith('_l');
      const cop = isL ? copL : copR;
      tau += u[2]! * ((cop - a[0]!) * N);
      // 踝接触力闭环：实测不足 → 踝补
      if (/^(foot|ankle)_/.test(d.name)) {
        const fz = isL ? fzL : fzR;
        tau += u[2]! * (-kF * (N - fz) * 0.12);
      }
    }
    const out = -tau;
    if (Math.abs(out) > 1e-6) propose({ dof: d.dofIndex, kind: 'torque', pri: PRI.servo, tau: out, src: 'squat.base' });
  }
}


// ── 蹲姿基础力：**走肌肉对（pair）**（2026-10-21 用户定稿）──
import { baseAng } from './baseTable';

/**
 * 论文依据：
 *   · 每个关节由一对拮抗肌驱动（Latash 2018, PMC6093955）；
 *   · 共收缩调刚度/阻尼、净力矩不变（PMC3257849）→ F0 不产生净力矩；
 *   · 平衡点假说（Feldman 1966; Hogan 1984/1985）：λ（ref）决定平衡点，刚度由共激活定；
 *   · 拮抗肌可独立控制"关节力矩 + 关节刚度"（Atkeson: Antagonist Muscles can control both）。
 * 实现：基础力矩 τ_base 作为 pair 的净力矩基线（baseTau），ref=目标角（回正 PD）。
 *   细肌肉: f1−f2 = τ_base + kp·(ref−θ) − kd·ω   （F0 共模抵消）
 */
let _prevComX = 0;
let _hasPrevCom = false;
let _vComSm = 0;
let _sqBaseBuf: Float64Array | null = null;
let _comTargetX = 0;
let _copBaseL = 0;
let _copBaseR = 0;
export function squatPairBase(w: World, ctl: ControlModule): void {
  void ctl;
  if (baseState() !== 'squat') { _hasPrevCom = false; _sqBaseBuf = null; return; }
  const body = w.body;
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const g = 9.81;
  let mTot = 0;
  for (const rb of body.bodies) mTot += rb.mass();
  const W = mTot * g;
  const N = W * 0.5;
  const com = new Float64Array(3);
  body.com(com);
  const comX = com[0]!;
  const comY = Math.max(0.2, com[1]!);
  const dt = w.dt;
  const vRaw = _hasPrevCom ? (comX - _prevComX) / Math.max(1e-6, dt) : 0;
  _prevComX = comX;
  _hasPrevCom = true;
  // ★ 速度低通（有限差分噪声大；30ms EMA）
  const aV = 1 - Math.exp(-dt / 0.03);
  _vComSm += (vRaw - _vComSm) * aV;
  const vCom = _vComSm * Number(env.SQC_XCOM_GAIN ?? 1);
  const omega = Math.sqrt(g / comY);
  const fpos = (s: 'l' | 'r'): number => {
    const bi = body.indexByKey.get(`foot_${s}`);
    return bi === undefined ? 0 : body.bodies[bi]!.translation().x;
  };
  const cl = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  // ★ 踝策略（XcoM）：CoP = x_CoM + v/ω0，钳位脚掌内（脚不动，只改蹬地压力中心）
  const copL = cl(comX + vCom / omega, fpos('l') - 0.12, fpos('l') + 0.12);
  const copR = cl(comX + vCom / omega, fpos('r') - 0.12, fpos('r') + 0.12);
  // ★ 竖直力闭环（脚蹬地：要多少发多少）
  const fzL = body.footNormalForce('l', dt);
  const fzR = body.footNormalForce('r', dt);
  const kF = Number(env.SQC_KF ?? 0.5);
  const FyL = N + kF * (N - fzL);
  const FyR = N + kF * (N - fzR);
  const cPair = Number(env.SQC_PAIR_C ?? 0.7);
  // ★★★ 2026-10-21 用户（'基础力固定大小/释放瞬间算一次'）：固定基础力缓存——
  //   每帧重算是正反馈（姿势偏→基础力偏→把踝推走）。首次 outputScale>0（释放）时捕获，之后不变。
  if (_sqBaseBuf === null && w.drive.outputScale > 0) {
    _sqBaseBuf = new Float64Array(body.dofs.length);
    _comTargetX = comX;
    _copBaseL = copL;
    _copBaseR = copR;
    for (const d of body.dofs) {
      if (!(/^(hip|knee|foot|ankle|spine)/.test(d.name) && (d.axis === 0 || d.axis === 2))) continue;
      const a = d.anchorWorld, u = d.axisWorld;
      let tau = 0;
      for (const bi of body.subtree[d.joint]!) {
        const rb = body.bodies[bi]!;
        const c = rb.worldCom();
        const Fy = rb.mass() * -g;
        tau += u[0]! * (-(c.z - a[2]!) * Fy) + u[2]! * ((c.x - a[0]!) * Fy);
      }
      if (/^(hip|knee|foot|ankle)_/.test(d.name)) {
        const isL = d.name.endsWith('_l');
        const cop = isL ? copL : copR;
        const Fy = isL ? FyL : FyR;
        tau += u[2]! * ((cop - a[0]!) * Fy);
      }
      _sqBaseBuf[d.dofIndex] = -tau;
    }
  }
  for (const d of body.dofs) {
    if (d.engineMotor) continue;
    if (!(/^(hip|knee|foot|ankle|spine)/.test(d.name) && (d.axis === 0 || d.axis === 2))) continue;
    const a = d.anchorWorld, u = d.axisWorld;
    let tau = 0;
    for (const bi of body.subtree[d.joint]!) {
      const rb = body.bodies[bi]!;
      const c = rb.worldCom();
      const Fy = rb.mass() * -g;
      tau += u[0]! * (-(c.z - a[2]!) * Fy) + u[2]! * ((c.x - a[0]!) * Fy);
    }
    if (/^(hip|knee|foot|ankle)_/.test(d.name)) {
      const isL = d.name.endsWith('_l');
      const cop = isL ? copL : copR;
      const Fy = isL ? FyL : FyR;
      tau += u[2]! * ((cop - a[0]!) * Fy);
    }
    let baseTau = _sqBaseBuf !== null ? _sqBaseBuf[d.dofIndex]! : -tau;   // ★ 固定基础力（释放瞬间捕获）
    // ★★★ 2026-10-21 标准踝策略（Herzog/Stephens）：CoM 任务空间反馈 → CoP → 关节（Jᵀ·F）
    //   CoP_des = clamp(comTarget + v/ω0, 脚内)；Δτ = −N·(CoP_des − CoP_base) 同时落到踝/膝/髋
    if (/^(hip|knee|foot|ankle)_/.test(d.name) && _sqBaseBuf !== null) {
      const isL2 = d.name.endsWith('_l');
      const vTerm = _vComSm * Number(env.SQC_XCOM_GAIN ?? 1);
      const footX = fpos(isL2 ? 'l' : 'r');
      const copDes = cl(_comTargetX + vTerm / omega, footX - 0.12, footX + 0.12);
      const copBase = isL2 ? _copBaseL : _copBaseR;
      const Fy = isL2 ? FyL : FyR;
      baseTau += -Fy * (copDes - copBase);
    }
    const ref = baseAng(d.name, d.axis) ?? d.angle;
    propose({ dof: d.dofIndex, kind: 'pair', pri: PRI.action, c: cPair, rad: ref, tau: baseTau, src: 'squat.pairBase' });
  }
}
// ── 蹲姿编排入口：法庭 + 注入（唯一入口；后续基础力/回正力只加在这里）──
export {
  squatCourtSetup,
  courtStep,
  courtInject,
  type CourtState,
} from '../court';

import type { World } from '../world';
import type { ControlModule } from '../control';
import type { CourtState as CS } from '../court';
import { courtStep, courtInject } from '../court';

/** 蹲姿每物理步：法庭（目标/判死）+ 脚/阻尼注入 */
export function squatFrame(w: World, ctl: ControlModule, st: CS): void {
  courtStep(w, ctl, st);
  squatPairBase(w, ctl);   // ★ 基础力：经肌肉对（pair）输出
  courtInject(w, ctl);
}
