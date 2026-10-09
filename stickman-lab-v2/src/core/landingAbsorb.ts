/**
 * landingAbsorb.ts —— 负载消力反射（§3.12）
 *
 * 用户定调：**不需要提案的反射弧**——自己触发、自己计算（函数 + 最小状态）。
 * **不只是高处落地：只要膝部受力较大就弯**——本质是"负载退让 + 回伸"：
 *   每脚连续读该腿法向力 F（脚 Fz 为该腿轴向力的代理）与触地下落速度，
 *   `depthTgt = perV·max(0, −vMin − vDead) + perFz·max(0, F/W − fz0)`
 *   （超过静载阈值 fz0 的部分才弯；力越大弯越深，力退自动回伸）。
 * 落地冲击是它的特例（力的尖峰）；单脚站立 1.0W 静载在其阈值附近不弯
 * （fz0 默认 1.1），刻意下蹲由动作负责（被 `pin` 跳过）。
 *
 * 全程只写**该腿的髋/膝/踝屈伸轴**，depth≈0 时交还关节（clearAngle）。
 * 安全性（§3.12）：轴限定；连续但只对超阈负载出力；出口经整合器；
 * `enabled` 可消融 + 状态可回读。
 *
 * 依据：Geyer & Herr 2010（正力反馈+阻尼）；Blickhan 1989（SLIP 腿弹簧——
 * 压缩量 ∝ 力）；Zhang et al. 2000（人类落地膝主导消能）。
 */

import type { World } from './world';
import type { Sensors } from './sensors';
import type { ManualControl } from './manual';

export interface LandingOptions {
  /** 总开关（消融对照） */
  enabled: boolean;
  /** 负载退让阈值（×体重：单脚静载 ~1.0W，阈值取略高避免正常站立/单脚就弯） */
  fz0: number;
  /** 屈曲量系数：rad per (Fz/W)（超出阈值的部分） */
  perFz: number;
  /** 触地速度项系数：rad per (m/s) */
  perV: number;
  /** 触地速度死区（m/s，滤站立微动） */
  vDead: number;
  /** 触发冲击速度阈值（m/s）——低于它不当作"落地"（防抬腿蹭地误触发） */
  impactV: number;
  /** 腾空时间阈值（s）——触地前必须先真正离地这么久（防拖地/蹭地） */
  airTime: number;
  /** 最大膝屈曲（rad） */
  maxDepth: number;
  /** 屈曲上升速率（rad/s）——冲击要快 */
  riseRate: number;
  /** 回伸时间常数（s） */
  reboundTau: number;
  /** 髋/踝与膝的联动比例 */
  hipShare: number;
  ankleShare: number;
  /** 膝关节角命令刚度（N·m/rad, N·m·s/rad） */
  kneeKp: number;
  kneeKd: number;
}

export const DEFAULT_LANDING_OPTIONS: LandingOptions = {
  enabled: true,
  fz0: 2.0,
  perFz: 0.3,
  perV: 1.2,
  vDead: 0.05,
  impactV: 0.15,
  airTime: 0.08,
  maxDepth: 0.6,
  riseRate: 16,
  reboundTau: 0.18,
  hipShare: 0.35,
  ankleShare: 0.18,
  kneeKp: 300,
  kneeKd: 40,
};

interface FootState {
  active: boolean;   // 是否在窗口内（有屈曲）
  depth: number;     // 当前已下达的膝屈曲（rad，正数 = 屈）
  depthTgt: number;  // 连续目标屈曲
  vMin: number;      // 触地前下降速度的滑窗最小值（泄漏最小值）
  vImp: number;      // 触地边沿一次性捕捉的冲击速度（m/s）
  vImpT: number;     // 冲击偏置衰减计时（s）
  airT: number;      // 已腾空时长（s）
  fzPeak: number;    // 本次负载事件内峰值法向力（N）
  prevLoaded: boolean;
}

export class LandingAbsorb {
  readonly opt: LandingOptions;
  private readonly st: FootState[];
  private readonly legs = [
    { hip: 'hip_l', knee: 'knee_l', foot: 'foot_l' },
    { hip: 'hip_r', knee: 'knee_r', foot: 'foot_r' },
  ];

  constructor(
    private readonly world: World,
    private readonly sensors: Sensors,
    private readonly manual: ManualControl,
    opt: Partial<LandingOptions> = {},
  ) {
    this.opt = { ...DEFAULT_LANDING_OPTIONS, ...opt };
    this.st = [
      { active: false, depth: 0, depthTgt: 0, vMin: 0, vImp: 0, vImpT: 0, airT: 0, fzPeak: 0, prevLoaded: false },
      { active: false, depth: 0, depthTgt: 0, vMin: 0, vImp: 0, vImpT: 0, airT: 0, fzPeak: 0, prevLoaded: false },
    ];
  }

