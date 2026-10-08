/**
 * drive.ts —— ★ 驱动层（v2）：把"谁在每步写力矩"收敛到一个地方
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 为什么单独一层（而不是塞进 Body 或 Executor）
 * ══════════════════════════════════════════════════════════════════════════
 * v1 的 `driveMotors()` 把「位置环 PD」「被动张力」「Rapier 电机」「限位」
 * 揉在同一个循环里，谁也说不清某一帧某个轴到底被写了几次 ⇒ 出现"双驱动"
 * 事故（见 v1 `ragdoll.ts:1377-1395`：中足同时被自研 PD 和 Rapier 弹簧往 0 拉，
 * 柔性足等于被**焊死**，而所有外观指标都看起来正常）。
 *
 * v2 把驱动拆成**显式命名的通道**，每个通道只写**它负责的那些轴**，
 * 全部经 `Executor.applyTorque()` 这一个入口 ⇒ N2 护栏（每轴每步一次）
 * 能真正抓到"两条路径抢同一根轴"。
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 通道划分（互斥，覆盖全部 3×18 根轴）
 * ══════════════════════════════════════════════════════════════════════════
 *
 *   C1 被动张力  `restTension`：目标角 = 0（静姿态），纯比例项 `−k·θ`。
 *      物理含义：关节的被动刚度（韧带/组织）。**没有它，零命令 = 纯阻尼**，
 *      重力会把膝盖压到限位（v1 实测躯干 1.128→0.693 m）。
 *      ⚠ 必须**饱和**（`clamp(θ, ±ref)`），否则在 |θ| = 9/k 处修正量等于满速命令
 *      ⇒ 每个关节被加了 ±57.3° 的隐形软墙（v1 踩过，见 `restTension` 注释）。
 *
 *   C2 柔性足被动弓  —— **不在这里**。照搬 v1：`arch_*` / `mfoot_*` 由 Rapier
 *      `MotorModel.ForceBased` 的 `configureMotorPosition(0, 400, 2.0)` 承担
 *      （见 `body.ts` 的 `ARCH_STIFFNESS` 注释：自研显式 PD 稳定上限只有 7.3，
 *      与需求的 400 N·m/rad 差 55 倍，**物理上做不到**）。
 *      ⇒ `Drive` 对这些关节一个力矩都不写。
 *
 *   C3 位置目标 PD  `kP/kD`：留给"平衡系统"接管阶段。目标角由外部给，
 *      本层只负责把 PD 算出来写下去。★ 未启用时完全不写（保持 C1 语义干净）。
 *
 *   C4 限位：**不在这里**。revolute 用引擎 `setLimits`，球铰用 `Body.enforceLimits`。
 *      理由见 v2 架构.md 纪律 D2（每根轴只有一条限位路径）。
 */

import type { Skeleton, JointDef } from './skeleton';
import type { Body } from './body';
import type { Executor } from './executor';

export interface DriveOptions {
  /**
   * ★ 位置环比例增益（无量纲）。
   * 等效刚度 = `kP · τmax / ωmax`（N·m/rad），见 v1 `ragdoll.ts:1392-1394`。
   * v1 标定：kP=48、τmax=60、ωmax=9 ⇒ 等效 320 N·m/rad（柔性足弓的量级）。
   */
  kP: number;
  /** 位置环微分增益（无量纲）。等效阻尼 = `kD · τmax / ωmax` */
  kD: number;
  /** 关节最大角速度（rad/s），PD 归一化基准 */
  jointMaxSpeed: number;
  /**
   * ★★ 每步"吃掉多少相对角速度误差"的比例（护栏 α）。
   *
   * v1 的出厂值 0.35 = 按最坏情况定的安全余量。它把**有效关节刚度**压到
   * 设计值的 22%（v1 实测：髋被重力压开 83~96° ⇒ 劈叉）。
   * → v1 最终提到 1.0（语义 = 一步收敛且不过冲；α=2 才是振荡边界）。
   */
  motorAlpha: number;
}

export const DEFAULT_DRIVE_OPTIONS: DriveOptions = {
  kP: 48,
  kD: 1.0,
  jointMaxSpeed: 9.0,
  // ★ v1 最终值：1.0（不是出厂 0.35 —— 那个把有效刚度砍到 22%）
  motorAlpha: 1.0,
};

export class Drive {
  readonly opt: DriveOptions;
  /** C3 位置目标（rad）；未设置的轴 = NaN = 该轴不写 C3 */
  private readonly target: Float64Array;
  /** C3 是否对该轴启用 */
  private readonly targetOn: Uint8Array;
  /** 复用缓冲 */
  private readonly rot = new Float64Array(3);
  private readonly rel = new Float64Array(3);
  /** 本步统计（供探针回读） */
  lastWrote = { c1: 0, c2: 0, c3: 0, saturated: 0 };

  constructor(
    private readonly sk: Skeleton,
    private readonly executor: Executor,
    private readonly body: Body,
    opt: Partial<DriveOptions> = {},
  ) {
    this.opt = { ...DEFAULT_DRIVE_OPTIONS, ...opt };
    const n = sk.joints.length * 3;
    this.target = new Float64Array(n).fill(Number.NaN);
    this.targetOn = new Uint8Array(n);
  }

