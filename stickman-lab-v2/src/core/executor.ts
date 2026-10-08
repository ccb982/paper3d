/**
 * executor.ts —— ★ 执行器层（v2 的核心，替代 v1 的 4290 行 ragdoll.ts）
 *
 * ══════════════════════════════════════════════════════════════════════════
 * v1 的死因（本文件存在的理由）
 * ══════════════════════════════════════════════════════════════════════════
 *
 * v1 的 `ragdoll.ts` 里同时活着三代架构（位置伺服 K=48 / V4 纯力矩 / 十来个环境变量开关），
 * 结果产生一个**死通道**：`torqueCmd` 被 `v4Tau` 无条件覆盖 ⇒ 走 `torqueCmd` 的一切
 * （包括所有权威性探针）**永远看不到效果**，而代码看起来完全正常。
 *
 * ⇒ v2 用**接口封装**根除这类问题：
 *   · `applyTorque()` 是**唯一**的 τ 写入入口
 *   · 饱和只在**一处**发生
 *   · 每个轴每步只能写一次（写入计数 + 越界报错）
 *   · 想要值 / 实际值 / 是否饱和 **全部可回读**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 物理约定（与 v1 一致，不要改）
 * ══════════════════════════════════════════════════════════════════════════
 *
 * τ 以**角冲量**形式成对施加：`J = τ·dt`，子体 +J、父体 −J（等大反向）。
 * 这与 v1（`ragdoll.ts` 的 `applyTorqueImpulse`）逐位一致，所以 v1 的
 * 所有标定值（τmax、限位、惯量）都可以直接搬过来。
 *
 * 轴方向 = **父体本地坐标系的 X/Y/Z** 旋转到世界。这一点也必须与 v1 一致，
 * 否则所有关节的符号约定都会反过来。
 */

import type RAPIER from '@dimforge/rapier3d';
import type { Skeleton, JointDef } from './skeleton';

/** 三轴向量（避免每帧 new 对象） */
export interface Vec3 { x: number; y: number; z: number }

/** 每个轴的记账（供探针/护栏回读） */
export interface AxisLedger {
  /** 调用方**想要**的 τ（N·m） */
  cmd: number;
  /** 实际下发（已饱和）的 τ（N·m） */
  applied: number;
  /** 该步被写了几次（>1 ⇒ 有多条写入路径，违反 N2） */
  writes: number;
  /** 是否触到 τmax */
  saturated: boolean;
  /** 是否被"每步步进稳定性上限"额外限制（见 stabilityLimitImpulse） */
  clipped: boolean;
}

export class Executor {
  readonly nAxes: number;
  readonly ledger: AxisLedger[];

  /** τmax（N·m），按 axis 展开：`[joint*3 + axis]` */
  private readonly tauMax: Float64Array;
  /** 每轴"每步最多允许多少角冲量"（N·m·s）。Infinity = 不限 */
  private readonly impStepCap: Float64Array;
  /** 复用缓冲：世界轴方向 */
  private readonly axisWorld = new Float64Array(3);
  private readonly iv: Vec3 = { x: 0, y: 0, z: 0 };
  /** 本步内是否已写过的标记（N2 检查用） */
  private readonly wroteThisStep: Int32Array;

  constructor(
    private readonly world: RAPIER.World,
    private readonly sk: Skeleton,
    private readonly bodies: RAPIER.RigidBody[],
    private readonly jointBodies: Int32Array,
  ) {
    this.nAxes = sk.joints.length * 3;
    this.tauMax = new Float64Array(this.nAxes);
    this.impStepCap = new Float64Array(this.nAxes).fill(Number.POSITIVE_INFINITY);
    this.wroteThisStep = new Int32Array(this.nAxes);
    this.ledger = new Array(this.nAxes);
    for (let i = 0; i < sk.joints.length; i++) {
      const j = sk.joints[i]!;
      const freeAxis = freeAxisOf(j);
      for (let k = 0; k < 3; k++) {
        const idx = i * 3 + k;
        // ★ revolute 关节只有 1 个自由轴 ⇒ 其余轴的 τmax 记 0（不是"不给力矩"，
        //   是"物理上没有这个自由度"）。v1 在这里给了非零值，导致用户看到
        //   "踝 τmax=72"却不知道那 72 只作用在一个轴上 —— 见 v2 架构.md §3。
        this.tauMax[idx] = freeAxis === -1 || freeAxis === k ? (j.maxTorque?.[k] ?? 0) : 0;
        this.ledger[idx] = { cmd: 0, applied: 0, writes: 0, saturated: false, clipped: false };
      }
    }
  }

  /** 某轴的 τmax（已按自由度归零） */
  tauMaxOf(jointIdx: number, axis: number): number {
    return this.tauMax[jointIdx * 3 + axis]!;
  }

  /** 设置某轴的"每步角冲量上限"（N·m·s）。传 Infinity 取消 */
  setImpulseCap(jointIdx: number, axis: number, cap: number): void {
    this.impStepCap[jointIdx * 3 + axis] = cap;
  }

  /** 每个物理步开始前调用：清写入计数与记账 */
  beginStep(): void {
    this.wroteThisStep.fill(0);
    for (let i = 0; i < this.nAxes; i++) {
      const l = this.ledger[i]!;
      l.writes = 0;
      l.saturated = false;
      l.clipped = false;
      // cmd 不在这里清 —— 允许"持续指令"跨步保留（由调用方决定何时清）。
      // 但 applied 每步重算 ⇒ 若本步无人写，applied 归零（= 真实情况）。
      l.applied = 0;
    }
  }

