/**
 * footPad.ts —— 垫脚执行器（C1，本阶段重点）
 *
 * 用户定调：平衡/预警最主要的机制是**垫脚**；垫脚做得好，80% 的情况不会倒。
 * 柔性足（arch/mfoot）支持侧向发力 ⇒ 前后左右四向、左右脚都要写。
 *
 * 每只脚一块独立执行器：
 *   输入：该脚 CoP 目标（世界系、相对踝投影的偏移 dx/dz）、该脚 Fz、当前 CoP
 *   输出：① 踝屈伸力矩（前后）② 踝内外翻力矩（左右）
 *         ③ **柔性足旋前/旋后目标**（arch 引擎电机，把 CoP 往内侧搬）
 *
 * 约定（实测标定）：
 *   · 踝屈伸：负力矩 = 跖屈（CoP 前移）⇒ τ = −Fz·dx
 *   · 踝内外翻：τ = +Fz·dz（`_probe-balance-sign` 标定）
 *   · 柔性足旋前 = 正 arch 角 = CoP 往**内侧**搬；内侧方向：左脚 −z、右脚 +z
 *   · 腾空脚（Fz < minFz）只把柔性足目标**缓释回 0**，不发力
 *
 * 本模块只算"提案"（力矩写入 Executor、引擎目标写入 Body），
 * 由控制层调用；单独拿出来也能跑（probe-footpad 验证）。
 */

import type { World } from './world';
import type { Sensors } from './sensors';
import type { ManualControl } from './manual';

export interface FootPadOptions {
  /** CoP 前向（趾侧）可达（m） */
  copFwd: number;
  /** CoP 后向（跟侧）可达（m） */
  copBack: number;
  /** CoP 侧向可达（m） */
  copSide: number;
  /** 柔性足旋前目标增益（rad per m of 侧向 CoP 目标） */
  archGain: number;
  /** 柔性足目标的机动速率（rad/s） */
  archRate: number;
  /** 该脚视为承重的最低 Fz（N） */
  minFz: number;
  /**
   * ★ 主动发力让位（用户定调：垫脚只在非主动发力时使用）。
   * 注意：需等动作在"主动窗口"内自给自足后才能开——当前动作的 pin 是脚本级
   * 全时段钉住，开局就断电=摔（2026-10 实测）。默认 false（垫脚常开）。
   */
  yieldToActive: boolean;
}

export const DEFAULT_FOOT_PAD_OPTIONS: FootPadOptions = {
  copFwd: 0.14,
  copBack: 0.05,
  // ★ 侧向默认限到 2cm（3.5cm 全额会持续满幅翻力矩 → 脚翻滚/Fz 塌陷极限环，
  //   实测初态 3–4Hz 抖动、脚角速 10–13 rad/s；见 _probe-jitter）
  copSide: 0.02,
  archGain: 2.5,
  archRate: 3.0,
  minFz: 40,
  yieldToActive: false,
};

interface FootState {
  side: 'l' | 'r';
  /** 踝屈伸自由度 */
  flex: number;
  /** 踝内外翻自由度（可能不存在） */
  inv: number;
  /** 柔性足 arch 引擎电机自由度 */
  arch: number;
  /** 世界侧向的"内侧"符号：左脚内侧 = −z ⇒ −1；右脚 = +1 */
  medialSign: number;
  /** 命令的 CoP 目标偏移（世界系，m） */
  dx: number;
  dz: number;
  /** 柔性足当前目标（rad，缓释用） */
  archNow: number;
  /** 本步实际生效的 CoP 偏移（供回读） */
  effDx: number;
  effDz: number;
}

export class FootPad {
  readonly opt: FootPadOptions;
  /** 总开关（消融） */
  enabled = true;
  /** 自动模式：由 CoM 目标生成 CoP 目标（模拟"平衡系统"的提案） */
  auto = false;
  private readonly feet: FootState[] = [];

  /**
   * @param manual 直控通道（可选）：用于"主动发力让位"——垫脚只在关节**没有**
   *   主动命令（pin/手动角/手动力矩）时出力（用户定调：垫脚/屈膝只在非主动发力时使用）。
   */
  constructor(
    private readonly world: World,
    opt: Partial<FootPadOptions> = {},
    private readonly manual?: ManualControl,
  ) {
    this.opt = { ...DEFAULT_FOOT_PAD_OPTIONS, ...opt };
    const body = world.body;
    for (const side of ['l', 'r'] as const) {
      const flex = body.dofByName(`foot_${side}`, 2);
      const inv = body.dofByName(`foot_${side}`, 0);
      const arch = body.dofByName(`arch_${side}`, 0);
      if (flex < 0) continue;
      this.feet.push({
        side,
        flex,
        inv,
        arch,
        medialSign: side === 'l' ? -1 : 1,
        dx: 0, dz: 0, archNow: 0, effDx: 0, effDz: 0,
      });
    }
  }

  /** 手动/上层直接指定某只脚的 CoP 偏移目标（世界系，m） */
  setTarget(side: 'l' | 'r', dx: number, dz: number): void {
    const f = this.feet.find((x) => x.side === side);
    if (!f) return;
    f.dx = Math.max(-this.opt.copBack, Math.min(this.opt.copFwd, dx));
    f.dz = Math.max(-this.opt.copSide, Math.min(this.opt.copSide, dz));
  }

  getTarget(side: 'l' | 'r'): { dx: number; dz: number } {
    const f = this.feet.find((x) => x.side === side);
    return f ? { dx: f.dx, dz: f.dz } : { dx: 0, dz: 0 };
  }