  /** C3：设某关节某轴的位置目标（rad，相对静姿态） */
  setTarget(jointIdx: number, axis: number, rad: number): void {
    const i = jointIdx * 3 + axis;
    this.target[i] = rad;
    this.targetOn[i] = 1;
  }

  /** C3：撤销某关节某轴的位置目标 */
  clearTarget(jointIdx: number, axis: number): void {
    const i = jointIdx * 3 + axis;
    this.target[i] = Number.NaN;
    this.targetOn[i] = 0;
  }

  /** C3：全部撤销 */
  clearAllTargets(): void {
    this.target.fill(Number.NaN);
    this.targetOn.fill(0);
  }

  /**
   * ★ 每步调用（在 `world.step()` **之前**）。
   *
   * ⚠ 跳过 `motorDriven`（柔性足弓/中足）：那些关节由 Rapier 引擎电机
   *   （`ForceBased`）驱动，本层一个力矩都不许写 —— 两条路径抢同一根轴
   *   会把柔性足**焊死**（v1 踩过）。
   */
  step(dt: number): void {
    this.lastWrote.c1 = 0;
    this.lastWrote.c2 = 0;
    this.lastWrote.c3 = 0;
    const nj = this.sk.joints.length;
    const { kP, kD, jointMaxSpeed, motorAlpha } = this.opt;

    for (let i = 0; i < nj; i++) {
      if (this.body.isMotorDriven(i)) continue;      // 柔性足弓/中足：引擎独占
      const j = this.sk.joints[i]!;
      this.body.jointRot(i, this.rot);
      this.body.jointRelVel(i, this.rel);

      for (let k = 0; k < 3; k++) {
        const tauMax = this.executor.tauMaxOf(i, k);
        if (tauMax <= 0) continue;                       // 非自由轴：物理上没有这个自由度

        // ★★ 护栏：一步最多把相对角速度推进 `α × 误差`。
        //   τmax 只管力矩不管加速度 —— 手/前臂惯量 ~0.03 kg·m²，100 N·m 在 1/240 s
        //   内打出 Δω ≈ 100·(1/240)/0.03 ≈ 14 rad/s，而误差可能只有 1 rad/s
        //   ⇒ 显式比例控制必振荡发散（v1 实测峰 |v| = 284 m/s）。
        //   修法：把单位冲量造成的相对角速度变化限制在误差的一个比例内。
        //     Δω_rel = imp·(1/Ic + 1/Ip) = imp / Ieff
        //   ⇒ `|imp| ≤ α · Ieff · |ω_target − ω_rel|`，其中 ω_target 由 PD 给出。
        //
        //   ⚠ `Ieff` 必须用**该轴**的折合惯量。v1 的教训：用 `min(I)` 对薄盒脚掌
        //     极小（≈0.0022），把踝的冲量卡到只剩 3% ⇒ 踝只能出 ~1 N·m（τmax=60）。
        //     这里用 `Body.axisInertia(i,k)`（轴投影惯量的并联）。
        //
        //   `|imp| ≤ α · Ieff · |ω_target − ω_rel|` 且 `imp = τ·dt`
        //   ⇒ 每步冲量上限 = α · Ieff · ωmax（用 ωmax 做误差上界，保守）。
        //   等价地把 τ 上限压到 `α·Ieff·ωmax/dt` —— 这样显式积分的每步
        //   相对角速度变化 ≤ α·ωmax，α ≤ 1 时必然不过冲。
        const Ieff = this.body.axisInertia(i, k);
        const tauStable = (motorAlpha * Ieff * jointMaxSpeed) / dt;
        const tauMaxEff = Math.min(tauMax, tauStable);

        // ── C1 / C3 位置环 PD（目标角 = 外部指定，或 0 = 静姿态） ──
        //   τ = kP·(θ_t − θ)·τmax/ωmax − kD·θ̇·τmax/ωmax
        //   ★ 与 v1 `ragdoll.ts:1392-1394` 逐位一致（等效刚度 = kP·τmax/ωmax）。
        const ti = i * 3 + k;
        const thRef = this.targetOn[ti] ? this.target[ti]! : 0;
        const err = thRef - this.rot[k]!;
        const tau = (kP * err * tauMax) / jointMaxSpeed
                  - (kD * this.rel[k]! * tauMax) / jointMaxSpeed;
        const t = Math.max(-tauMaxEff, Math.min(tauMaxEff, tau));
        this.executor.applyTorque(i, k, t, dt);
        if (this.targetOn[ti]) this.lastWrote.c3++; else this.lastWrote.c1++;
      }
    }
    this.lastWrote.saturated = this.countSaturated();
  }

  private countSaturated(): number {
    let n = 0;
    for (let i = 0; i < this.sk.joints.length * 3; i++) {
      if (this.executor.ledger[i]!.saturated) n++;
    }
    return n;
  }
}

/** revolute 关节的自由轴（0/1/2）；球铰 −1 */
export function freeAxisOfJoint(j: JointDef): number {
  if (!j.revoluteAxis) return -1;
  const [x, y] = j.revoluteAxis;
  return x !== 0 ? 0 : y !== 0 ? 1 : 2;
}