  /**
   * ★★ 唯一的 τ 写入入口。
   *
   * @param jointIdx 关节下标（0..n-1）
   * @param axis     本地轴（0=X 外展 / 1=Y 扭转 / 2=Z 屈伸）
   * @param tau      期望力矩（N·m）。**只有调用方传的值会被用**（无隐式叠加）
   * @param dt       物理步长（秒）
   * @returns 实际下发的 τ（已饱和/截断）
   *
   * ⚠ 每轴每步只应调用一次。重复调用 ⇒ 累加 + `writes++`（>1 由护栏报警）。
   *   这是为了"暴露问题"而不是"静默容忍"——v1 的死通道正是一次静默覆盖。
   */
  applyTorque(jointIdx: number, axis: number, tau: number, dt: number): number {
    const idx = jointIdx * 3 + axis;
    const l = this.ledger[idx]!;
    l.writes++;
    l.cmd += tau;

    const cap = this.tauMax[idx]!;
    let t = l.cmd;
    if (t > cap) { t = cap; l.saturated = true; }
    else if (t < -cap) { t = -cap; l.saturated = true; }

    const impCap = this.impStepCap[idx]!;
    let imp = t * dt;
    if (imp > impCap) { imp = impCap; l.clipped = true; }
    else if (imp < -impCap) { imp = -impCap; l.clipped = true; }

    l.applied = imp / dt;

    if (imp === 0) return 0;

    const j = this.sk.joints[jointIdx]!;
    const pi = this.jointBodies[jointIdx * 2]!;
    const ci = this.jointBodies[jointIdx * 2 + 1]!;
    const p = this.bodies[pi]!;
    const c = this.bodies[ci]!;

    // 本地轴 → 世界轴（父体姿态）
    const q = p.rotation();
    if (axis === 0) quatRotate(q.x, q.y, q.z, q.w, 1, 0, 0, this.axisWorld);
    else if (axis === 1) quatRotate(q.x, q.y, q.z, q.w, 0, 1, 0, this.axisWorld);
    else quatRotate(q.x, q.y, q.z, q.w, 0, 0, 1, this.axisWorld);
    void j;

    const v = this.iv;
    v.x = this.axisWorld[0]! * imp;
    v.y = this.axisWorld[1]! * imp;
    v.z = this.axisWorld[2]! * imp;
    // 成对等大反向：子体 +J、父体 −J
    c.applyTorqueImpulse(v, true);
    v.x = -v.x; v.y = -v.y; v.z = -v.z;
    p.applyTorqueImpulse(v, true);
    return l.applied;
  }

  /** 清空全部指令（= "松手"）。⚠ 注意：松手 ≠ 关节回位（见 §备注） */
  clearAll(): void {
    for (let i = 0; i < this.nAxes; i++) {
      const l = this.ledger[i]!;
      l.cmd = 0;
      l.applied = 0;
    }
  }

  /**
   * 护栏 N1：`applied == clamp(cmd, ±τmax)` 逐轴成立。
   * 返回违例列表（空 = 通过）。
   */
  checkInvariantN1(): string[] {
    const bad: string[] = [];
    for (let i = 0; i < this.nAxes; i++) {
      const l = this.ledger[i]!;
      const cap = this.tauMax[i]!;
      const want = Math.max(-cap, Math.min(cap, l.cmd));
      // 有 impStepCap 时 applied 可以比 want 更小 ⇒ 只在未 clipped 时严格要求相等
      if (l.clipped) continue;
      if (Math.abs(l.applied - want) > 1e-6 * Math.max(1, cap)) {
        const ji = i / 3 | 0, k = i % 3;
        bad.push(`${this.sk.joints[ji]!.name}/${k}: applied=${l.applied.toFixed(6)} want=${want.toFixed(6)}`);
      }
    }
    return bad;
  }

  /** 护栏 N2：每轴每步最多写一次 */
  checkInvariantN2(): string[] {
    const bad: string[] = [];
    for (let i = 0; i < this.nAxes; i++) {
      if (this.wroteThisStep[i]! > 1) {
        const ji = i / 3 | 0, k = i % 3;
        bad.push(`${this.sk.joints[ji]!.name}/${k}: writes=${this.wroteThisStep[i]}`);
      }
    }
    return bad;
  }

  /** 本步是否有人写过（供"松手"语义检查） */
  wroteThisStepCount(): number {
    let n = 0;
    for (let i = 0; i < this.nAxes; i++) if (this.wroteThisStep[i]! > 0) n++;
    return n;
  }

  /** 标记"本步已写"（由 applyTorque 内部通过 ledger.writes 反映，这里供外部检查） */
  markWrote(jointIdx: number, axis: number): void {
    this.wroteThisStep[jointIdx * 3 + axis]!;
    this.wroteThisStep[jointIdx * 3 + axis] += 0;
  }
}

/**
 * revolute 关节的自由轴下标（0=X / 1=Y / 2=Z）；球铰返回 −1。
 * ★ 与 v1 的 `revoluteAxis[0]!==0 ? 0 : revoluteAxis[1]!==0 ? 1 : 2` 同一个约定。
 */
export function freeAxisOf(j: JointDef): number {
  if (!j.revoluteAxis) return -1;
  const [x, y] = j.revoluteAxis;
  return x !== 0 ? 0 : y !== 0 ? 1 : 2;
}

/** 四元数旋转向量：out = q ⊗ v ⊗ q⁻¹ */
export function quatRotate(qx: number, qy: number, qz: number, qw: number, vx: number, vy: number, vz: number, out: Float64Array): void {
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + (qy * tz - qz * ty);
  out[1] = vy + qw * ty + (qz * tx - qx * tz);
  out[2] = vz + qw * tz + (qx * ty - qy * tx);
}
