/**
 * reflex.ts —— 通用恢复反射（分级 + 放弃）
 *
 * 用户定调：通用反射，快摔倒时按情况调用；救不过来就算了。平地垫脚解决 80%。
 *
 * 分级（**单模式、不并行**，升级锁存、恢复后降级）：
 *   0 pad    垫脚：CoP 需求在足底可达内（FootPad 四向）
 *   1 hip    髋策略：垫脚饱和（需求超过可达 ×(1+overshoot) 持续 holdTime）
 *   2 (step) 保护性迈步：后置占位（当前直接跳到 giveup）
 *   3 giveup 放弃：XcoM 超出支撑边缘 > giveUpMargin —— 卸力任其倒地，不挣扎
 *
 * 依据：Micheau 2003（踝策略 λ 模型）；Bayón 2020（动量法预测人类恢复策略）；
 *      Cheng 2015（统一恢复策略）；Pratt 2006 / Maki & McIlroy 1997（迈步）。
 */

import type { World } from './world';
import { FootPad, type FootPadOptions } from './footPad';
import type { Sensors } from './sensors';

export type RecoveryMode = 'pad' | 'hip' | 'giveup';

export interface ReflexOptions {
  /** 髋策略开关（**默认关**：方向/幅度未标定前，实测它会帮倒忙） */
  hipEnabled: boolean;
  /** 髋策略触发：需求 > 可达 ×(1+overshoot) 持续 holdTime 秒 */
  hipOvershoot: number;
  hipHoldTime: number;
  /** 放弃：XcoM 超出支撑边缘超过该值（m） */
  giveUpMargin: number;
  /** 恢复判定：条件消除后持续 recoverTime 秒才降级 */
  recoverTime: number;
  /** 最小驻留（s）：同一模式至少待这么久才允许切换（防抖） */
  minDwell: number;
  /** 髋策略 PD 增益（力矩 = clamp(kp·comErr + kd·comVel)） */
  hipKp: number;
  hipKd: number;
  /** 髋策略单轴力矩上限（N·m） */
  hipTauMax: number;
  /** FootPad 参数覆盖 */
  pad?: Partial<FootPadOptions>;
}

export const DEFAULT_REFLEX_OPTIONS: ReflexOptions = {
  hipEnabled: false,
  hipOvershoot: 0.25,
  hipHoldTime: 0.10,
  giveUpMargin: 0.16,
  recoverTime: 0.30,
  minDwell: 0.35,
  hipKp: 220,
  hipKd: 35,
  hipTauMax: 120,
};

export class RecoveryReflexes {
  readonly opt: ReflexOptions;
  readonly pad: FootPad;
  mode: RecoveryMode = 'pad';
  /** 触发/切换记录（回读） */
  reason = '初始化';
  /** 进入 giveup（跌落已不可避免）的回调——用于接上保护动作（step/fallProtect） */
  onGiveUp: (() => void) | null = null;
  /** CoM 目标（由调用方设置；手动命令在此模拟"平衡系统"） */
  comTargetX = 0;
  comTargetZ = 0;
  autoKp = 12;
  autoKd = 5;
  private enabled = true;
  private hipTimer = 0;
  private recoverTimer = 0;
  private timeInMode = 0;

  constructor(private readonly world: World, private readonly sensors: Sensors, opt: Partial<ReflexOptions> = {}) {
    this.opt = { ...DEFAULT_REFLEX_OPTIONS, ...opt };
    this.pad = new FootPad(world, this.opt.pad);
  }

  enable(): void { this.enabled = true; }
  disable(): void { this.enabled = false; }

  reset(): void {
    this.mode = 'pad';
    this.reason = '重置';
    this.pad.enabled = true;
    this.hipTimer = 0;
    this.recoverTimer = 0;
  }

