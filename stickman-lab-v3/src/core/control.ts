/**
 * control.ts —— ★ 控制模块（整合器 + 唯一写手）
 *
 * 用户定调：控制模块只做四件事——
 *   ① 接受命令（直控/意图）
 *   ② 整合两提案（摔倒预警伺服提案 + 动作提案）
 *   ③ 反射（按预警提案里的 `reflexDirectives` 运行反射工具箱）
 *   ④ 直接操作关节（唯一写关节命令的地方，经 Executor）
 *
 * 产出方（预警/垫脚/保护程序/动作程序/平衡基建）的输出全部进这里；
 * 控制模块自己不发明动作，只做"收进来 → 逐轴整合 → 发出去"。
 */

import type { World } from './world';
import { Sensors } from './sensors';
import { StabilityWarner, type StabilityProposal } from './stability';
import { FootPad } from './footPad';
import { FootAnkleModule } from './servo/footAnkleModule';
import { applyWobblingMass } from './servo/wobblingMass';
import { sampleAccObserver } from './servo/accObserver';
import { sampleFootContact } from './servo/footContact';
import { sampleJointEkf } from './servo/jointEkf';
import { KneeGuard } from './servo/kneeGuard';
import { ActionSystem } from './actionSystem';
import { LeanReflex } from './leanReflex';
import { MomentumReg } from './servo/momentum';
import type { Perception } from './perception';
import type { LateralSense } from './lateralSense';
import type { ManualControl } from './manual';
import { PROPOSALS, propose, PRI } from './proposalBus';
import { baseState } from './servo/baseTable';   // ★ 提案总线（用户："所有的写手都是提案制"）
import { ConstraintLayer } from './constraints/constraintLayer';
import { JointLimitConstraint } from './constraints/jointLimit';
import { HipLateralConstraint } from './constraints/hipLateral';
import { PredictionLayer } from './prediction/predictionLayer';
import type { LowerBodyCommand } from './command/lowerBody';
import { StandCommand } from './command/standCommand';
import { SquatDownCommand } from './command/squatDownCommand';
import { SquatCommand } from './command/squatCommand';
import { applyLowerBodyPDDirect } from './command/lowerBodyPD';
import { createFrameCommand, patchJoint } from './command/frameCommand';
import { supportClean } from './servo/supportClean';
import { setMuscleImpedance, getMuscleImpedance, clearMuscleImpedance, type MuscleImpedanceCmd } from './servo/muscleImpedance';

export interface ControlOptions {
  comKp: number;
  comKd: number;
  maxForceFrac: number;
  postureTone: number;
}

export const DEFAULT_CONTROL_OPTIONS: ControlOptions = {
  comKp: 12,
  comKd: 7,   // ★ §2.215 Masani 2003：踝=CoM速度主导 PD（高微分增益）（5→10，此处是实际生效层）
  maxForceFrac: 0.35,
  postureTone: 8,
};

