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
    // ★ 物理 clamp：脚不能"拉地"（fz≥0）——否则摆动脚拖拽的负力让 u=(fr−fl)/fTot>1，
    //   力偶律 400×(u*−uF) 直接打满 −45（实测：支撑外展被恒定 −45 压死、A 相转移被拦）。
    const fl = Math.max(0, this.sensors.feet[0]!.fz);
    const fr = Math.max(0, this.sensors.feet[1]!.fz);
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
    let uStar = Math.max(-0.97, Math.min(0.97, span > 0.02 ? -(copZ - zc) / (span / 2) : -copZ / 0.16));   // ★ 0.85→0.97（0.85 把转移封顶在 88%=差 4-6cm 的元凶）
    let tau = 400 * (uStar - this.uF) - 25 * du;
    if (tau > 45) tau = 45; else if (tau < -45) tau = -45;   // ±45 实测：不够→向内慢倒（安全向）；±90→过冲向外倒（危险）
    this.tauNow = LeanReflex.approach(this.tauNow, tau, dt, 120);
    for (const side of ['l', 'r'] as const) {
      const di = this.world.body.dofByName(`hip_${side}`, 0);
      // ★ 离地的腿不吃力偶（hasAngle 判据会自锁——伺服借用了 manual 通道，见 §2.49 待重构）
      const unloaded = this.sensors.feet[side === 'l' ? 0 : 1]!.fz < 0.05 * this.world.body.sk.massTotal * 9.81;
      if (di >= 0 && !unloaded && !this.manual.isPinned(`hip_${side}`, 0) && this.tauNow !== 0) {
        this.world.executor.addTorque(di, this.tauNow);
      }
    }
    return this.tauNow;
  }

  /** ★ 门控让位（单腿动作期间）：力偶快速释放到 0——并继续写它的衰减值，确保真正卸掉 */
  releaseCouple(dt: number): void {
    this.tauNow = LeanReflex.approach(this.tauNow, 0, dt, 300);
    if (this.tauNow !== 0) {
      for (const side of ['l', 'r'] as const) {
        const di = this.world.body.dofByName(`hip_${side}`, 0);
        if (di >= 0 && !this.manual.isPinned(`hip_${side}`, 0)) {
          this.world.executor.addTorque(di, this.tauNow);
        }
      }
    }
  }

  /**
   * ★ 腰椎 · 轴L执行（自身状态控制器的输出，决策在伺服提案里）：
   *   限速写入 髋外展 + 脊柱侧折 目标（历史教训：不加滞回锁存）。
   */
  applyPosture(hip: number, spine: number, dt: number): void {
    // ★ 目标钳到物理可达（用户回读实证 2026-10：目标 +0.35 实际够不到 → 误差 0.65 常驻 →
    //   伺服 200 饱和顶着 → 载荷一放就"折穿"（−0.30→+0.14 翻 25°/0.4s = 侧向折）。
    const hipReach = Math.max(-0.15, Math.min(0.15, hip));
    this.posHip = LeanReflex.approach(this.posHip, hipReach, dt, 1.2);
    this.posSpine = LeanReflex.approach(this.posSpine, spine, dt, 1.2);
    // ★ 提案制仲裁（用户架构 2026-10："伺服的提案和行动的提案取舍合并；动作主动时暂停伺服；
    //   是否暂停写在动作提案里"）——伺服层**直写 Drive、不借 manual 通道**；
    //   动作层写过的轴（hasAngle）与 pin 的轴一律让位。
    // ★ 提案制仲裁重构已设计（§2.49/§2.50），本版暂回 manual 通道（重构需连伺服内部写手
    //   协调一起做：直写 Drive 后 contributeBaseline 会覆盖它——实测 A 相停摆）。
    // （重构尝试 1：单腿让位→C 0.00 崩——证明本写手在单腿期承重；
    //  正确顺序：先将 posHip 态环移植进 pelvisBearing再拆。当前保持功能等价）
    // ★ §2.415 单腿期让位（用户：脊柱/骨盆/承重腿必须同一指挥层）：髋/0 的提案已并入 pair 的 λ
    //   （supportReg §2.415），本写手在单腿期不再写髋——两写手=打架。
    const Wtot0 = this.world.body.sk.massTotal * 9.81;
    const sgL = this.sensors.feet[0]!.fz < 0.05 * Wtot0;
    const sgR = this.sensors.feet[1]!.fz < 0.05 * Wtot0;
    const singleLegNow = sgL !== sgR;
    for (const sd of ['l', 'r'] as const) {
      const ftIdx = sd === 'l' ? 0 : 1;
      const unloaded = this.sensors.feet[ftIdx]!.fz < 0.20 * this.world.body.sk.massTotal * 9.81;   // ★ §2.564 提前释放(回读:kp400端腿反作用=初始侧向力,旧阀值5%W太晚)
      if (!unloaded && !singleLegNow && !this.manual.isPinned(`hip_${sd}`, 0)) {
        this.manual.setAngle(`hip_${sd}`, 0, this.posHip, 400, 50);
      } else {
        this.manual.setAngle(`hip_${sd}`, 0, NaN, 0);   // ★ §2.553 释放（回读：leanReflex让位后旧目标残留manual数组——每帧重放=59不止的侧向力!）
      }
    }
    // ★ 场合分权（用户架构 2026-10-11）：脊柱侧向有两位专属——
    //   静态双支撑 = 本模块（姿势层，慢/常开）；单腿 = lateralStab（单腿专属，§2.86 间歇）。
    //   单腿场合本模块让位（否则与 lateralStab 逐帧互盖=挣扎感本体）。
    const Wtot = this.world.body.sk.massTotal * 9.81;
    const ulL = this.sensors.feet[0]!.fz < 0.20 * Wtot;   // ★ §2.564 同上
    const ulR = this.sensors.feet[1]!.fz < 0.20 * Wtot;   // ★ §2.564
    const singleLeg = ulL !== ulR;
    {
      for (const seg of ['spine1', 'spine2', 'spine3', 'spine4'] as const) {
        if (this.manual.isPinned(seg, 0)) continue;
        if (!singleLeg) this.manual.setAngle(seg, 0, this.posSpine, 100, 40);
        else this.manual.setAngle(seg, 0, NaN, 0);   // ★ §2.553 单腿期释放(防残留重放)
      }
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
    // ★ §2.470 用户：单腿期只有一个指挥层！——挺腰链路(hip/2 addTorque + spine/2 限速写入)单腿期让位
    //   （audit：spine1/2 a-set×760@ControlModule.step = 本函数每帧2-3次抢脊柱）
    if ((this.world.drive?.legReflex?.side ?? null) !== null) return;
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
      // ★ §2.610：引擎电机轴（踝内外翻/屈伸）不受反射直写——单写手（收编纪律）
      if (di >= 0 && !body.dofs[di]!.engineMotor
        && !this.manual.isPinned(joint, ax) && !this.manual.hasAngle(di) && this.manual.torqueOf(di) === 0) {
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
