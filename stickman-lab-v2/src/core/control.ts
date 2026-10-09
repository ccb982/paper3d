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
import { FallGuard } from './fallGuard';
import { ActionSystem } from './actionSystem';
import { LeanReflex } from './leanReflex';
import { LandingAbsorb } from './landingAbsorb';
import type { ManualControl } from './manual';

export interface ControlOptions {
  comKp: number;
  comKd: number;
  maxForceFrac: number;
  postureTone: number;
}

export const DEFAULT_CONTROL_OPTIONS: ControlOptions = {
  comKp: 12,
  comKd: 5,
  maxForceFrac: 0.35,
  postureTone: 8,
};

export class ControlModule {
  readonly sensors: Sensors;
  /** 产出方：摔倒预警（平衡算法在它里面） */
  readonly warner: StabilityWarner;
  /** 反射执行器：垫脚（四向 CoP + 柔性足） */
  readonly pad: FootPad;
  /** 反射执行器：侧向重心转移（髋策略，按预警的 lean directive 执行） */
  readonly lean: LeanReflex;
  /** ★ 反射弧：落地消力（不需要提案；自触发自计算；§3.12） */
  readonly landing: LandingAbsorb;
  /** 保护程序：跌倒急救 + 全权接管 + 任务恢复 */
  readonly guard: FallGuard;
  /** 直控入口（最高优先级） */
  readonly manual: ManualControl;
  /** 动作层（独立系统：出动作提案，经本模块整合；伺服层同时默默工作） */
  readonly actions: ActionSystem;
  padEnabled = true;
  /** 最近一拍的整合输入（回读：预警提案） */
  lastProposal: StabilityProposal | null = null;
  private readonly opt: ControlOptions;

  constructor(private readonly world: World, opt: Partial<ControlOptions> = {}) {
    const o = { ...DEFAULT_CONTROL_OPTIONS, ...opt };
    this.opt = o;
    this.sensors = new Sensors(world);
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
    this.lean = new LeanReflex(world, this.sensors, this.warner.manual);
    this.landing = new LandingAbsorb(world, this.sensors, this.warner.manual);
    this.guard = new FallGuard(world, this.sensors, this.warner);
    this.manual = this.warner.manual;
    this.actions = new ActionSystem(world, this.warner, this.sensors);
  }

  /** 每物理步（World 在 Drive 之前调用）：收命令 → 整合 → 反射 → 写关节 */
  step(dt: number): void {
    // ① 感知
    this.sensors.update(dt);

    // ② 直控命令（最高优先级：写 Drive 目标 / manual 力矩表）
    this.manual.step(dt);

    // ③ 保护程序全权（已接管：其余产出方让位，只跑保护 + 基建）
    if (this.guard.authority) {
      this.guard.step(dt);
      this.warner.contributeBaseline();
      return;
    }

    // ④ 动作层出提案（动作目标 + 重心轨道）
    this.actions.step(dt);
    const progSet = new Set<number>();
    if (this.actions.status.active) {
      for (const [dof, t] of this.actions.poseTargets()) {
        if (this.manual.hasAngle(dof)) continue;      // 直控优先
        const d = this.world.body.dofs[dof]!;
        const lim = Math.max(Math.abs(d.min), Math.abs(d.max), 0.3);
        const kp = t.kp > 0 ? t.kp : this.warner.opt.postureTone * 0.5 * d.tauMax / lim;
        this.warner.drive.setAngle(dof, t.rad, kp);
        progSet.add(dof);
      }
      const c = this.actions.comTarget();
      if (c.x !== 0 || c.z !== 0) this.warner.setComTarget(c.x, c.z);
      // 动作的附着力矩（直控没表态的轴）
      for (const [dof, tau] of this.actions.torqueTargets()) {
        if (this.manual.torqueOf(dof) === 0 && tau !== 0) this.world.executor.addTorque(dof, tau);
      }
    }

    // ⑤ 摔倒预警提案（含反射用法）
    const prop = this.warner.propose();
    this.lastProposal = prop;

    // ⑥ 反射执行：按预警提案里的 directives（被动工具箱）
    let sawLean = false, sawPosture = false, sawTrunk = false, sawSupport = false;
    for (const d of prop.reflexDirectives) {
      if (d.id === 'pad') {
        if (this.padEnabled) {
          this.pad.enabled = true;
          this.pad.auto = true;
          this.pad.comTargetX = this.warner.getComTarget().x;
          this.pad.comTargetZ = this.warner.getComTarget().z;
          this.pad.autoKp = this.warner.opt.comKp;
          this.pad.autoKd = this.warner.opt.comKd;
          this.pad.step(dt, this.sensors);
        } else {
          this.pad.enabled = false;
        }
      } else if (d.id === 'lean') {
        const p = d.params ?? {};
        this.lean.applyLateral(p.copZ ?? this.sensors.com[2]!, dt);
        sawLean = true;
      } else if (d.id === 'load') {
        const p = d.params ?? {};
        this.lean.applyLoadBrace((p.side ?? 0) === 0 ? 'l' : 'r', p.tau ?? 0);
      } else if (d.id === 'posture') {
        // ★ 腰椎 · 轴L（侧向/滚转）执行
        const p = d.params ?? {};
        this.lean.applyPosture(p.hip ?? 0, p.spine ?? 0, dt);
        sawPosture = true;
      } else if (d.id === 'trunk') {
        // ★ 腰椎 · 轴S（矢状/俯仰）执行
        const p = d.params ?? {};
        this.lean.applyTrunk(p.tau ?? 0, p.fold ?? 0, (p.side ?? 0) as 0 | 1 | 2, dt);
        sawTrunk = true;
      } else if (d.id === 'support') {
        const p = d.params ?? {};
        this.landing.setPreBrace((p.side ?? 0) === 0 ? 'l' : 'r', p.depth ?? 0.08);
        sawSupport = true;
      }
    }
    // 提案缺席 → 限速归零（不硬切）
    if (!sawLean) this.lean.releaseLateral(dt);
    if (!sawPosture) this.lean.releasePosture(dt);
    if (!sawTrunk) this.lean.releaseTrunk(dt);
    if (!sawSupport) this.landing.setPreBrace(null, 0);

    // ⑥.5 落地消力（不需要提案的反射弧：自触发、自计算，§3.12）
    //   ★ 动作抑制：播放中 + 0.5s 尾随期让位（主动蹬地/挺腰的力尖峰不是"落地"）
    this.landing.setInhibit(this.actions.status.active, dt);
    this.landing.update(dt);

    // ⑦ 平衡基建（重力补偿 + 姿势张力；跳过直控/动作接管/踝）
    this.warner.contributeBaseline(progSet);
  }
}