export class ControlModule {
  readonly sensors: Sensors;
  readonly perception: Perception;
  readonly lateral: LateralSense;
  /** 产出方：摔倒预警（平衡算法在它里面） */
  readonly warner: StabilityWarner;
  /** 反射执行器：垫脚（四向 CoP + 柔性足） */
  readonly pad: FootPad;
  readonly footAnkle: FootAnkleModule;
  readonly kneeGuard = new KneeGuard();
  /** 反射执行器：侧向重心转移（髋策略，按预警的 lean directive 执行） */
  readonly lean: LeanReflex;
  /** ★ 反射弧：落地消力（不需要提案；自触发自计算；§3.12） */
  /** ★ 动量调节器（§2.16：动作执行期间自动调用；手臂反向旋转） */
  readonly momReg = new MomentumReg();
  /** 直控入口（最高优先级） */
  readonly manual: ManualControl;
  /** 动作层（独立系统：出动作提案，经本模块整合；伺服层同时默默工作） */
  readonly actions: ActionSystem;
  /** 唯一约束层：关节限位、虚拟安全筒、后续 CoM/CoP 约束 */
  readonly constraints: ConstraintLayer;
  /** 只读预测层：CoM/CoP/DCM 预测，不写力 */
  readonly prediction: PredictionLayer;
  /** 下盘命令层：状态切换只换这个实例；PD 执行层不换。 */
  lowerCommand: LowerBodyCommand;
  private readonly squatDownCommand: SquatDownCommand;
  private readonly squatCommand: SquatCommand;
  private readonly standCommand: StandCommand;
  private prevSquatDownMode = false;
  private prevSquatMode = false;
  private ankleLpInit = false;
  private readonly ankleVelLp = new Float64Array(2);
  private readonly ankleAngLp = new Float64Array(2);
  padEnabled = String(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).PAD ?? '1') !== '0';   // pad=踝 CoM 唯一执行器（关掉全灭实测）；PAD=0 对照
  /** 最近一拍的整合输入（回读：预警提案） */
  lastProposal: StabilityProposal | null = null;
  private readonly opt: ControlOptions;

  constructor(private readonly world: World, opt: Partial<ControlOptions> = {}) {
    const o = { ...DEFAULT_CONTROL_OPTIONS, ...opt };
    this.opt = o;
    this.sensors = new Sensors(world);
    this.perception = world.perception;
    this.lateral = world.lateral;
    // 预警：平衡算法；踝交给反射执行器（垫脚），基建由贡献方法给出
    this.warner = new StabilityWarner(world, {
      gravityComp: true,
      comKp: o.comKp,
      comKd: o.comKd,
      maxForceFrac: o.maxForceFrac,
      postureTone: o.postureTone,
      ankleStrategy: false,
      postureSkipAnkles: true,
    });
    this.pad = new FootPad(world, {}, this.warner.manual);
    this.footAnkle = new FootAnkleModule(world.body.dofs.length);
    this.lean = new LeanReflex(world, this.sensors, this.warner.manual);
    this.manual = this.warner.manual;
    this.world.drive.manualRef = this.manual;   // ★ IAP 让位判断用（§2.75）
    this.actions = new ActionSystem(world, this.warner, this.sensors);
    this.constraints = new ConstraintLayer();
    this.constraints.add(new JointLimitConstraint());
    this.constraints.add(new HipLateralConstraint());
    this.prediction = new PredictionLayer();
    this.standCommand = new StandCommand(world.body.dofs.length);
    this.lowerCommand = this.standCommand;
    this.squatDownCommand = new SquatDownCommand(world.body.dofs.length);
    this.squatCommand = new SquatCommand(world.body.dofs.length);
  }


  /** 法庭重开：清控制器/执行器跨局残留。 */
  resetCourt(): void {
    this.actions.abort();
    this.actions.idleEnabled = false;
    this.manual.clear();
    this.pad.reset();
    this.footAnkle.reset();
    this.sensors.reset();
    this.warner.reset();
    this.warner.drive.resetRuntime();
    this.lateral.reset();
    this.lean.reset();
    this.constraints.reset();
    this.prediction.reset();
    this.lowerCommand.reset();
    this.squatDownCommand.reset();
    this.kneeGuard.reset();
    this.ankleLpInit = false;
    clearMuscleImpedance(this.world.body);
    (globalThis as { __V3_FOOT0_PASSIVE?: boolean }).__V3_FOOT0_PASSIVE = false;
  }

  /** 命令层直接写某个关节的肌肉阻尼/刚度/软硬/加速度参考。 */
  setMuscleImpedance(name: string, axis: number, cmd: MuscleImpedanceCmd): void {
    setMuscleImpedance(this.world.body, name, axis, cmd);
  }

  getMuscleImpedance(name: string, axis: number): MuscleImpedanceCmd | undefined {
    return getMuscleImpedance(this.world.body, name, axis);
  }

  clearMuscleImpedance(name?: string, axis?: number): void {
    clearMuscleImpedance(this.world.body, name, axis);
  }

  setLowerBodyCommand(cmd: LowerBodyCommand): void {
    this.lowerCommand.reset();
    this.lowerCommand = cmd;
  }

  /** 物理步之后：硬约束投影（PBD 式） */
  project(_dt: number): void {
    this.constraints.project(this.world);
  }

  /** 每物理步（World 在 Drive 之前调用）：收命令 → 整合 → 反射 → 写关节 */
  /** ★ 省力通道状态（2026-10-16 用户："那个省力通道不要了"——通道逻辑已删；字段保留供探针读取，恒 false） */
  channelMode = false;

  /**
   * 踝侧向被动刚度（内/外翻）：foot0 的韧带/骨性止挡。
   *
   * 显式弹簧-阻尼在 240Hz 下会被 foot0 的数值速度噪声打成每帧翻号；
   * 这里对角/速度先低通（20ms），再出被动力矩。刚度/阻尼仍是 K=600/B=60。
   */
  private applyAnkleLateralPassive(dt: number): void {
    const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
    const g = globalThis as { __V3_FOOT0_PASSIVE?: boolean };
    if (String(env.V3_ANKLE_LAT_ON ?? '1') === '0') { this.ankleLpInit = false; g.__V3_FOOT0_PASSIVE = false; return; }
    g.__V3_FOOT0_PASSIVE = true;
    const K = Number(env.V3_ANKLE_LAT_K ?? 600);
    const B = Number(env.V3_ANKLE_LAT_B ?? 60);
    const CAP = Math.abs(Number(env.V3_ANKLE_LAT_CAP ?? 80));
    const tauF = Math.max(1e-4, Number(env.V3_ANKLE_LAT_TAU ?? 0.05));
    const a = 1 - Math.exp(-dt / tauF);
    for (const [k, side] of (['l', 'r'] as const).entries()) {
      const i = this.world.body.dofByName(`foot_${side}`, 0);
      if (i < 0) continue;
      const d = this.world.body.dofs[i]!;
      if (!this.ankleLpInit) {
        this.ankleAngLp[k] = d.angle;
        this.ankleVelLp[k] = d.vel;
      } else {
        this.ankleAngLp[k]! += (d.angle - this.ankleAngLp[k]!) * a;
        this.ankleVelLp[k]! += (d.vel - this.ankleVelLp[k]!) * a;
      }
      let tau = -K * this.ankleAngLp[k]! - B * this.ankleVelLp[k]!;
      tau = Math.max(-CAP, Math.min(CAP, tau));
      if (Math.abs(tau) > 1e-6) this.world.executor.addPassiveTorque(i, tau);
    }
    this.ankleLpInit = true;
  }

  private setAnkleWide(on: boolean): void {
    const wide = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_ANKLE_WIDE ?? 1);
    for (const d of this.world.body.dofs) {
      if (!/^(hip_|knee_|foot_)/.test(d.name)) continue;
      if (on && wide !== 0) {
        const lateral = d.axis === 0 || d.axis === 1;
        const isFoot = /^foot_/.test(d.name);
        const lim = Math.abs(wide) * (d.axis === 2 ? 0.9 : lateral ? (isFoot ? 0.55 : 1.0) : 0.55);
        d.min = Math.min(d.min, -lim);
        d.max = Math.max(d.max, lim);
        const ej = d.engineJoint as unknown as { setLimits?: (a: number, b: number) => void } | null;
        if (d.engineLimited && ej?.setLimits) ej.setLimits(d.rest + d.min, d.rest + d.max);
      } else {
        this.world.applyJointLimits(baseState());
      }
    }
  }

  step(dt: number): void {
    // ★ §2.345（用户：大腿发力不够/hip_r/0对拉 415）：每帧清陈旧 M2（supportColumn 不跑的帧，pelvisDamp 残留上一帧值在髇上与动作伺服对拉）
    this.warner.drive.legReflex.pelvisDamp = 0;
    // ① 感知
    this.sensors.update(dt);
    applyWobblingMass(this.world);
    sampleAccObserver(this.world);
    sampleJointEkf(this.world);
    for (const side of ['l','r'] as const) {
      const setD = (key: string, lin: number, ang: number): void => {
        const bi = this.world.body.indexByKey.get(key);
        if (bi === undefined) return;
        const rb = this.world.body.bodies[bi] as unknown as { setLinearDamping(v:number):void; setAngularDamping(v:number):void };
        rb.setLinearDamping(lin);
        rb.setAngularDamping(ang);
      };
      setD(`thigh_${side}`, 1.5, 2);
      setD(`shin_${side}`, 2, 3);
      setD(`foot_${side}`, 5, 40);
      setD(`arm_${side}`, 1, 1.5);
      setD(`hand_${side}`, 0.8, 1.2);
    }
    for (const key of ['torso','head'] as const) {
      const bi = this.world.body.indexByKey.get(key);
      if (bi === undefined) continue;
      const rb = this.world.body.bodies[bi] as unknown as { setLinearDamping(v:number):void; setAngularDamping(v:number):void };
      rb.setLinearDamping(1.5); rb.setAngularDamping(2);
    }
    {
      const a = this.footAnkle.step(this.world);
      for (const side of ['l', 'r'] as const) {
        for (const ax of [0, 1, 2] as const) {
          const i = this.world.body.dofByName(`foot_${side}`, ax);
          if (i < 0) continue;
          let kp = a.kp[i]!;
          let kd = a.kd[i]!;
          const down = (globalThis as { __SQC_SQUAT_DOWN?: boolean }).__SQC_SQUAT_DOWN === true;
          if (baseState() === 'squat' && !down && ax === 2) {
            const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
            const n = (k: string, d: number): number => { const v = Number(env[k]); return Number.isFinite(v) ? v : d; };
            const pasBase = Math.max(0, n('SQC_ANKLE_PAS_K', 150));
            const pasGain = n('SQC_ANKLE_PAS_GAIN', 0);
            const pasMax = Math.max(0, n('SQC_ANKLE_PAS_MAX', 200));
            const e = a.qRef[i]! - (this.world.body.dofs[i]?.angle ?? 0);
            kp += Math.max(0, Math.min(pasMax, pasBase + pasGain * e));
            kd += Math.max(0, n('SQC_ANKLE_PAS_B', 6));
          }
          propose({ dof: i, kind: 'angle', pri: PRI.direct, rad: a.qRef[i]!, kp, kd, src: 'lowerCommand.ankleComp' });
        }
      }
    }
    const lowerRequested = String(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).V3_LOWER_CMD ?? '1') === '1';
    let actionUsesLower = false;
    if (this.actions.status.active) {
      if (this.actions.status.id === 'squatDown' || this.actions.status.id === 'squatRise') actionUsesLower = true;
      for (const dof of this.actions.poseTargets().keys()) {
        if (/^(hip|knee|foot|ankle)_/.test(this.world.body.dofs[dof]?.name ?? '')) { actionUsesLower = true; break; }
      }
    }
    const upperOnly = this.actions.status.active && !actionUsesLower;
    const lowerExternal = lowerRequested && baseState() === 'stand' && (!this.actions.status.active || upperOnly);
    const squatDownMode = this.actions.status.id === 'squatDown' && this.actions.status.phase === '手下蹲';
    const squatMode = baseState() === 'squat';
    if (squatDownMode && !this.prevSquatDownMode) {
      this.squatDownCommand.reset();
      this.kneeGuard.reset();
      this.setAnkleWide(true);
    } else if (!squatDownMode && this.prevSquatDownMode) {
      this.setAnkleWide(false);
    }
    if (squatMode && !this.prevSquatMode) this.lowerCommand = this.squatCommand;
    else if (!squatMode && this.prevSquatMode) this.lowerCommand = this.standCommand;
    this.prevSquatDownMode = squatDownMode;
    this.prevSquatMode = squatMode;
    const commandActive = lowerExternal || squatDownMode || squatMode;
    (globalThis as { __V3_LOWER_CMD?: boolean }).__V3_LOWER_CMD = commandActive;
    if (commandActive) {
      const cmd = squatDownMode ? this.squatDownCommand : squatMode ? this.squatCommand : this.lowerCommand;
      const out = cmd.step({ world: this.world, sensors: this.sensors, dt, upperOnly, setComTarget: (x, z) => this.warner.setComTarget(x, z), supportClean: (side) => supportClean({ sensors: this.sensors, bal: this.warner, body: this.world.body }, side) });
      if (out.delegate) (globalThis as { __V3_LOWER_CMD?: boolean }).__V3_LOWER_CMD = false;
      else applyLowerBodyPDDirect(this.world, out);
    }
    // ①.05 踝侧向被动刚度：蹲下/蹲姿期间常开（脚抓地后的骨性止挡）
    if (squatDownMode || squatMode) this.applyAnkleLateralPassive(dt);
    else { this.ankleLpInit = false; (globalThis as { __V3_FOOT0_PASSIVE?: boolean }).__V3_FOOT0_PASSIVE = false; }
    // ①.06 膝横向约束：额状面 kneeZ = footZ（v3 虚拟接触层，不写 qRef）
    if (squatDownMode || squatMode) this.kneeGuard.step(this.world, dt);
    // ①.1 只读预测层：CoM/CoP/DCM
    this.prediction.update(this.world, this.sensors, this.perception, dt);
    // 柔性足始终启用：FootPad 是独立抓地层，不随 LowerBodyCommand 开关。
    // ①.2 唯一约束层：关节限位 / 虚拟安全筒
    this.constraints.step(this.world, this.sensors, dt);

    // ② 直控命令（最高优先级：写 Drive 目标 / manual 力矩表）
    this.manual.step(dt);

    // ④ 动作层出提案（动作目标 + 重心轨道）
    //   ★ 2026-10-16 架构：默认 PRI.action(40) < 预测层(60)；手动声明 ACT_OVER_PRED=1 → PRI.actOver(65) 盖预测
    const actPri = String(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).ACT_OVER_PRED ?? '0') === '1' ? PRI.actOver : PRI.action;
    this.actions.step(dt);
    const progSet = new Set<number>();
    if (this.actions.status.active) {
      for (const [dof, t] of this.actions.poseTargets()) {
        if (this.manual.hasAngle(dof)) continue;      // 直控优先
        // ★ §2.452 用户：还有让腿落地的写手！——pair 驱动的轴（肌肉对上岗）姿态表必须让位，
        //   否则旧姿态目标每帧用 postureTone 覆盖 pair 的保持力。
        if (this.warner.drive.pairCTarget[dof]! > 0) continue;
        const d = this.world.body.dofs[dof]!;
        // ★ pin + 有主动 ff = 主动发力接管（用户定调：主动发力不能有屈膝反射/姿势回写）——
        //   程序姿态关键帧（kp=0→postureTone 默认）让位，否则残留 PD 吃掉主动伸展 ff。
        if (this.manual.isPinned(d.name, d.axis) && Math.abs(this.warner.drive.ffOf(dof)) > 1) continue;
        const lim = Math.max(Math.abs(d.min), Math.abs(d.max), 0.3);
        const kp = t.kp > 0 ? t.kp : this.warner.opt.postureTone * 0.5 * d.tauMax / lim;
        // ★ 2026-10-16 提案制：动作层姿态 → 总线（kind='angle'，PRI.action=40）
        propose({ dof, kind: 'angle', pri: actPri, rad: t.rad, kp, src: 'actions.pose' });
        progSet.add(dof);
      }
      const c = this.actions.comTarget();
      if (c.x !== 0 || c.z !== 0) this.warner.setComTarget(c.x, c.z);
      // 动作的附着力矩（直控没表态的轴）
      for (const [dof, tau] of this.actions.torqueTargets()) {
        // ★ 2026-10-16 提案制：动作层力矩 → 总线（kind='torque'，PRI.action=40）
        if (this.manual.torqueOf(dof) === 0 && tau !== 0) propose({ dof, kind: 'torque', pri: actPri, tau, src: 'actions.torque' });
      }
    }

    // ⑤ 摔倒预警提案（含反射用法）——先传动作相位（单支撑语义相位驱动，§2.23）
    this.warner.setActionPhase(this.actions.status.active ? this.actions.status.phase : null);
    const prop = this.warner.propose();
    this.lastProposal = prop;

    // ⑥ 反射执行：按预警提案里的 directives（被动工具箱）
    let sawLean = false, sawPosture = false, sawTrunk = false, sawSupport = false;
    for (const d of prop.reflexDirectives) {
      if (d.id === 'pad') {
        this.pad.enabled = this.padEnabled;   // ★ 激活交给独立层（⑥.5 自主抓地）
      } else if (d.id === 'lean') {
        const p = d.params ?? {};
        // ★ 差动加载力偶（Winter 律=双支撑机制）在单腿动作期间让位（用户定调 2026-10）：
        //   u* 上限 ±0.85×半跨距——单支撑时支撑脚 CoP 必超限 → u* 顶格、载差 u→1.0 天然，
        //   该律满舵 −45 恒定压住支撑外展、还主动把转移往 0.85 封顶拉回（实测拦截转移）。
        if (!lowerExternal) { this.lean.applyLateral(p.copZ ?? this.sensors.com[2]!, dt); sawLean = true; }
      } else if (d.id === 'load') {
        const p = d.params ?? {};
        if (!lowerExternal) this.lean.applySupportBrace((p.side ?? 0) === 0 ? 'l' : 'r', p.tau ?? 0);
      } else if (d.id === 'posture') {
        // ★ 腰椎 · 轴L（侧向/滚转）执行
        const p = d.params ?? {};
        if (!lowerExternal) { this.lean.applyPosture(p.hip ?? 0, p.spine ?? 0, dt); sawPosture = true; }
      } else if (d.id === 'trunk') {
        // ★ 腰椎 · 轴S（矢状/俯仰）执行
        const p = d.params ?? {};
        if (!lowerExternal) { this.lean.applyTrunk(p.tau ?? 0, p.fold ?? 0, (p.side ?? 0) as 0 | 1 | 2, dt); sawTrunk = true; }
      } else if (d.id === 'support') {
        const p = d.params ?? {};
        sawSupport = true;
      }
    }
    // 提案缺席 → 限速归零（不硬切）
    if (!sawLean) this.lean.releaseLateral(dt);
    if (!sawPosture) this.lean.releasePosture(dt);
    if (!sawTrunk) this.lean.releaseTrunk(dt);

    // ⑥.5 落地消力（不需要提案的反射弧：自触发、自计算，§3.12）
    //   ★ 动作抑制：播放中 + 0.5s 尾随期让位（主动蹬地/挺腰的力尖峰不是"落地"）
    // ★ §2.447 上落地消力模块已删（用户：什么玩意啊删了吧）——此处无消力更新

    // ⑥.7 动量调节（§2.16；用户："抬腿的时候手不需要乱动"——默认关：MOM_ARM=1 才启用）
    const useMom = this.actions.status.active
      && this.actions.status.id === 'singleLegR'
      && String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.MOM_ARM ?? '0') === '1';
    if (useMom && String(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).PRED_OFF ?? '0') !== '1') this.momReg.step({ bal: this.warner, body: this.world.body }, dt);   // ★ PRED_OFF 同门控
    else this.momReg.release({ bal: this.warner, body: this.world.body });

    // ⑥.9 躯干链已迁至 trunkClean（supportClean 唯一入口调用；旧 upperBase 已删 2026-10-15）

    // ⑥.5 柔性足独立层（★ 2026-10-16 用户定调："柔性足独立、自主抓地——它的存在目的就是抓地，
    //     不吃动作指令"）。引擎马达通道（arch/mfoot），架构上独立于三层（收不了力矩）。
    //     常态抓地：四向 CoP + 足弓；comTarget 跟随回正力目标。
    if (this.padEnabled) {
      this.pad.enabled = true;
      this.pad.auto = true;
      this.pad.comTargetX = this.warner.getComTarget().x;
      this.pad.comTargetZ = this.warner.getComTarget().z;
      this.pad.autoKp = this.warner.opt.comKp;
      this.pad.autoKd = this.warner.opt.comKd;
      this.pad.step(dt, this.sensors);
    }

    // ⑦ 平衡基建（重力补偿 + 姿势张力；跳过直控/动作接管/踝）
    //   ★ 2026-10-16 用户："对抗重力的力用关节发力，要走审批，别凭空发力"——移到仲裁前：gcomp 走提案总线（PRI.servo）
    this.warner.contributeBaseline(progSet);

    // ⑥.95 提案总线：逐轴仲裁（高优先级胜）→ 统一施加（唯一出口）
    {
      // ★ 蹲姿写手白名单：只允许 squat 提案进入仲裁。
      //   文档 §112；其它层即使还活着也不能再写蹲姿执行器。
      const squatMode = baseState() === 'squat';
      const SQUAT_WRITERS = new Set([
        'squat.upperBase', 'squat.upperRighting', 'squat.spinePair', 'squat.hip0', 'squat.hip1', 'squat.hip1.passive', 'squat.hip2', 'squat.knee2',
        'squat.knee0', 'squat.knee1', 'squat.foot2.cop', 'squat.foot2.base', 'lowerCommand.ankleSupport', 'lowerCommand.ankleComp',
      ]);
      const lowerExternalNow = (globalThis as { __V3_LOWER_CMD?: boolean }).__V3_LOWER_CMD === true;
      const proposals = (squatMode
        ? PROPOSALS.filter((p) => SQUAT_WRITERS.has(p.src))
        : PROPOSALS).filter((p) => !lowerExternalNow || !/^(hip|knee|foot|ankle|spine|neck|shoulder)_/.test(this.world.body.dofs[p.dof]?.name ?? '') || !!p.src?.startsWith('lowerCommand'));
      // ★ 2026-10-16 antiG（抗重力）：**叠加通道，不参与仲裁**——力矩物理叠加
      const antiG = new Map<number, number>();
      for (const p of proposals) {
        if (p.kind === 'antiG') antiG.set(p.dof, (antiG.get(p.dof) ?? 0) + (p.tau ?? 0));
      }
      const best = new Map<string, (typeof PROPOSALS)[number]>();
      for (const p of proposals) {
        if (p.kind === 'antiG') continue;
        const k = `${p.dof}|${p.kind}|${p.channel ?? 'default'}`;
        const cur = best.get(k);
        if (!cur || p.pri >= cur.pri) best.set(k, p);
      }
      const list = [...best.values()].sort((a, b) => a.pri - b.pri);
      {
        const audit: Record<string, string> = {};
        const all: Record<string, string[]> = {};
        for (const p of list) {
          const d = this.world.body.dofs[p.dof];
          if (!d) continue;
          if (/^(hip|knee|foot|ankle)_/.test(d.name)) audit[`${d.name}/${d.axis}`] = `${p.kind}:${p.src ?? '?'}`;
        }
        for (const p of proposals) {
          const d = this.world.body.dofs[p.dof];
          if (!d) continue;
          if (!/^(hip|knee|foot|ankle)_/.test(d.name)) continue;
          const key = `${d.name}/${d.axis}`;
          (all[key] ??= []).push(`${p.kind}:${p.channel ?? 'default'}:${p.src ?? '?'}@${p.pri}`);
        }
        (globalThis as { __SQC_FINAL_WRITER?: Record<string, string> }).__SQC_FINAL_WRITER = audit;
        (globalThis as { __SQC_ALL_WRITERS?: Record<string, string[]> }).__SQC_ALL_WRITERS = all;
      }
      const frameApply = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_FRAME_APPLY ?? '1') === '1';
      const shadowSkip = new Set<typeof list[number]>();
      {
        const shadow = createFrameCommand(this.world.body.dofs);
        const lowerDofs = new Set<number>();
        for (let i = 0; i < this.world.body.dofs.length; i++) {
          const d = this.world.body.dofs[i]!;
          if (/^(hip|knee|foot|ankle)_/.test(d.name)) lowerDofs.add(i);
        }
        for (const p of list) {
          const d = this.world.body.dofs[p.dof];
          if (!d || !lowerDofs.has(p.dof)) continue;
          shadowSkip.add(p);
          if (p.kind === 'angle') patchJoint(shadow, p.dof, { qRef: p.rad ?? d.angle, kp: p.kp ?? 0, kd: p.kd ?? 0, hasAngle: true });
          else if (p.kind === 'ext') {
            const c = shadow.joints[p.dof]!;
            if (p.channel === 'passive') c.passive += p.tau ?? 0;
            else if (p.channel === 'external') { c.external += p.tau ?? 0; c.externalCap = Math.max(c.externalCap, p.cap ?? 0); }
            else c.tau += p.tau ?? 0;
          } else if (p.kind === 'torque') shadow.joints[p.dof]!.driveTau += p.tau ?? 0;
        }
        for (const [dof, tau] of antiG) if (lowerDofs.has(dof) && shadow.joints[dof]!.driveTau === 0) shadow.joints[dof]!.gravityTau += tau;
        (globalThis as { __SQC_FRAME_COMMAND?: unknown }).__SQC_FRAME_COMMAND = shadow;
        if (frameApply) {
          const prebuilt = (globalThis as { __SQC_SQUAT_FRAME?: typeof shadow }).__SQC_SQUAT_FRAME;
          const applyFrame = prebuilt ?? shadow;
          for (const dof of lowerDofs) {
            const c = applyFrame.joints[dof]!;
            const d = this.world.body.dofs[dof]!;
            if (c.hasAngle) this.warner.manual.setAngle(d.name, d.axis, c.qRef, c.kp, c.kd);
            if (Math.abs(c.tau + c.muscleTau) > 1e-9) this.world.executor.addTorque(dof, c.tau + c.muscleTau);
            if (Math.abs(c.passive) > 1e-9) this.world.executor.addPassiveTorque(dof, c.passive);
            if (Math.abs(c.external) > 1e-9) this.world.executor.addExternalTorque(dof, c.external, c.externalCap);
            if (Math.abs(c.driveTau + c.gravityTau) > 1e-9) this.warner.drive.setTorque(dof, c.driveTau + c.gravityTau);
          }
        }
      }
      const tqCovered = new Set<number>();
      // ★ 写手深挖（WR_DBG=1）：手臂每帧所有提案（含被淘汰的）
      if (String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.WR_DBG ?? '0') === '1') {
        const g9 = globalThis as { __wrN?: number };
        if (g9.__wrN === undefined) g9.__wrN = 0;
        g9.__wrN++;
        if (g9.__wrN % 12 === 0 && g9.__wrN < 2000) {
          const srcSet = new Map<string, string>();
          for (const p of proposals) {
            const d = this.world.body.dofs[p.dof];
            if (!d) continue;
            const key = `${p.kind}:${p.src ?? '?'}`;
            if (!srcSet.has(key)) srcSet.set(key, `${key}(例:${d.name}/${d.axis} tau=${(p.tau ?? 0).toFixed(0)})`);
          }
          if (srcSet.size) console.log(`WRALL ${[...srcSet.values()].join(' | ')}`);
        }
      }
      for (const p of list) {
        if (frameApply && shadowSkip.has(p)) continue;
        if (p.kind === 'pair') this.world.executor.commandPair(p.dof, (p.c ?? 0) * Math.max(0, Math.min(1, this.warner.drive.outputScale)), p.rad ?? 0, (p.tau ?? 0) * Math.max(0, Math.min(1, this.warner.drive.outputScale)));
        else if (p.kind === 'angle') {
          const d = this.world.body.dofs[p.dof];
          if (d) this.warner.manual.setAngle(d.name, d.axis, p.rad ?? 0, p.kp, p.kd);
        } else if (p.kind === 'clear') {
          const d = this.world.body.dofs[p.dof];
          if (d) this.warner.manual.clearAngle(d.name, d.axis);
        } else if (p.kind === 'motor') {
          (this.world.body as unknown as { setEngineMotorTarget(di: number, tgt: number, kp: number, kd: number): void })
            .setEngineMotorTarget(p.dof, p.rad ?? 0, p.kp ?? 800, p.kd ?? 60);
        } else if (p.kind === 'ext') {
          // ★ 被动/外力通道单独记账：不占 active cmd，也不受肌肉 τmax 饱和
          if (p.channel === 'passive') this.world.executor.addPassiveTorque(p.dof, p.tau ?? 0);
          else if (p.channel === 'external') this.world.executor.addExternalTorque(p.dof, p.tau ?? 0, p.cap ?? 0);
          else this.world.executor.addTorque(p.dof, p.tau ?? 0);
        } else {
          tqCovered.add(p.dof);
          this.warner.drive.setTorque(p.dof, (p.tau ?? 0) + (antiG.get(p.dof) ?? 0));
        }
      }
      for (const [dof, tau] of antiG) {
        if (frameApply && /^(hip|knee|foot|ankle)_/.test(this.world.body.dofs[dof]?.name ?? '')) continue;
        if (!tqCovered.has(dof) && Math.abs(tau) > 1e-9) this.warner.drive.setTorque(dof, tau);
      }
      PROPOSALS.length = 0;
    }
  }
}