  /** 每拍调用（连续力反馈；depth≈0 时零输出） */
  update(dt: number): void {
    if (!this.opt.enabled) return;
    const W = this.world.body.sk.massTotal * 9.81;
    for (let i = 0; i < 2; i++) {
      const f = this.sensors.feet[i]!;
      const s = this.st[i]!;

      // 触地前下降速度的泄漏最小值（冲击瞬间 vy 被接触力打回 ~0，不能就地取值）
      s.vMin = Math.min(f.vy, s.vMin + dt * 2);      // 以 2 m/s² 泄漏上升

      // ★ 触地边沿：一次性捕捉冲击速度（须先"真腾空"：airT 足够 + 冲击速度超阈）
      if (!s.prevLoaded && f.loaded) {
        const vHit = Math.max(0, -s.vMin - this.opt.vDead);
        s.vImp = s.airT >= this.opt.airTime && vHit >= this.opt.impactV ? vHit : 0;
        s.vImpT = 0;
        s.vMin = 0;
        s.fzPeak = f.fz;
      }
      s.prevLoaded = f.loaded;
      s.airT = f.loaded ? 0 : s.airT + dt;
      s.vImpT += dt;
      const vTerm = this.opt.perV * s.vImp * Math.exp(-s.vImpT / 0.15);

      // ★ 连续目标：**超阈负载（力大弯深，常开）** + 触地冲击偏置（一次性）
      const load = Math.max(0, f.fz / W - this.opt.fz0);
      let tgt = this.opt.perFz * load + vTerm;
      if (tgt > this.opt.maxDepth) tgt = this.opt.maxDepth;
      s.depthTgt = tgt;
      if (tgt > 0.005) s.fzPeak = Math.max(s.fzPeak, f.fz);

      if (tgt > s.depth) {
        // 快速上升（冲击要跟得上）
        s.depth = Math.min(tgt, s.depth + this.opt.riseRate * dt);
        s.active = true;
      } else {
        // 指数回伸（带阻尼、不过冲）
        s.depth *= Math.exp(-dt / Math.max(this.opt.reboundTau, 1e-3));
        if (s.depth < 0.005) s.depth = 0;
      }

      if (s.active) {
        if (s.depth > 0 || s.depthTgt > 0) {
          this.applyLeg(i, s.depth);
        } else {
          s.active = false;
          s.fzPeak = 0;
          this.clearLeg(i);
        }
      }
    }
  }

  /** 该轴是否被主动驱动（pin/手动角/手动力矩）——主动发力时消力让位（用户定调） */
  private isActive(joint: string, axis: number): boolean {
    const di = this.world.body.dofByName(joint, axis);
    if (di < 0) return false;
    return this.manual.isPinned(joint, axis) || this.manual.hasAngle(di) || this.manual.torqueOf(di) !== 0;
  }

  /** 只写落地腿的屈伸轴；被主动驱动的自由度跳过（由主动方负责） */
  private applyLeg(i: number, depth: number): void {
    const leg = this.legs[i]!;
    if (!this.isActive(leg.knee, 2)) {
      this.manual.setAngle(leg.knee, 2, -depth, this.opt.kneeKp, this.opt.kneeKd);
    }
    if (!this.isActive(leg.hip, 2)) {
      this.manual.setAngle(leg.hip, 2, depth * this.opt.hipShare, 350, 40);
    }
    if (!this.isActive(leg.foot, 2)) {
      // ★ 踝要**背屈**（负号）：正号是跖屈，压缩时会把脚趾踩进地面（实测峰值力反升）
      this.manual.setAngle(leg.foot, 2, -depth * this.opt.ankleShare, 200, 25);
    }
  }

  private clearLeg(i: number): void {
    const leg = this.legs[i]!;
    this.manual.clearAngle(leg.knee, 2);
    this.manual.clearAngle(leg.hip, 2);
    this.manual.clearAngle(leg.foot, 2);
  }

  // ── 回读（探针/UI）──
  depthOf(i: number): number {
    return this.st[i]!.depth;
  }
  targetOf(i: number): number {
    return this.st[i]!.depthTgt;
  }
  fzPeakOf(i: number): number {
    return this.st[i]!.fzPeak;
  }
}
