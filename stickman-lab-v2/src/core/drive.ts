/**
 * drive.ts —— 命令层：把"想干什么"翻译成每步的关节力矩，写进 Executor
 *
 * 三条命令通道（可同时使用，Executor 求和后统一施加）：
 *   · `setAngle`     平衡点/阻抗命令：τ = K(θ*−θ)，D 项隐式（Stable PD）
 *   · `setTorque`    前馈力矩（重力补偿 / 平衡修正）
 *   · `setActivation` 肌肉激活命令：τ = a·τmax·FL·FV（actuator.ts）
 *
 * 数值稳定（Tan/Liu/Turk 2011；Tassa 2012）：
 *   · 显式弹簧/前馈/主动力矩合计被"一步收敛护栏"夹住：
 *       |τ_explicit| ≤ α · I_eff · ωmax / dt
 *   · 阻尼项做成隐式角冲量 `J = −I·ω·(1−e^(−B·dt/I))`，与 B 的大小无关。
 * 因此就算 kP 很大、dt 就算变大，也不会出现 v1 那种"显式 PD 发散"。
 */

import type { Skeleton } from './skeleton';
import type { Body, Dof } from './body';
import type { Executor } from './executor';
import { Actuator, DEFAULT_ACTUATOR_OPTIONS, type ActuatorOptions } from './actuator';

export interface DriveOptions extends ActuatorOptions {
  /** 一步收敛系数 α（1 = 一步内最多吃掉一个 ωmax 的误差速度，不过冲） */
  alpha: number;
  /** 限位越界回正速率（1/s，Baumgarte 型位置投影） */
  limitRate: number;
  /** 限位权限相对马达权限的安全系数（限位冲量 ≥ 该系数 × 马达每步冲量） */
  limitSafety: number;
  /** ★ IT band（髂胫束）被动髋外展元件：接入阈值（rad）；0=关 */
  itbThreshold: number;
  /** ★ IT band 幅值（N·m，指数型 T=k·(e^(over/τ)−1)；0=关） */
  itbStiffness: number;
  /** ★ IT band 指数时标 τ（rad） */
  itbTau: number;
  /** ★ 腰椎被动并联（胸腰筋膜/韧带）：接入阈值（rad）；0=关 */
  lumbarPassiveThreshold: number;
  /** ★ 腰椎被动刚度（N·m/rad²，每节、轴0/轴2 各计；0=关） */
  lumbarPassiveStiffness: number;
  /** ★ IAP/TLF 式脊柱**角刚度**（N·m/rad，每节轴0/2；文献：Hodges 2005 腹压增刚度、
   *   El Bojairami 2021 TLF 贡献 75% 静态稳定、Cholewicki 1996 肌肉刚度抗屈曲——"顶住上身"） */
  iapSpineStiffness: number;
  musclePairK: number;       // ★ §2.305 肌肉对共同激活刚度（C=1 时 N·m/rad）
  musclePairDamp: number;    // ★ §2.305 激活态阻尼（×C）
  musclePairTau: number;     // ★ 激活动力学时间常数（s）
  srsSpineDamping: number;   // ★ §2.289 SRS激活型阻尼（van der Zee/Ting 2026：交桥短程刚度=活动肌肉自带阻尼）
  /** ★ 支撑腿肌肉反射（§2.118）：支撑侧髋外展/足额状的目标=腿竖直/足平贴；
   *   纠偏误差由控制层按世界倾角注入（legReflex），本层做本地弹簧+阻尼（肌肉，不是全局算法）。0=关 */
  legMuscleK: number;
  /** 同上阻尼（N·m·s/rad） */
  legMuscleKd: number;
  /** 足部肌肉刚度（N·m/rad） */
  legMuscleFootK: number;
  /** 足部肌肉阻尼（N·m·s/rad） */
  legMuscleFootKd: number;
}

