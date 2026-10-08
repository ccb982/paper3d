/**
 * manual.ts —— 手动控制系统（平衡控制器的外接命令源）
 *
 * 定位：它不是探针，是正式模块。外部（脚本 / UI / 遥操作）通过它给**任意关节**
 * 下三种命令，由平衡控制器按物理步执行：
 *   · `setAngle(关节, 轴, rad)`  —— 平衡点/阻抗目标（关节角）
 *   · `setTorque(关节, 轴, τ)`   —— 直接力矩偏置（与重力补偿叠加）
 *   · `play(关键帧序列)`         —— 姿态序列（鞠躬 / 抬腿等 action 库在 actions.ts）
 *
 * 关节寻址统一用 `关节名/轴`（如 `hip_l/2`、`spine1/2`、`knee_r/2`），轴约定：
 *   0 = 外展/侧摆、1 = 扭转、2 = 屈伸（与 skeleton.ts 一致）。
 *
 * 关键帧插值为 smoothstep；`play` 期间序列覆盖 live 命令；结束后默认保持末帧。
 */

import type { Body } from './body';
import type { Drive } from './drive';

/** 一帧：时刻 t（秒）+ 角度目标表 + 力矩表（都可选） */
export interface Keyframe {
  t: number;
  /** `关节名/轴` → 目标角（rad，相对静姿态） */
  pose?: Record<string, number>;
  /** `关节名/轴` → 附加力矩（N·m） */
  torque?: Record<string, number>;
}

export interface PlayOptions {
  /** 循环播放（默认 false） */
  loop?: boolean;
  /** 结束后保持末帧（默认 true）；false = 回到播放前状态 */
  holdEnd?: boolean;
}

export class ManualControl {
  /**
   * 手动角度目标的**默认刚度系数**（× Drive 默认刚度）。
   * 由平衡控制器设为 `postureTone` —— 否则手动目标比姿势张力软一个数量级，
   * 弯腰时目标关节会被身体自重压着跑（实测：鞠躬目标 11° 跑成 96°）。
   */
  defaultStiffnessFrac = 0.5;
  private readonly angle: Float64Array;
  private readonly kp: Float64Array;
  private readonly kd: Float64Array;
  private readonly torque: Float64Array;
  /** ★ 钉住标记：动作层声明"这个自由度归我"，反射执行方跳过（仲裁用） */
  private readonly pinnedU8: Uint8Array;
  private seq: Keyframe[] = [];
  private seqTime = 0;
  private playing = false;
  private loop = false;
  private holdEnd = true;

  constructor(
    private readonly body: Body,
    private readonly drive: Drive,
  ) {
    const n = body.dofs.length;
    this.angle = new Float64Array(n).fill(Number.NaN);
    this.kp = new Float64Array(n);
    this.kd = new Float64Array(n);
    this.torque = new Float64Array(n);
    this.pinnedU8 = new Uint8Array(n);
  }

  /** ★ 钉住/解钉：动作层对"必须归我管"的自由度打标，反射执行方跳过（不抢） */
  pin(joint: string, axis: number, on = true): void {
    const i = this.body.dofByName(joint, axis);
    if (i >= 0) this.pinnedU8[i] = on ? 1 : 0;
  }

  isPinned(joint: string, axis: number): boolean {
    const i = this.body.dofByName(joint, axis);
    return i >= 0 && this.pinnedU8[i] === 1;
  }

  // ──────────────────────────────── 实时命令
  /** 关节角目标；kp/kd 省略时用 Drive 的默认（τmax/量程 + 半临界阻尼） */
  setAngle(joint: string, axis: number, rad: number, kp?: number, kd?: number): void {
    const i = this.body.dofByName(joint, axis);
    if (i < 0) return;
    this.angle[i] = rad;
    this.kp[i] = kp ?? 0;
    this.kd[i] = kd ?? 0;
  }

  /** 附加力矩（N·m）；与重力补偿/CoM 控制叠加 */
  setTorque(joint: string, axis: number, tau: number): void {
    const i = this.body.dofByName(joint, axis);
    if (i >= 0) this.torque[i] = tau;
  }

  clear(): void {
    this.angle.fill(Number.NaN);
    this.kp.fill(0);
    this.kd.fill(0);
    this.torque.fill(0);
  }