  /** 每物理步（在 beginStep 之后、applyAll 之前调用） */
  step(dt: number): void {
    if (!this.enabled) return;
    const s = this.sensors;
    const body = this.world.body;
    const gAbs = Math.abs(this.world.world.gravity.y) || 9.81;

    // 倒立摆频率与 XcoM
    // 用左右踝平均高度作为支点高度
    const flexL = body.dofByName('foot_l', 2);
    const h = Math.max(0.3, s.com[1]! - (flexL >= 0 ? body.dofs[flexL]!.anchorWorld[1]! : 0));
    const omega = Math.sqrt(gAbs / h);
    const xcomX = s.com[0]! + s.comVel[0]! / omega;
    const xcomZ = s.com[2]! + s.comVel[2]! / omega;

    // 需求加速度（把 CoM 拉回目标所需）——用于判断垫脚是否饱和
    const aX = this.autoKp * (this.comTargetX - s.com[0]!) + this.autoKd * -s.comVel[0]!;
    const aZ = this.autoKp * (this.comTargetZ - s.com[2]!) + this.autoKd * -s.comVel[2]!;
    const maxAx = (gAbs / h) * this.pad.opt.copFwd;   // 前向可达加速度
    const maxAz = (gAbs / h) * this.pad.opt.copSide;
    const saturated = Math.abs(aX) > maxAx * (1 + this.opt.hipOvershoot)
      || Math.abs(aZ) > maxAz * (1 + this.opt.hipOvershoot);

    // 支撑边缘（用两脚中心 ± 前后可达）
    const feetX: number[] = [];
    const feetZ: number[] = [];
    for (const f of [0, 1]) {
      const fd = s.feet[f]!;
      if (fd.loaded) { feetX.push(fd.x); feetZ.push(fd.z); }
    }
    const supMinX = (feetX.length ? Math.min(...feetX) : 0) - this.pad.opt.copBack;
    const supMaxX = (feetX.length ? Math.max(...feetX) : 0) + this.pad.opt.copFwd;
    const supMinZ = (feetZ.length ? Math.min(...feetZ) : 0) - this.pad.opt.copSide;
    const supMaxZ = (feetZ.length ? Math.max(...feetZ) : 0) + this.pad.opt.copSide;
    const outX = xcomX < supMinX ? supMinX - xcomX : xcomX > supMaxX ? xcomX - supMaxX : 0;
    const outZ = xcomZ < supMinZ ? supMinZ - xcomZ : xcomZ > supMaxZ ? xcomZ - supMaxZ : 0;
    const beyond = Math.max(outX, outZ);

    // ── 分级选择（升级锁存 + 最小驻留防抖）──
    this.timeInMode += dt;
    if (this.mode === 'pad') {
      if (beyond > this.opt.giveUpMargin) {
        this.mode = 'giveup';
        this.reason = `XcoM 出界 ${(beyond * 100).toFixed(1)}cm > 可救界`;
        this.timeInMode = 0;
        this.onGiveUp?.();
      } else if (saturated) {
        this.hipTimer += dt;
        if (this.opt.hipEnabled && this.hipTimer >= this.opt.hipHoldTime) {
          this.mode = 'hip';
          this.reason = `垫脚饱和持续 ${this.opt.hipHoldTime}s`;
          this.timeInMode = 0;
        }
      } else {
        this.hipTimer = 0;
      }
    } else {
      // ★ 已在 hip/giveup：出界仍可继续升级到放弃（不再只在 pad 检查）
      if (this.mode === 'hip' && beyond > this.opt.giveUpMargin) {
        this.mode = 'giveup';
        this.reason = `髋策略未能回收，XcoM 出界 ${(beyond * 100).toFixed(1)}cm`;
        this.timeInMode = 0;
      } else {
        // 恢复条件（锁存 + 最小驻留）
        const recovered = beyond <= 0 && !saturated;
        if (recovered) {
          this.recoverTimer += dt;
          if (this.recoverTimer >= this.opt.recoverTime && this.timeInMode >= this.opt.minDwell) {
            this.mode = 'pad';
            this.reason = '恢复 → 降回垫脚';
            this.recoverTimer = 0;
            this.timeInMode = 0;
          }
        } else {
          this.recoverTimer = 0;
        }
      }
    }

    // ── 执行（单模式）──
    if (this.mode === 'pad') {
      this.pad.enabled = true;
      this.pad.auto = true;
      this.pad.comTargetX = this.comTargetX;
      this.pad.comTargetZ = this.comTargetZ;
      this.pad.autoKp = this.autoKp;
      this.pad.autoKd = this.autoKd;
      this.pad.step(dt, s);
      return;
    }
    this.pad.enabled = false;

    if (this.mode === 'hip') {
      // 髋策略：用髋屈伸力偶把骨盆往回推（力矩 = kp·comErr + kd·comVel，方向实测定）
      const tau = Math.max(-this.opt.hipTauMax, Math.min(this.opt.hipTauMax,
        this.opt.hipKp * (s.com[0]! - this.comTargetX) + this.opt.hipKd * s.comVel[0]!));
      for (const side of ['l', 'r'] as const) {
        const di = body.dofByName(`hip_${side}`, 2);
        if (di >= 0 && tau !== 0) this.world.executor.addTorque(di, tau);
      }
    }
    // giveup：什么都不写（任其倒地，不挣扎）
  }
}
