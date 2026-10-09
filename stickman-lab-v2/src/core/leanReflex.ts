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
  /** 差动加载状态：负载差低通 / 上一步 / 当前力偶 */
  private uF = 0;
  private uPrev = 0;
  private tauNow = 0;
  /** 单支撑姿态通道状态（髋/脊柱角，限速 2 rad/s） */
  private posHip = 0;
  private posSpine = 0;

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

  /**
   * ★ 左右侧移一拍（**差动加载**，Winter 1996）：控制量 = 负载差 u=(Fr−Fl)/F；
   *   目标 u* = −copZ/半跨距；执行 = **同号髋外展力偶**（实测：±20 N·m → u≈∓0.51、
   *   CoP 搬 ±8cm；反号力偶无效——最小相位、权限足够）。力偶限速 120 N·m/s、
   *   u 低通 50ms。被动作 pin 的髋跳过。
   */
  applyLateral(copZ: number, dt: number): number {
    const fl = this.sensors.feet[0]!.fz;
    const fr = this.sensors.feet[1]!.fz;
    const fTot = fl + fr;
    if (fTot < 30) return 0;
    const u = (fr - fl) / fTot;
    const k = 1 - Math.exp(-dt / 0.05);
    this.uF += (u - this.uF) * k;
    const du = (this.uF - this.uPrev) / Math.max(dt, 1e-6);
    this.uPrev = this.uF;
    const uStar = Math.max(-0.85, Math.min(0.85, -copZ / 0.16));
    let tau = 400 * (uStar - this.uF) - 25 * du;
    if (tau > 45) tau = 45; else if (tau < -45) tau = -45;
    this.tauNow = LeanReflex.approach(this.tauNow, tau, dt, 120);
    for (const side of ['l', 'r'] as const) {
      const di = this.world.body.dofByName(`hip_${side}`, 0);
      if (di >= 0 && !this.manual.isPinned(`hip_${side}`, 0) && this.tauNow !== 0) {
        this.world.executor.addTorque(di, this.tauNow);
      }
    }
    // ★★ 单支撑姿态通道（**门控到真实单支撑**，2026-10）：单支撑时负载差已饱和
    //    （u=1，体重全在支撑脚）⇒ 差动加载失去侧向权限，搬 CoM 只能靠髋/躯干姿态。
    //    这条通道在**双支撑摇摆**下会相位泵（共振），所以只在失衡>0.7 的单支撑里用。
    const imb = Math.abs(fr - fl) / fTot;
    if (imb > 0.7) {
      const side = fl > fr ? 'l' : 'r';
      const fd = this.world.body.dofByName(`foot_${side}`, 2);
      const supZ = fd >= 0 ? this.world.body.dofs[fd]!.anchorWorld[2]! : 0;
      const del = Math.max(-0.2, Math.min(0.2, supZ - this.sensors.com[2]!));
      const th = Math.max(-0.30, Math.min(0.30, 1.0 * del));       // θ<0 = CoM 向 −z
      const ths = Math.max(-0.12, Math.min(0.12, 0.5 * del));
      this.posHip = LeanReflex.approach(this.posHip, th, dt, 1.2);
      this.posSpine = LeanReflex.approach(this.posSpine, ths, dt, 1.2);
      for (const sd of ['l', 'r'] as const) {
        if (!this.manual.isPinned(`hip_${sd}`, 0)) {
          this.manual.setAngle(`hip_${sd}`, 0, this.posHip, 400, 50);
        }
      }
      for (const seg of ['spine1', 'spine2', 'spine3', 'spine4'] as const) {
        if (!this.manual.isPinned(seg, 0)) this.manual.setAngle(seg, 0, this.posSpine, 300, 40);
      }
    } else {
      this.posHip = LeanReflex.approach(this.posHip, 0, dt, 2);
      this.posSpine = LeanReflex.approach(this.posSpine, 0, dt, 2);
    }
    return this.tauNow;
  }

  /** 无侧向提案时把力偶限速回零 */
  releaseLateral(dt: number): void {
    this.tauNow = LeanReflex.approach(this.tauNow, 0, dt, 120);
    for (const side of ['l', 'r'] as const) {
      const di = this.world.body.dofByName(`hip_${side}`, 0);
      if (di >= 0 && !this.manual.isPinned(`hip_${side}`, 0) && this.tauNow !== 0) {
        this.world.executor.addTorque(di, this.tauNow);
      }
    }
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