export const DEFAULT_DRIVE_OPTIONS: DriveOptions = {
  ...DEFAULT_ACTUATOR_OPTIONS,
  alpha: 1.0,
  limitRate: 20,
  limitSafety: 8,
  // ★ IT band（Inman 1947：单腿站立约一半髋外展力矩由被动组织承担；标定目标：
  //   内收超阈 0.3 rad ≈ 50 N·m、0.4 rad ≈ 88 N·m——危险角度自动分担）
  itbThreshold: 0.10,
  // ★ 按人体实测被动曲线拟合（Ashton-Miller 2020：10°内收≈5 N·m、22°≈26 N·m）：
  //   T = k·(e^(over/τ)−1)，k=12、τ=0.25 → over 0.075→4.2、0.285→26 ✓
  itbStiffness: 0,   // ★ §2.272 试：45→0（台账显示 ITB 被动−147 在吃 M2 的 act 330）——待判决
  itbTau: 0.25,
  // ★ 腰椎被动并联（胸腰筋膜/韧带；与 IT band 同一优雅原则：执行层被动件，不碰增益）：
  //   单腿实测侧向在 102 N·m/节（τmax）饱和 → 被动项在大角度补足；小角度零干扰。
  lumbarPassiveThreshold: 0.08,
  lumbarPassiveStiffness: 300,   // ★ §2.559 侧向压降(900→300,上同)
  srsSpineDamping: 3.0,     // ★ 基态回 3（A 相基态不能重；单腿的重阻尼由 supportColumn 动态覆盖=15）（保转移自由；15 全程=禁止转移，实测 A 相卡死 7s）；危险档在 supportReg 升到 45
  musclePairK: 1100,   // ★ §2.521 回退   // ★ §2.504 用户：弓腿矩矩力不够！上身重力矩~、120-150,420×0.9×10°≈64→提到1100   // ★ §2.499 回退（判别实验已证明 pair 在工作，act=0 是采样假象）   // ★ §2.488 Hill三元件:CE主动力独立亊强(保证腿/跨直),PE被动阻尼保持小   // ★ §2.404b 用户：盆骨也要±10°修正——算术：盆骨下落矩 60-90N·m/420×0.7≈300→误差15°; →900 试          // ★ §2.305 肌肉对刚度/单位C
  musclePairDamp: 40,   // ★ §2.535 回退(60更糟)    // ★ §2.521 回退(100反而更糟:余量0.8/0.21s)         // ★ §2.406 用户：力矩=根据偏移角度计算——速度项在抬腿瞬态(原始vel~30rad/s)被放大到饱和→纯角度项        // ★ §2.371 用户：阻尼必须很大 —— 22→40
  musclePairTau: 0.06,       // ★ Zajac 一阶激活
  iapSpineStiffness: 80,   // ★ §2.559 张力压降(用户:缓而慢/初态平衡——硬乘载不是发力)   // ★ §2.284 Gurfinkel两层模型——张力层“始终紧绷”：180→260
  // ★ 支撑腿肌肉反射（§2.118；文献：牵张反射/GLM 本地刚度——莱尔肌肉"自我保护"通路）：
  //   实测缺口：C 相支撑腿塌线（大腿世界倾角 −27°/足 −65°）而 B 相腿是竖直的（−2°）
  //   ⇒ 肌肉应当"记忆竖直"，倾角误差一出现就本地强纠正（不走全身算法）。
  legMuscleK: 100,          // ★ §2.234 回读实锤：K350×大腿滚角=+52 与 M2 的 −21 对拉——净驱动朝倒方；单腿段该轴归 M2 独占，反射降为搁线急救
  legMuscleKd: 12,          // ★ §2.220 回读：骰外展 64↔197 令牌 ±65＝Kd35×关节速噪声±2——压到12
  legMuscleFootK: 220,      // ★ §2.268 判决：踝锁刚度数值上限220-300（400/600 均失稳，小惯量锁离散极限）→回 220；未来“硬锁”走引擎电机路径
  legMuscleFootKd: 3,          // ★ §2.216 15→3（小惯量踝轴 Kd15×v±16=±102 逐帧弹跳；降到正常阻尼量级）
};

