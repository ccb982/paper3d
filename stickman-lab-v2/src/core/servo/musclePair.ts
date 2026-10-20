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

export interface PairMuscleOpts {
  dt: number;
  /** 单肌最大等长力（等效关节力矩，N·m） */
  f0: number;
  /** 共收缩刚度系数（N·m/rad @ C=1） */
  ks: number;
  /** 共收缩阻尼系数 */
  bs: number;
  /** 激活动力学时间常数（s） */
  tau: number;
  /** PD 方向（关节力矩→角度符号；标定值，默认 +1） */
  sgn?: number;
}

export interface PairChannel {
  c: number;
  ref: number;
  base: number;
}

export interface PairDof {
  angle: number;
  vel: number;
  inertia: number;
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
  const kp = Math.min(2 * c * o.ks, 0.5 * 4 * I / (dt * dt));
  const kd = Math.min(2 * c * o.bs, 0.8 * 2 * I / dt);
  const sgn = o.sgn ?? 1;
  const dev = ch.ref - d.angle;
  const tauDes = (kp * dev - kd * d.vel) * sgn + ch.base;   // 基础力不随 PD 符号翻转
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

  command(dof: number, c: number, ref: number, base = 0): void {
    const t = this.target[dof]!;
    t.c = c;
    t.ref = ref;
    t.base = base;
  }

  clear(): void {
    for (const t of this.target) {
      t.c = 0;
      t.ref = 0;
      t.base = 0;
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
