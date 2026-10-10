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
  /** ★ 回读：姿态通道当前髋目标 / 差动力偶当前值（§侧向净效果审计） */
  get postureHipNow(): number { return this.posHip; }
  get coupleNow(): number { return this.tauNow; }

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
    // ★ 重定心修正（Winter 1996 load/unload 的正确形式）：
    //   u* = −(CoP目标 − 双脚中点)/(半跨距)；旧式 −copZ/0.16 以"世界 0 点"定心，
    //   只在两脚对称(中心≈0)时对；单支撑落地后两脚都挤在支撑侧（中心≠0）时方向算反，
    //   实测把 CoP 往远离目标的方向搬 → 重心越漂越飞（E 相失控的直接原因）。
    const zl = this.sensors.feet[0]!.z, zr = this.sensors.feet[1]!.z;
    const zc = (zl + zr) / 2, span = Math.abs(zr - zl);
    let uStar = Math.max(-0.85, Math.min(0.85, span > 0.02 ? -(copZ - zc) / (span / 2) : -copZ / 0.16));
    let tau = 400 * (uStar - this.uF) - 25 * du;
    if (tau > 45) tau = 45; else if (tau < -45) tau = -45;   // ±45 实测：不够→向内慢倒（安全向）；±90→过冲向外倒（危险）
    this.tauNow = LeanReflex.approach(this.tauNow, tau, dt, 120);
    for (const side of ['l', 'r'] as const) {
      const di = this.world.body.dofByName(`hip_${side}`, 0);
      if (di >= 0 && !this.manual.isPinned(`hip_${side}`, 0) && this.tauNow !== 0) {
        this.world.executor.addTorque(di, this.tauNow);
      }
    }
    return this.tauNow;
  }

  /**
   * ★ 腰椎 · 轴L执行（自身状态控制器的输出，决策在伺服提案里）：
   *   限速写入 髋外展 + 脊柱侧折 目标（历史教训：不加滞回锁存）。
   */
  applyPosture(hip: number, spine: number, dt: number): void {
    this.posHip = LeanReflex.approach(this.posHip, hip, dt, 1.2);
    this.posSpine = LeanReflex.approach(this.posSpine, spine, dt, 1.2);
    for (const sd of ['l', 'r'] as const) {
      if (!this.manual.isPinned(`hip_${sd}`, 0)) {
        this.manual.setAngle(`hip_${sd}`, 0, this.posHip, 400, 50);
      }
    }
    for (const seg of ['spine1', 'spine2', 'spine3', 'spine4'] as const) {
      if (!this.manual.isPinned(seg, 0)) this.manual.setAngle(seg, 0, this.posSpine, 300, 40);
    }
  }

  /** 轴L无输出时：内部目标限速回零（关节交还姿势张力） */
  releasePosture(dt: number): void {
    this.posHip = LeanReflex.approach(this.posHip, 0, dt, 2);
    this.posSpine = LeanReflex.approach(this.posSpine, 0, dt, 2);
  }

  /**
   * ★ 腰椎 · 轴S执行（自身状态控制器）：髋/2 力矩（单支撑限支撑侧）+ 脊柱前后限速写入。
   *   fold：**正 = 向后弯 / 负 = 向前弯**（`_probe-lean-sign` 复测定死）。
   */
  applyTrunk(tau: number, fold: number, side: 0 | 1 | 2, dt: number): void {
    if (tau !== 0) {
      const sides: Array<'l' | 'r'> = side === 0 ? ['l', 'r'] : [side === 1 ? 'l' : 'r'];
      for (const s of sides) {
        const di = this.world.body.dofByName(`hip_${s}`, 2);
        // ★ 与旧 bend 执行方保持一致的语义：髋/2 平衡力矩**不查 pin**（动作期间照样参与，
        //   实测：查 pin 后蹬地挺腰 C 回归——末胸 1.42→1.10）；脊柱位置写入仍让位。
        if (di >= 0 && tau !== 0) this.world.executor.addTorque(di, tau);
      }
    }
    this.b.spine = LeanReflex.approach(this.b.spine, fold, dt, 3);
    if (Math.abs(this.b.spine) > 1e-3) {
      for (const seg of ['spine1', 'spine2', 'spine3', 'spine4'] as const) {
        if (!this.manual.isPinned(seg, 2)) this.manual.setAngle(seg, 2, this.b.spine, 200, 30);
      }
    }
  }

  /** 轴S无输出时：脊柱前后限速回中（关节交还姿势张力） */
  releaseTrunk(dt: number): void {
    this.b.spine = LeanReflex.approach(this.b.spine, 0, dt, 3);
    if (Math.abs(this.b.spine) > 1e-3) {
      for (const seg of ['spine1', 'spine2', 'spine3', 'spine4'] as const) {
        if (!this.manual.isPinned(seg, 2)) this.manual.setAngle(seg, 2, this.b.spine, 200, 30);
      }
    }
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
  /**
   * ★ 支撑力矩撑住（Winter 支撑力矩框架；由"只撑膝"升级为三关节）：
   *   支撑腿不塌 = **踝跖屈 + 膝伸展 + 髋伸展**之和（各关节互相补偿；跖屈肌常开 tonic）。
   *   比例（踝主/膝次/髋辅）；让位规则同其它反射（执行方跳过被主动指挥的轴）。
   *   符号：踝2 正=跖屈；膝2 正=伸展力矩；髋2 正=屈 → 髋伸展 = 负。
   */
  applySupportBrace(side: 'l' | 'r', tau: number): void {
    if (tau <= 0) return;
    const body = this.world.body;
    const put = (joint: string, ax: number, t: number): void => {
      const di = body.dofByName(joint, ax);
      if (di >= 0 && !this.manual.isPinned(joint, ax)
        && !this.manual.hasAngle(di) && this.manual.torqueOf(di) === 0) {
        this.world.executor.addTorque(di, t);
      }
    };
    // ★ 份额（2026-10 实测landscape）：踝0.5/膝0.3/髋0.25 = 43.6/0.183（最优平衡）；
    //   踝0.15/膝0.5/髋0.35 → 最低胸 0.185 但抬脚崩到 9.1（撑住的踝份额是抬脚支撑的一部分）。
    //   踝与 pad 的同轴冲突仍在（后向漂时踝净翻跖屈）——需**方向门控**（见文档）而非份额改。
    put(`foot_${side}`, 2, tau * 0.5);      // 踝跖屈（柱的第一道）
    put(`knee_${side}`, 2, tau * 0.3);      // 膝伸展
    put(`hip_${side}`, 2, -tau * 0.25);     // 髋伸展（负 = 伸展）
  }
}