export class Drive {
  readonly opt: DriveOptions;
  readonly actuator: Actuator;
  /** 位置目标（rad，相对静姿态；NaN = 无命令） */
  private readonly target: Float64Array;
  /** 逐自由度伺服增益（N·m/rad、N·m·s/rad） */
  private readonly kp: Float64Array;
  private readonly kd: Float64Array;
  /** 前馈力矩（N·m） */
  /** ★ 供 IAP 让位判断（控制层装配时注入） */
  manualRef: { hasAngle(i: number): boolean; angleOf(i: number): number } | undefined;
  /** ★ 支撑腿肌肉反射（§2.118；控制层每帧注入：支撑侧别 + 世界倾角纠偏误差，rad） */
  readonly legReflex = { side: null as 'l' | 'r' | null, hipErr: 0, kneeErr: 0, footErr: 0, pelvisDamp: 0, footTauCap: 60, swingAirBoost: 1, supDampBoost: 1, latResidS: 0, latNeed: 0 };   // ★ §2.292 膝接入支撑列；§2.294 足矩联接触容量封顶
  /** ★ §2.142 离地自动调参（用户）：摆动腿上空时被动阻尼 ×boost（肌肉共激活）——控制层每帧置位 */
  private readonly ff: Float64Array;
  /** ★ 通道分离（用户架构 2026-10）：逐帧写戳——伺服/动作写过即标记，基线据此让位 */
  readonly writeFrame: Int32Array;
  /** ★ §2.148 阻尼用低通速度（瞬时速度含 240Hz 物理噪声，直接×B每帧撞阻尼幅≡bang-bang） */
  /** ★ §2.305 肌肉对状态：共同激活 C（锁）+ 参考角 ref（回正） */
  readonly pairC: Float64Array;
  readonly pairRef: Float64Array;
  readonly pairCTarget: Float64Array;   // ★ §2.314 基线让位检查用（public）
  pairDampGlobal = 1.0;   // ★ §2.525 CoM速度限速环的全局阻尼倍率（supportReg 每帧写）
  /** ★ §2.530 跨节肌肉（装配层定义：背部多节段肌）：每条 = {节点集, C, 合角参考λ} */
  readonly spanMuscles: Array<{ dofs: number[]; c: number; ref: number }> = [];
  commandSpanMuscles(list: Array<{ dofs: number[]; c: number; ref: number }>): void { this.spanMuscles.length = 0; for (const m of list) this.spanMuscles.push(m); }
  readonly pairVelPrev: Float64Array;   // ★ §2.515 加速度阻尼前帧速度
  readonly pairVel: Float64Array;   // ★ §2.402 阻尼滤波速度（绷着=阻尼但不放大抖动）
  readonly pairCap: Float64Array;   // ★ §2.432 申请制预算（自下而上逐级批准的力矩上限；默认 ∞）
  private readonly velF: Float64Array;
  /** ★ §2.194 上一帧速度（两帧平均阻尼） */
  private readonly velPrev: Float64Array;
  frameNo = 0;
  /** 最近一步各通道的统计（探针回读） */
  readonly stats = { passive: 0, active: 0, servo: 0, ff: 0, damp: 0, limitHits: 0, conflicts: 0 };   // ★ §2.313 冲突计数
  readonly conflictByDof = new Int32Array(256);   // ★ §2.344 逐关节冲突计数
  /** ★ 逐自由度分通道记账（只读调试口；步 1 力链定位用，不参与控制）。
   *   stiff=被动弹性、itb=IT band 并联、act=Hill 主动、servo=位置伺服、ff=前馈、damp=黏性阻尼。 */
  readonly lastBreakdown: Array<{ stiff: number; itb: number; lum: number; act: number; servo: number; ff: number; damp: number }> = [];

  constructor(
    private readonly sk: Skeleton,
    private readonly body: Body,
    private readonly executor: Executor,
    opt: Partial<DriveOptions> = {},
  ) {
    this.opt = { ...DEFAULT_DRIVE_OPTIONS, ...opt };
    this.actuator = new Actuator(body.dofs, this.opt);
    const n = body.dofs.length;
    this.target = new Float64Array(n).fill(Number.NaN);
    this.kp = new Float64Array(n);
    this.kd = new Float64Array(n);
    this.ff = new Float64Array(n);
    this.writeFrame = new Int32Array(n).fill(-1);
    this.velF = new Float64Array(n);
    this.velPrev = new Float64Array(n);
    this.pairC = new Float64Array(n);
    this.pairRef = new Float64Array(n);
    this.pairCTarget = new Float64Array(n);
    this.pairVel = new Float64Array(n);
    this.pairVelPrev = new Float64Array(n);
    this.pairCap = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  }

  /** ★ §2.305 肌肉对命令（共同激活=锁，参考角=回正；C 走一阶激活动力学） */
  /** ★ §2.422 全关节写入审计（仅 __WRITELOG 开启时记录，常态零开销） */
  private trace(dofIdx: number, kind: string, v: number): void {
    const g = globalThis as unknown as { __WRITELOG?: Array<[number, number, string, number, string]> };
    if (g.__WRITELOG) {
      const e = new Error();
      const st = (e.stack ?? '').split(String.fromCharCode(10)).slice(2, 5).join('|');
      g.__WRITELOG.push([this.frameNo, dofIdx, kind, v, st]);
    }
  }
  commandMusclePair(dofIdx: number, c: number, ref: number): void {
    if (c !== 0) this.trace(dofIdx, 'pair', c);
    this.pairCTarget[dofIdx] = c;
    this.pairC[dofIdx] = c;
    this.pairRef[dofIdx] = ref;
  }

  // ─────────────────────────────── 命令接口
  /** 阻抗/平衡点命令。kp/kd 省略时用 tauMax 与有效惯量的合理默认（临界阻尼） */
  setAngle(dofIdx: number, rad: number, kp?: number, kd?: number): void {
    this.trace(dofIdx, 'angle', rad);
    this.writeFrame[dofIdx] = this.frameNo;
    const d = this.body.dofs[dofIdx]!;
    const lim = Math.max(Math.abs(d.min), Math.abs(d.max), 0.3);
    const K = kp ?? 0.5 * d.tauMax / lim;          // 到限位处约 0.5·τmax
    this.target[dofIdx] = rad;
    this.kp[dofIdx] = K;
    this.kd[dofIdx] = kd ?? NaN;                    // NaN = 每步按临界阻尼算
  }

