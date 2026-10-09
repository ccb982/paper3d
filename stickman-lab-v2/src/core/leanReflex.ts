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

  /** ★ P1：脚体索引（姿态通道的"离地"门控用） */
  private readonly footIdx: { l: number; r: number };

  constructor(
    private readonly world: World,
    private readonly sensors: Sensors,
    private readonly manual: ManualControl,
  ) {
    this.footIdx = {
      l: world.body.indexByKey.get('foot_l') ?? -1,
      r: world.body.indexByKey.get('foot_r') ?? -1,
    };
  }

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
   *   `posture`：单支撑姿态通道的**既定目标**（决策在伺服提案里；本方法只限速写入）。
   */
  applyLateral(copZ: number, dt: number, posture?: { hip: number; spine: number }): number {
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
    // ★★ 单支撑姿态通道（执行）：目标由提案给定（posture），这里只做限速逼近与写入。
    //    历史教训保留：**不加滞回锁存**（持续压骨盆会耦合矢状后漂，实测）。
    if (posture) {
      this.posHip = LeanReflex.approach(this.posHip, posture.hip, dt, 1.2);
      this.posSpine = LeanReflex.approach(this.posSpine, posture.spine, dt, 1.2);
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
   * ★ 支撑腿撑住（负载反射）：支撑膝在负载下屈曲 → **伸展力矩**撑住（正 = 伸展，
   *   PUSH_RISE 关键帧实测）。让位：该轴有 pin/手动角/手动力矩则跳过（由主动方负责）。
   */
  applyLoadBrace(side: 'l' | 'r', tau: number): void {
    if (tau <= 0) return;
    const body = this.world.body;
    const kd = body.dofByName(`knee_${side}`, 2);
    if (kd >= 0 && !this.manual.isPinned(`knee_${side}`, 2)
      && !this.manual.hasAngle(kd) && this.manual.torqueOf(kd) === 0) {
      this.world.executor.addTorque(kd, tau);
    }
  }

  /**
   * 前后弯腰一拍：髋屈伸**力矩**（低权帮助）+ 脊柱前后**位置**（腰部主动修正，
   * 2026-10 增强）。脊柱符号：前弯 = spine/2 **负**（由 BOW 关键帧实测）。
   * 被动作钉住的自由度跳过（动作播放期间 ActionSystem 已 pin 其脚本关节）。
   */
  applyBend(targetX: number, kp: number, kd: number, sign: number, spineSag: number, tauCap: number, dt: number, dead = 0.03, side: 'l' | 'r' | 'both' = 'both'): boolean {
    const dx = targetX - this.sensors.com[0]!;
    const active = Math.abs(dx) >= dead && sign !== 0;
    let out = false;
    if (active) {
      let tau = kp * dx + kd * -this.sensors.comVel[0]!;
      if (tau > tauCap) tau = tauCap; else if (tau < -tauCap) tau = -tauCap;
      tau *= sign;
      // ★ P1：单支撑时只驱动**支撑侧**髋（摆动腿自由，双侧同号只会甩摆腿 + 吃反作用）
      const sides: Array<'l' | 'r'> = side === 'both' ? ['l', 'r'] : [side];
      for (const s of sides) {
        const di = this.world.body.dofByName(`hip_${s}`, 2);
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