  /** 自动模式：由 CoM 目标 + PD 生成每脚 CoP 目标（p = x − (h/g)·a_des） */
  private autoFromCom(s: Sensors, tx: number, tz: number, kp: number, kd: number, gAbs: number): void {
    const comX = s.com[0]!, comY = s.com[1]!, comZ = s.com[2]!;
    const vX = s.comVel[0]!, vZ = s.comVel[2]!;
    let aX = kp * (tx - comX) + kd * -vX;
    let aZ = kp * (tz - comZ) + kd * -vZ;
    // ★ 死区：小于这个加速度的"感觉"不驱动垫脚（滤掉站立抖动）
    if (Math.abs(aX) < 0.12) aX = 0;
    if (Math.abs(aZ) < 0.25) aZ = 0;          // 侧向死区更大（站立抖动主要在侧向）
    for (const f of this.feet) {
      const d = this.world.body.dofs[f.flex]!;
      const h = Math.max(0.3, comY - d.anchorWorld[1]!);
      const pX = comX - (h / gAbs) * aX;
      const pZ = comZ - (h / gAbs) * aZ;
      // ★ 目标速率限制（0.6 m/s）：CoP 目标不许逐拍跳变
      const maxStep = 0.6 * (this.lastDt || 1 / 240);
      let ndx = pX - d.anchorWorld[0]!;
      let ndz = pZ - d.anchorWorld[2]!;
      const ddx = ndx - f.dx;
      const ddz = ndz - f.dz;
      f.dx += Math.max(-maxStep, Math.min(maxStep, ddx));
      f.dz += Math.max(-maxStep, Math.min(maxStep, ddz));
      // 再按可达范围夹
      f.dx = Math.max(-this.opt.copBack, Math.min(this.opt.copFwd, f.dx));
      f.dz = Math.max(-this.opt.copSide, Math.min(this.opt.copSide, f.dz));
    }
  }

  /** 每步调用：把 CoP 目标变成踝力矩 + 柔性足目标（写 Executor / 引擎电机） */
  step(dt: number, s: Sensors): void {
    if (!this.enabled) return;
    this.lastDt = dt;
    const body = this.world.body;
    const gAbs = Math.abs(this.world.world.gravity.y) || 9.81;
    // 自动模式由调用方先设置 com 目标（setComTarget 语义）
    if (this.auto) this.autoFromCom(s, this.comTargetX, this.comTargetZ, this.autoKp, this.autoKd, gAbs);

    for (const f of this.feet) {
      // ★ 主动发力让位（用户定调）：该脚任一踝轴被主动命令（pin/手动角/手动力矩）时，
      //   垫脚不出力（由主动方负责），并把柔性足目标缓释回 0。
      const m = this.manual;
      const active = this.opt.yieldToActive && m !== undefined && (
        m.isPinned(`foot_${f.side}`, 2) || m.isPinned(`foot_${f.side}`, 0) ||
        m.hasAngle(f.flex) || m.hasAngle(f.inv) ||
        m.torqueOf(f.flex) !== 0 || m.torqueOf(f.inv) !== 0
      );
      if (active) {
        f.effDx = 0; f.effDz = 0;
        const maxStep = this.opt.archRate * dt;
        const dd = 0 - f.archNow;
        f.archNow += Math.max(-maxStep, Math.min(maxStep, dd));
        if (f.arch >= 0) body.setEngineMotorTarget(f.arch, f.archNow);
        continue;
      }
      const sense = s.feet[f.side === 'l' ? 0 : 1]!;
      const fz = sense.fz;
      const loaded = fz >= this.opt.minFz;
      if (loaded) {
        // ① 踝屈伸（前后）：τ = −Fz·dx
        const df = body.dofs[f.flex]!;
        let tf = -fz * f.dx;
        const fcap = 0.9 * df.tauMax;
        if (tf > fcap) tf = fcap; else if (tf < -fcap) tf = -fcap;
        if (tf !== 0) this.world.executor.addTorque(f.flex, tf);
        // ② 踝内外翻（左右）：τ = +Fz·dz（打 0.6 折：全额会拧到脚翻滚）
        if (f.inv >= 0) {
          const di = body.dofs[f.inv]!;
          let ti = 0.6 * fz * f.dz;
          const icap = 0.9 * di.tauMax;
          if (ti > icap) ti = icap; else if (ti < -icap) ti = -icap;
          if (ti !== 0) this.world.executor.addTorque(f.inv, ti);
        }
        f.effDx = f.dx;
        f.effDz = f.dz;
      } else {
        f.effDx = 0;
        f.effDz = 0;
      }
      // ③ 柔性足旋前/旋后（引擎电机目标）：把 CoP 往内侧搬
      //    目标角 = archGain ×（侧向目标在"内侧方向"上的分量）
      const want = loaded ? this.opt.archGain * f.dz * f.medialSign : 0;
      const maxStep = this.opt.archRate * dt;
      const d = want - f.archNow;
      f.archNow += Math.max(-maxStep, Math.min(maxStep, d));
      if (f.arch >= 0) body.setEngineMotorTarget(f.arch, f.archNow);
    }
  }

  // ── 自动模式参数（由控制层/探针设置）──
  comTargetX = 0;
  comTargetZ = 0;
  autoKp = 12;
  autoKd = 5;
  private lastDt = 1 / 240;

  /** 本步生效的 CoP 偏移（回读） */
  effective(side: 'l' | 'r'): { dx: number; dz: number } {
    const f = this.feet.find((x) => x.side === side);
    return f ? { dx: f.effDx, dz: f.effDz } : { dx: 0, dz: 0 };
  }
}