  /** 按 关节名+轴 设置（探针/上层友好） */
  setJointAngle(name: string, axis: number, rad: number, kp?: number, kd?: number): void {
    const i = this.body.dofByName(name, axis);
    if (i >= 0) this.setAngle(i, rad, kp, kd);
  }

  /** 撤销位置目标（该自由度回到纯被动 + 激活） */
  clearAngle(dofIdx: number): void {
    this.target[dofIdx] = Number.NaN;
  }

  /** 前馈力矩 */
  setTorque(dofIdx: number, tau: number): void {
    this.trace(dofIdx, 'torque', tau);
    this.ff[dofIdx] = tau;
  }

  /** 当前前馈力矩（供姿势基线判断"该轴是否有主动发力"） */
  ffOf(dofIdx: number): number {
    return this.ff[dofIdx] ?? 0;
  }

  /** （§2.156：随 velF 一并撤回——返回原始速度） */
  velFilteredOf(dofIdx: number): number {
    return this.body.dofs[dofIdx]?.vel ?? 0;
  }

  /** 肌肉激活 ∈ [−1,1] */
  setActivation(dofIdx: number, a: number): void {
    this.actuator.setActivation(dofIdx, a);
  }

  setJointActivation(name: string, axis: number, a: number): void {
    const i = this.body.dofByName(name, axis);
    if (i >= 0) this.setActivation(i, a);
  }

  clearAll(): void {
    this.target.fill(Number.NaN);
    this.kp.fill(0);
    this.kd.fill(0);
    this.ff.fill(0);
    this.actuator.clearAll();
  }

