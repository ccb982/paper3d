/**
 * leanReflex.ts —— 伺服执行方 v2（髋策略 + 躯干 + 摆臂；位置式+速率限制）
 *
 * 用户定调：**上下半身活动（侧移/弯腰/摆臂）都是预警的提案**——摔倒预警在
 * `StabilityProposal.reflexDirectives` 里按幅度预算分配后下达关节角幅值：
 *   `{ id:'lean',  params:{ hip, spine, arm, sign } }`   （左右：髋外展+脊柱侧屈+摆臂）
 *   `{ id:'bend',  params:{ hip, spine, arm, sign } }`   （前后：髋屈伸+脊柱屈伸+摆臂）
 * 本模块只是被动执行方（**幅度来自提案**，不再自己算 PD）。
 *
 * 工程要点（实测教训）：
 *   · 力矩式会和驱动器角度 PD 刚度硬顶（位移 ≈ τ/K，12cm 封顶）→ 改位置式；
 *   · 默认手动刚度 ~120 N·m/rad 扛不住骨盆杠杆载荷（关节在负载下打滑发散）
 *     → 髋 400/50、脊柱 200/25、手臂 150/20；
 *   · 直接位置阶跃 = 猛扫（髋 −0.28→+0.07 的"撬棍"）→ **速率限制 3 rad/s**。
 */

import type { World } from './world';
import type { Sensors } from './sensors';
import type { ManualControl } from './manual';

export class LeanReflex {
  private readonly l = { hip: 0, spine: 0, arm: 0 };   // 侧向当前命令（rad）
  private readonly b = { hip: 0, spine: 0, arm: 0 };   // 矢状当前命令（rad）

  constructor(
    private readonly world: World,
    private readonly sensors: Sensors,
    private readonly manual: ManualControl,
  ) {}

  /** 限速逼近（rad/s） */
  private static approach(cur: number, tgt: number, dt: number, rate: number): number {
    const d = tgt - cur;
    const step = rate * dt;
    return Math.abs(d) <= step ? tgt : cur + Math.sign(d) * step;
  }

  /** 左右侧移一拍：髋外展 + 脊柱侧屈 + 摆臂（幅值由提案给出；被动作钉住的关节跳过） */
  applyLateral(hip: number, spine: number, arm: number, sign: number, dt: number): void {
    this.l.hip = LeanReflex.approach(this.l.hip, hip * sign, dt, 3);
    this.l.spine = LeanReflex.approach(this.l.spine, spine * sign, dt, 3);
    this.l.arm = LeanReflex.approach(this.l.arm, arm * sign, dt, 3);
    for (const side of ['l', 'r'] as const) {
      if (!this.manual.isPinned(`hip_${side}`, 0)) this.manual.setAngle(`hip_${side}`, 0, this.l.hip, 400, 50);
      if (!this.manual.isPinned(`shoulder_${side}`, 0)) this.manual.setAngle(`shoulder_${side}`, 0, this.l.arm, 150, 20);
    }
    for (const seg of ['spine1', 'spine2', 'spine3', 'spine4'] as const) {
      if (!this.manual.isPinned(seg, 0)) this.manual.setAngle(seg, 0, this.l.spine, 300, 40);
    }
  }

  /** 无侧向提案时把侧向命令限速回零（不硬切） */
  releaseLateral(dt: number): void {
    this.applyLateral(0, 0, 0, 1, dt);
  }

  /**
   * 前后弯腰一拍：髋屈伸**力矩**（低权帮助）+ 脊柱前后**位置**（腰部主动修正，
   * 2026-10 增强）。脊柱符号：前弯 = spine/2 **负**（由 BOW 关键帧实测）。
   * 被动作钉住的自由度跳过（动作播放期间 ActionSystem 已 pin 其脚本关节）。
   */
  applyBend(targetX: number, kp: number, kd: number, sign: number, spineSag: number, tauCap: number, dt: number): boolean {
    const dx = targetX - this.sensors.com[0]!;
    const active = Math.abs(dx) >= 0.03 && sign !== 0;
    let out = false;
    if (active) {
      let tau = kp * dx + kd * -this.sensors.comVel[0]!;
      if (tau > tauCap) tau = tauCap; else if (tau < -tauCap) tau = -tauCap;
      tau *= sign;
      for (const side of ['l', 'r'] as const) {
        const di = this.world.body.dofByName(`hip_${side}`, 2);
        if (di >= 0 && tau !== 0) this.world.executor.addTorque(di, tau);
      }
      out = true;
    }
    // 脊柱前后（位置式，限速）：有提案追目标，无提案回零
    this.b.spine = LeanReflex.approach(this.b.spine, (active ? spineSag * sign : 0), dt, 3);
    if (Math.abs(this.b.spine) > 1e-3 || active) {
      for (const seg of ['spine1', 'spine2', 'spine3', 'spine4'] as const) {
        if (!this.manual.isPinned(seg, 2)) this.manual.setAngle(seg, 2, this.b.spine, 200, 30);
      }
    }
    return out;
  }

  /** 无弯腰提案时：脊柱前后限速回零 + 髋力矩自然归零（力矩是每步叠加，不写即零） */
  releaseBend(dt: number): void {
    this.applyBend(0, 200, 25, 1, 0, 140, dt);
  }
}
