/**
 * musclePair.ts —— 肌肉对（唯一主动发力执行器，2026-10-21 用户定稿）
 *
 * 论文依据：
 *   · 每个关节由一对拮抗肌驱动（Latash 2018, PMC6093955）；
 *   · 共收缩调刚度/阻尼、净力矩不变（PMC3257849）；
 *   · 平衡点假说（Feldman 1966; Hogan 1984/1985）：λ(ref) 决定平衡点，刚度由共激活定；
 *   · 拮抗肌可独立控制关节力矩与刚度（Atkeson：Antagonist Muscles can control both）；
 *   · 激活动力学一阶（Zajac 1989; Thelen 2003）。
 *
 * 模型：
 *   a1 = C + τ_des/(2F0),  a2 = C − τ_des/(2F0)      （C=共激活，τ_des=期望净力矩）
 *   f1 = a1·F0,            f2 = a2·F0                 （简化 Hill：等长力 × 激活）
 *   τ  = f1 − f2 = τ_des                              （F0 共模抵消）
 *   τ_des = kp·(ref−θ) − kd·ω + base                  （kp=2C·ks，kd=2C·bs）
 *
 * 数值稳定（显式积分）：kp ≤ 0.5·4I/dt²，kd ≤ 0.8·2I/dt。
 *
 * 架构：所有伺服状态（站立/蹲/走）的**主动力矩只允许**经本模块输出；
 *       外部只写 (C, ref, base)，不算力矩。
 */

import { computeMuscleDamping, computeSoftGate } from './muscleDamping';
import type { MuscleImpedanceCmd } from './muscleImpedance';

export interface PairMuscleOpts {
  dt: number;
  /** 单肌最大等长力（等效关节力矩，N·m） */
  f0: number;
  /** 激活动力学时间常数（s） */
  tau: number;
  /** PD 方向（关节力矩→角度符号；标定值，默认 +1） */
  sgn?: number;
  /** 新肌肉阻尼/刚度控制器：目标闭环带宽（rad/s） */
  wn?: number;
  /** 新控制器：目标阻尼比 */
  zeta?: number;
  /** 新控制器：允许加速度（m/s² 或 rad/s²，按关节） */
  amax?: number;
  /** 新控制器：共收缩名义工作点 */
  c0?: number;
  /** 新控制器：加速度反馈增益（N·m / (rad/s²)） */
  accGain?: number;
  /** 新控制器：期望加速度（默认 0） */
  accRef?: number;
  /** 新控制器：被动短期刚度比例 / yield / eccentric / concentric / 速度尺度 */
  srsFrac?: number;
  srsYield?: number;
  eccGain?: number;
  conGain?: number;
  vRef?: number;
}

export interface PairChannel {
  c: number;
  ref: number;
  base: number;
  k?: number;
  d?: number;
  soft?: number;
  accRef?: number;
  accGain?: number;
}

export interface PairDof {
  angle: number;
  vel: number;
  inertia: number;
  /** 观测器给出的关节加速度（优先 __ACC_OBS.qdd*） */
  acc?: number;
  /** 是否可走 pair（腿/脊柱的矢状/侧向轴） */
  pairAxis: boolean;
}

/** 单轴一步：返回净力矩（含基础力 base 与 PD） */
export function pairTorque(d: PairDof, ch: PairChannel, o: PairMuscleOpts): number {
  if (!d.pairAxis) return 0;
  const c = Math.max(0, Math.min(1.5, ch.c));
  if (c < 1e-3) return 0;
  const I = Math.max(1e-6, d.inertia);
  const dt = Math.max(1e-5, o.dt);
  const sgn = o.sgn ?? 1;
  const dev = ch.ref - d.angle;
  const wn = o.wn ?? 25;
  const zeta = o.zeta ?? 0.9;
  const soft = ch.soft ?? computeSoftGate({
    vel: d.vel, acc: d.acc ?? 0, dev,
    softMin: 0.5, vScale: 2, aScale: 20, xScale: 0.5,
  });
  const md = computeMuscleDamping({
    mass: I, wn, zeta, amax: o.amax ?? 60,
    c, c0: o.c0 ?? c, acc: d.acc, accRef: ch.accRef ?? o.accRef,
    accGain: ch.accGain ?? o.accGain, vel: d.vel,
    cmdK: ch.k, cmdD: ch.d, soft, dev,
    srsFrac: o.srsFrac ?? 1.0,
    srsYield: o.srsYield ?? 0.06,
    eccGain: o.eccGain ?? 1.0,
    conGain: o.conGain ?? 0.3,
    vRef: o.vRef ?? 2,
  });
  const kp = Math.min(md.kp, 0.5 * 4 * I / (dt * dt));
  const kd = Math.min(md.kd, 0.8 * 2 * I / dt);
  const tauDes = (kp * dev - kd * d.vel + md.tauAcc) * sgn + ch.base;   // 基础力不随 PD 符号翻转
  const half = tauDes / Math.max(1e-3, 2 * c);
  const f1 = Math.max(0, c * (o.f0 + half));
  const f2 = Math.max(0, c * (o.f0 - half));
  return f1 - f2;
}

/** 每状态一份的肌肉对通道（激活平滑 + 命令） */
export class MusclePairBank {
  private readonly target: PairChannel[];
  private readonly cSm: Float64Array;

  constructor(n: number) {
    this.target = Array.from({ length: n }, () => ({ c: 0, ref: 0, base: 0 }));
    this.cSm = new Float64Array(n);
  }

  command(dof: number, c: number, ref: number, base = 0, imp?: MuscleImpedanceCmd): void {
    const t = this.target[dof]!;
    t.c = c;
    t.ref = ref;
    t.base = base;
    t.k = imp?.k;
    t.d = imp?.d;
    t.soft = imp?.soft;
    t.accRef = imp?.accRef;
    t.accGain = imp?.accGain;
  }

  clear(): void {
    for (const t of this.target) {
      t.c = 0;
      t.ref = 0;
      t.base = 0;
      t.k = undefined;
      t.d = undefined;
      t.soft = undefined;
      t.accRef = undefined;
      t.accGain = undefined;
    }
    this.cSm.fill(0);
  }

  /** 激活一阶平滑后的当前 C（Zajac/Thelen 激活动力学） */
  activationOf(dof: number, dt: number, tau: number): number {
    const tgt = this.target[dof]!.c;
    const a = 1 - Math.exp(-dt / Math.max(1e-3, tau));
    this.cSm[dof] = this.cSm[dof]! + (tgt - this.cSm[dof]!) * a;
    return this.cSm[dof]!;
  }

  channel(dof: number): PairChannel {
    return this.target[dof]!;
  }
}