  // ──────────────────────────────── 每步执行
  /** 计算并写入全部自由度的力矩（world.advance 里调用；applyAll 由 world 统一调用） */
  step(dt: number): void {
    this.frameNo++;
    this.actuator.updateActivation(dt);
    const s = this.stats;
    s.passive = 0; s.active = 0; s.servo = 0; s.ff = 0; s.damp = 0; s.limitHits = 0; s.conflicts = 0;

    const dofs = this.body.dofs;
    for (let i = 0; i < dofs.length; i++) {
      const d = dofs[i]!;
      if (d.engineMotor) continue;                     // 柔性足：引擎电机独占，禁止第二条路径
      const I = Math.max(1e-9, d.inertia);
      const b = this.actuator.dampingOf(i);

      // ① 显式力矩：被动弹性 + ★IT band + 主动（Hill）+ 伺服弹簧 + 前馈
      let tex = this.actuator.stiffnessOf(i) * (0 - d.angle);
      const bd = { stiff: tex, itb: 0, lum: 0, act: 0, servo: 0, ff: 0, damp: 0 };
      s.passive += Math.abs(tex);
      // ═══ 被动组织（执行层被动件；均非控制增益，免疫 τmax 派生增益联动）═══
      // ① IT band（髂胫束）被动髋外展元件：
      //   髋 ab/adduction 轴（axis0）偏离中性超阈后接入的二次渐进被动弹簧。
      //   文献：Inman 1947（人体约一半髋外展力矩靠被动组织）/ McLeish & Charnley 1970 /
      //   Prior 2014（骨盆下沉姿势臀中肌激活 −84%，转向被动承载）。小角度零干扰。
      if (d.axis === 0 && (d.name === 'hip_l' || d.name === 'hip_r') && this.opt.itbStiffness > 0) {
        // ★ §2.136：ITB 是**支撑髋**被动件（Inman 1947 单腿站立）——单腿期不得拉摆动腿
        //   （回读：摆动腿外展一超阈就被这根指数弹簧横拉 ±130N·m——"侧向拉腿"元凶）
        const itbSide = d.name === 'hip_l' ? 'l' : 'r';
        const itbAllowed = this.legReflex.side === null || this.legReflex.side === itbSide;
        const over = Math.abs(d.angle) - this.opt.itbThreshold;
        if (itbAllowed && over > 0) {
          const tItb = -Math.sign(d.angle) * this.opt.itbStiffness * (Math.exp(over / this.opt.itbTau) - 1);
          // ★ 走被动并联通道（不受肌肉 τmax 饱和）——"优雅落点"的完整形态
          this.executor.addPassiveTorque(i, tItb);
          bd.itb += tItb;
          s.passive += Math.abs(tItb);
        }
      }
      // ★ §2.305 肌肉对（用户：上身也没有合适的肌肉来锁死/回正）：上躯系（spine）上
      //   C（共同激活）=锁（刚度）；ref=回正；C 走一阶激活动力学（连续无阶跃）。
      {
        const cRaw = this.pairCTarget[i]!;
        if (cRaw > 0 || this.pairC[i]! > 1e-3) {
          const isPairAxis = (/^spine/.test(d.name) && (d.axis === 0 || d.axis === 2))
            || (/^(hip_|knee_|foot_)/.test(d.name) && (d.axis === 0 || d.axis === 2));   // ★ §2.502 用户：髇矢状裸奔(servo vs ff 互砸±1300)→轴零+轴二都走肌肉对
          if (isPairAxis) {
            // ★ §2.320 用户：肌肉发力有缓冲——C 走激活动力学（渐起，防瞬间高刚度）
            this.pairC[i] = this.pairC[i]! + (cRaw - this.pairC[i]!) * (1 - Math.exp(-1 / 240 / Math.max(1e-3, this.opt.musclePairTau)));
            const c = this.pairC[i]!;
            if (c > 1e-3) {
              const dev = this.pairRef[i]! - d.angle;
              // ★ §2.482 用户：单向阻尼+随角度变化（肌肉=单向阻尼，拉得越远抗得越强）：
              //   阻尼倍率 g = 1 + 3×|偏离|（0.上限 3）；偏离越大阻尼越强（偏心特性）。
              const gDamp = 1 + Math.min(3, Math.abs(dev) * 10);
              // ★ §2.522 两段式制动（用户：架构级修正；文献 Debelle 2020）：
              //   运动状态 s=dev×vel：正=倒下中(ARREST档)，负=抬回中(RAISE档)
              const movingAway = dev * d.vel > 0;   // ★ §2.538 回退§2.536
              const kStage = movingAway ? 1.5 : 0.7;
              const dStage = movingAway ? 1.5 : 0.4;   // ★ §2.524 用户：回正段低阻尼(0.4)——慢降不漂移
              // ★ §2.515 用户：把加速度限死（回读上身±6g）：加速度阻尼项（质量大的上身最需）
              // ★ §2.516 用户：量纲修正——加速度阻尼=惯量矩(物理正确: J×α)
              const aRaw = (d.vel - (this.pairVelPrev[i] ?? d.vel)) * 240;   // 角加速度 rad/s²
              this.pairVelPrev[i] = d.vel;
              const aDamp = 0;   // ★ §2.517 判别实验：关闭惯量阻尼验证震荡来源
              // ★ §2.491 用户：肌肉必须都是单向阻尼式——显式双肌模型：
              //   M1(主动肌) = 仅向λ方向拉：[K×dev]⁺ + D×[被拉长方向速度]⁺（只拉不推、只抗拉长）
              //   M2(抵抗肌) = 镜像
              // ★ §2.563 脊柱侧向阻尼减半（用户：缓而慢——速度项在快入口爆发±150）
              const dScale = (/^spine/.test(d.name) && d.axis === 0) ? 0.7 : 1;
              const _dd = this.opt.musclePairDamp * dStage * this.pairDampGlobal * gDamp * dScale;
              const f1 = Math.max(0, this.opt.musclePairK * kStage * dev) + _dd * Math.max(0, -d.vel);
              const f2 = Math.max(0, -this.opt.musclePairK * kStage * dev) + _dd * Math.max(0, d.vel);
              let tq = c * (f1 - f2) + aDamp;
              // ★ §2.432 申请制：本级写 min(申请, 下层批准的预算)
              const capp = this.pairCap[i]!;
              if (tq > capp) tq = capp; else if (tq < -capp) tq = -capp;
              // ★ §2.419 实测（用户：抬腿时有大侧向力）：刚加的 over 陡增在抬腿瞬态(dev跳变)直接砸到 τmax=225——自作聪明的多余项，撤销。
              if (/^foot_/.test(d.name)) {
                const fc = this.legReflex.footTauCap;
                tq = Math.max(-fc, Math.min(fc, tq));
              }
              tex += tq;
              bd.act += tq;
              s.active += Math.abs(tq);
            }
          }
        }
      }
      // ② IAP/TLF 式脊柱角刚度（共收缩刚度；肌肉介导 → 留在主动钳位路径内）
      if ((d.name === 'spine1' || d.name === 'spine2' || d.name === 'spine3')
        && (d.axis === 0 || d.axis === 2) && this.opt.iapSpineStiffness > 0) {
        // ★ 让位（2026-10-11）：动作指挥的轴（manual hasAngle）IAP 不拉——
        //   否则共收缩弹簧（目标=0）与弯腰（−0.4）全程对拉（HF 207 的真凶）。
        // ★ §2.290 用户：“缺上身肌肉+保持当前姿态”——张力层不回零位，而是**托住当前命令目标**（目标为空时=0）。
        // ★ §2.290 终审：目标跟随版更差（59%/192），全轴常开也更差（45%/157）
        //   → 定稿=侧向轴（axis0）常开锚竖直；矢状轴（axis2）保留让位（弯腰自由）。
        const acted = d.axis === 2 && this.manualRef !== undefined && this.manualRef.hasAngle(i);
        // ★ 按轴分配（2026-10-11：力链内耗 275-392% 的诊断处方）：
        //   额状面（axis0）要硬=骨盆稳定/安全带；矢状面（axis2）回柔=弯腰/缓冲放内耗。
        const kIap = d.axis === 0 ? this.opt.iapSpineStiffness : this.opt.iapSpineStiffness * 1.0;   // ★ 矢状 ×0.5→×1.0（用户：脊柱前后张力不足）
        if (!acted) tex += kIap * (0 - d.angle);   // ★ §2.492 用户：脊柱没骨架也没肌肉！——骨性刚度永远在线(不与 pair 互斥)
        s.passive += Math.abs(kIap * (0 - d.angle));
        // ★ §2.289 激活型阻尼（短程刚度的速度项）：活动肌肉对小速度的抵抗（上身演缓摆的阻尼来源）
        // ★ §2.415b 一轴一律：pair 上岗（pairCTarget>0）时 srs 让位（原来与 pair 的 C×Damp 双重叠加）
        if (!acted && this.opt.srsSpineDamping > 0) tex += -this.opt.srsSpineDamping * d.vel;   // ★ §2.492 同上
      }
      // ③ 腰椎被动并联（胸腰筋膜/韧带）：脊柱 1–3 轴0/轴2（同 IT band，走并联通道）
      if ((d.name === 'spine1' || d.name === 'spine2' || d.name === 'spine3')
        && (d.axis === 0 || d.axis === 2) && this.opt.lumbarPassiveStiffness > 0) {
        const over = Math.abs(d.angle) - this.opt.lumbarPassiveThreshold;
        if (over > 0) {
          const kLum = d.axis === 0 ? this.opt.lumbarPassiveStiffness : this.opt.lumbarPassiveStiffness * 0.66;   // ★ 按轴（0.66=单脚最佳）
          const tLum = -Math.sign(d.angle) * kLum * over * over;
          this.executor.addPassiveTorque(i, tLum);
          bd.lum += tLum;
          s.passive += Math.abs(tLum);
        }
      }
      const tact = this.actuator.activeTorque(d, i);
      tex += tact;
      // ★ §2.514 仪表真凶修复（4次误判的根源）：原 bd.act = tact 覆盖了 MusclePair 的 += 贡献
      bd.act += tact;
      s.active += Math.abs(tact);
      // ④ 支撑腿肌肉反射（§2.118）：支撑侧本地误差弹簧+阻尼（肌肉不是算法），
      //    带 τmax 饱和（真肌肉有上限——防大幅误差时泵能量）；
      //    + 骨盆滚转阻尼对偶（§2.119：两髋反向=纯滚转阻尼，无净推、不抢位置）。
      if (this.opt.legMuscleK > 0 && this.legReflex.side !== null) {
        const lr = this.legReflex;
        const side = d.name.endsWith('_l') ? 'l' : d.name.endsWith('_r') ? 'r' : null;
        if (side !== null && d.axis === 0
          && (d.name.startsWith('hip_') || d.name.startsWith('knee_') || d.name.startsWith('foot_'))) {
          const acted = this.manualRef !== undefined && this.manualRef.hasAngle(i);
          let tm = 0;
          // ★ §2.324 第三刀：弹簧/阻尼收编到肌肉对柱（isPairAxis 块）——此处只留 M2 髇注入。
          void acted;
          // ★ §2.150 只加支撑髋（§2.119 约束：成对加=摆动髋接 −pelvisDamp=±200 侧向锤）
          //   复发史：§2.142 重构时该行被误回到成对形式——"抖到摆动腿往外"的真因
          if (d.name.startsWith('hip_') && side === lr.side) {
            tm += lr.pelvisDamp;
          }
          if (tm !== 0) {
            const Tm = d.tauMax > 0 ? d.tauMax : 1e9;
            tm = Math.max(-Tm, Math.min(Tm, tm));
            tex += tm;
            bd.act += tm;
            s.active += Math.abs(tm);
          }
        }
      }
      const tgt = this.target[i]!;
      if (!Number.isNaN(tgt)) {
        const ts = this.kp[i]! * (tgt - d.angle);
        tex += ts;
        bd.servo = ts;
        s.servo += Math.abs(ts);
      }
      const tff = this.ff[i]!;
      tex += tff;
      bd.ff = tff;
      s.ff += Math.abs(tff);

      // ② 一步收敛护栏（α·I·ωmax/dt）
      // ★ §2.275（240Hz台账铁证）：此处 I 用**腿局部惯量**（~0.016）→ 髋的 tCap≈34N·m
      //   ——命令 246 被削到 34！但髋实际带的是**腿+全身的铰接惯量**（大几十倍）。
      //   对髋类轴吊住 I 下限（保守 0.8）：此后机制由 τmax/一步校验 管。
      const Icap = /^hip_/.test(d.name) ? Math.max(I, 0.8) : I;
      const tCap = (this.opt.alpha * Icap * this.opt.jointMaxSpeed) / dt;
      if (tex > tCap) tex = tCap; else if (tex < -tCap) tex = -tCap;

      // ③ 黏性阻尼：τ_d = −B·ω（显式），|τ_d| ≤ κ·τmax。
      //
      //   ★ 为什么**不用**惯量反演的隐式公式（J = −I·ω·(1−e^(−B·dt/I))）：
      //     它需要真实关节空间惯量 M_uu，而 M_uu 是"铰接体惯量"（远端关节自由
      //     ⇒ 链会折叠 ⇒ 比刚性子树小）。用任何估算的上界都会过冲 ⇒ 负阻尼 ⇒
      //     泵能量（实测：刚性子树 300 rad/s 持续；下界又几乎不起作用）。
      //     直接黏性 τ=−B·ω 的稳定性只要求 B·dt/M_uu < 2；B 取 τmax 的小比例，
      //     配合执行器 τmax 硬夹与一步收敛护栏 ⇒ 对 M_uu 不敏感。
      let B = b;
      // ★ §2.142/2.144 足三态自动调参：摆动腿(离地)与支撑腿(单腿)各自的被动阻尼倍增
      if (this.legReflex.side !== null) {
        const sside = d.name.endsWith('_l') ? 'l' : d.name.endsWith('_r') ? 'r' : null;
        if (sside !== null && (d.name.startsWith('hip_') || d.name.startsWith('knee_') || d.name.startsWith('foot_') || d.name.startsWith('ankle_'))) {
          if (sside !== this.legReflex.side && this.legReflex.swingAirBoost !== 1) B *= this.legReflex.swingAirBoost;
          if (sside === this.legReflex.side && this.legReflex.supDampBoost !== 1) B *= this.legReflex.supDampBoost;
        }
      }
      if (!Number.isNaN(tgt)) {
        const kdRaw = this.kd[i]!;
        // ★ 默认阻尼：**保守的小比例**（0.02·τmax）。
        //   原公式 0.5·√(kp·I) 用"刚性子树上界惯量"，对轻轴严重高估
        //   ⇒ 显式阻尼过冲 ⇒ ~76Hz 全身振铃（实测 Σ|ω|≈133）。
        //   隔离实验：固定小 kd 下 Σ|ω| 收敛到 0。
        const kdUse = Number.isNaN(kdRaw)
          ? 0.02 * Math.max(10, d.tauMax)
          : kdRaw;
        B += kdUse;
      }
      // ★ 显式阻尼的稳定上限：B·dt/I 必须 < 2。kd 是按**刚性子树上界惯量**算的，
      //   对轻轴会高估 ⇒ 超出上限 ⇒ ~76Hz 极限环（实测全身 Σ|ω|≈133）。
      //   按**下界惯量**（inertiaLow）封顶，保证永不越界。
      // ★ §2.151 细颤根治：阻尼已吃低通速度(τ15ms≫dt)——时间常数换稳定，Bmax 放宽 0.8→3.0
      const Bmax = 0.8 * Math.max(1e-9, d.inertiaLow) / dt;   // ★ §2.154 足类放宽3×也破稳→统一 0.8（240Hz显式阻尼系数有硬上限）
      if (B > Bmax) B = Bmax;
      let td = 0;
      if (B > 0 && d.vel !== 0) {
        // ★ §2.148/2.155 按侧分工况：摆动腿(自由)=低通15ms抗抖；支撑腿/其余=即时速度（接触的即时管理不能迟滞）
        // ★ §2.194 两帧平均阻尼（用户：下移会跳）：瞬时速度含 120Hz 交替噪声，td=-B×v 逐帧翻号=Nyquist 爆炸；
        //   两帧平均恰斩纯交替（(+a,-a)/2=0），滞后仅 2ms（不伤站姿，避§2.156 的 15ms 滞后）
        const vAvg = 0.5 * (d.vel + (this.velPrev[i] ?? d.vel));
        this.velPrev[i] = d.vel;
        td = -B * vAvg;
        const cap = 0.5 * d.tauMax;
        if (td > cap) td = cap; else if (td < -cap) td = -cap;
      }
      s.damp += Math.abs(td);
      bd.damp = td;
      // ★ §2.513 仪表修复：lastBreakdown 平滑（30ms EMA）——act 等通道逐 substep 交替，直接读会得到假零
      {
        const prev = this.lastBreakdown[i];
        if (prev) {
          const aEma = 1 - Math.exp(-1 / 240 / 0.03);
          prev.stiff += (bd.stiff - prev.stiff) * aEma;
          prev.itb += (bd.itb - prev.itb) * aEma;
          prev.lum += (bd.lum - prev.lum) * aEma;
          prev.act += (bd.act - prev.act) * aEma;
          prev.servo += (bd.servo - prev.servo) * aEma;
          prev.ff += (bd.ff - prev.ff) * aEma;
          prev.damp += (bd.damp - prev.damp) * aEma;
        } else {
          this.lastBreakdown[i] = { ...bd };
        }
      }
      // ★ §2.313 冲突检测器（用户：写手明确就能开工）：同轴同帧、两类写手反符号且都 >5N·m = 一次对拉违规。
      {
        const TH = 5;
        // ★ §2.344 番外修正：排除 ff（绝大多数是重力补偿——它 vs 伺服是合法发力结构，不是对拉）
        const comps = [bd.stiff + bd.itb + bd.lum, bd.act, bd.servo];
        let pos = 0, neg = 0;
        for (const c of comps) { if (c > TH) pos++; else if (c < -TH) neg++; }
        if (pos > 0 && neg > 0) { s.conflicts++; this.conflictByDof[i] = (this.conflictByDof[i] ?? 0) + 1; }
      }

      this.executor.addTorque(i, tex + td);

      // ④ 限位通道（仅**没有引擎限位**的球铰自由度）。
      //   v1 的实测结论逐条照搬：
      //     · 目标角速度只由**越界量**决定（不看 ω，否则被继续越界的 ω 牵着走）；
      //     · 限位冲量上限与 I 无关、只与马达同尺度：Jcap = bias·τmax·dt
      //       （合并过 `bias·I·dt`，实测把腰甩飞）；
      //     · bias：脊柱 / 大幅越界 12，其余 8 ⇒ 限位权限恒压过马达。
      if (!d.engineLimited && !d.engineMotor && d.tauMax > 0) {
        const a = d.angle;
        const over = a > d.max ? a - d.max : a < d.min ? a - d.min : 0;
        if (over !== 0) {
          const bias = (d.name.startsWith('spine') || Math.abs(over) > (5 * Math.PI) / 180)
            ? 12 : this.opt.limitSafety;
          d.impulseMax = bias * d.tauMax * dt;
          //   ★ 惯量用**下界 × 0.5**：限位冲量宁可偏小（多花几拍回正），
          //     绝不能过冲 —— 用刚性子树惯量（上界）实测把系统泵到 900 rad/s。
          const Iax = Math.max(1e-9, 0.5 * d.inertiaLow);
          const wCap = Math.max(6, this.opt.limitSafety * d.tauMax / (Math.max(1e-9, d.inertia) / dt));
          const wTarget = -Math.sign(over) * Math.min(Math.abs(over) * this.opt.limitRate, wCap);
          const J = Math.max(-d.impulseMax, Math.min(d.impulseMax, (wTarget - d.vel) * Iax));
          this.executor.addLimitImpulse(i, J);
          s.limitHits++;
        } else {
          d.impulseMax = 0;
        }
      }
    }
    // ★ §2.530 跨节肌肉（装配层定义、控制层接口）：合角弹簧，力均分到各节（背部多节段肌）
    for (const m of this.spanMuscles) {
      if (m.c < 1e-3 || m.dofs.length < 2) continue;
      let sum = 0;
      for (const di of m.dofs) sum += this.body.dofs[di]!.angle;
      // ★ §2.534 用户：新肌肉也要走申请制（不得悬空发力）：各节受自身 pairCap 封顶
      const tq = (-this.opt.musclePairK * m.c * (sum - m.ref)) / m.dofs.length;
      for (const di of m.dofs) {
        const dsc = this.body.dofs[di]!;
        const capS = this.pairCap[di]!;
        const dt2 = Math.max(-capS, Math.min(capS, Math.max(-0.5 * dsc.tauMax, Math.min(0.5 * dsc.tauMax, tq))));
        this.executor.addTorque(di, dt2);
        s.active += Math.abs(dt2);
        const bd = this.lastBreakdown[di];
        if (bd) bd.act += dt2;
      }
    }
  }
}