  torqueOf(dofIdx: number): number {
    return this.torque[dofIdx]!;
  }

  /** 该自由度当前是否有角度目标（平衡控制器的姿势张力只补"没人管"的关节） */
  hasAngle(dofIdx: number): boolean {
    return !Number.isNaN(this.angle[dofIdx]!);
  }

  // ──────────────────────────────── 序列
  /** 播放关键帧序列（t 为绝对秒，插值 smoothstep） */
  play(frames: Keyframe[], opts: PlayOptions = {}): void {
    this.seq = [...frames].sort((a, b) => a.t - b.t);
    this.seqTime = 0;
    this.playing = true;
    this.loop = opts.loop ?? false;
    this.holdEnd = opts.holdEnd ?? true;
  }

  stop(): void {
    this.playing = false;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get time(): number {
    return this.seqTime;
  }

  /** 序列总时长（秒） */
  get duration(): number {
    return this.seq.length ? this.seq[this.seq.length - 1]!.t : 0;
  }

  // ──────────────────────────────── 每步执行
  step(dt: number): void {
    if (this.playing) {
      this.seqTime += dt;
      const t = this.loop && this.duration > 0 ? this.seqTime % this.duration : this.seqTime;
      this.evalAt(t);
      if (this.seqTime >= this.duration && !this.loop) {
        this.playing = false;
        if (!this.holdEnd) this.clear();
      }
    }
    // 角度目标写进 Drive 的阻抗通道（NaN = 不写）
    for (let i = 0; i < this.angle.length; i++) {
      const a = this.angle[i]!;
      if (Number.isNaN(a)) continue;
      let kp = this.kp[i]!;
      if (!(kp > 0)) {
        const d = this.body.dofs[i]!;
        const lim = Math.max(Math.abs(d.min), Math.abs(d.max), 0.3);
        kp = this.defaultStiffnessFrac * 0.5 * d.tauMax / lim;
      }
      this.drive.setAngle(i, a, kp, this.kd[i]! > 0 ? this.kd[i]! : undefined);
    }
  }

  private evalAt(t: number): void {
    const frames = this.seq;
    if (frames.length === 0) return;
    if (t <= frames[0]!.t) { this.applyFrame(frames[0]!); return; }
    const last = frames[frames.length - 1]!;
    if (t >= last.t) { this.applyFrame(last); return; }
    let k = 0;
    while (k < frames.length - 1 && frames[k + 1]!.t < t) k++;
    const a = frames[k]!, b = frames[k + 1]!;
    const u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
    const s = u * u * (3 - 2 * u);          // smoothstep
    this.angle.fill(Number.NaN);
    this.kp.fill(0);
    this.kd.fill(0);
    this.torque.fill(0);
    const keys = new Set([...Object.keys(a.pose ?? {}), ...Object.keys(b.pose ?? {})]);
    for (const key of keys) {
      const [name, axStr] = key.split('/');
      const axis = Number(axStr);
      const i = this.body.dofByName(name!, axis);
      if (i < 0) continue;
      const va = a.pose?.[key] ?? 0;
      const vb = b.pose?.[key] ?? 0;
      this.angle[i] = va + (vb - va) * s;
    }
    const tkeys = new Set([...Object.keys(a.torque ?? {}), ...Object.keys(b.torque ?? {})]);
    for (const key of tkeys) {
      const [name, axStr] = key.split('/');
      const axis = Number(axStr);
      const i = this.body.dofByName(name!, axis);
      if (i < 0) continue;
      const va = a.torque?.[key] ?? 0;
      const vb = b.torque?.[key] ?? 0;
      this.torque[i] = va + (vb - va) * s;
    }
  }

  private applyFrame(f: Keyframe): void {
    this.angle.fill(Number.NaN);
    this.kp.fill(0);
    this.kd.fill(0);
    this.torque.fill(0);
    for (const [key, v] of Object.entries(f.pose ?? {})) {
      const [name, axStr] = key.split('/');
      const i = this.body.dofByName(name!, Number(axStr));
      if (i >= 0) this.angle[i] = v;
    }
    for (const [key, v] of Object.entries(f.torque ?? {})) {
      const [name, axStr] = key.split('/');
      const i = this.body.dofByName(name!, Number(axStr));
      if (i >= 0) this.torque[i] = v;
    }
  }
}
