/**
 * 落点寻找器（端点控制；Winter 1992 端点上靶 + 实测灵敏度标定）
 * —— 迈步原语 C/D 相里"抬起的腿"的**全权接管者**（除 B/D 强制命令）。
 *
 * 职责：世界空间 P 控制，把脚(前后 x / 高度 y / 左右 z)驱向目标落点；
 * 只写抬腿侧的 髋屈/膝/踝/外摆 四个目标（经 ManualControl=提案的退化通道，
 * 由控制层统一整合下发——永不直写 Executor）。
 */
import type { ManualControl } from '../manual';

export interface SeekState { l2: number; k: number; f: number; ab: number }
export interface FootPos { x: number; y: number; z: number }

/** 实测灵敏度（m/rad）：`_probe-ab-sign` / `_diag-sl-landing` 标定 */
export const SEEK_SENS = { ab: 0.22, knee: 0.35, hip: 0.40 } as const;
/** 脚传感器的"贴地基线"（sole 参考点高于地面 0.07m） */
export const FOOT_BASE_Y = 0.07;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function app(cur: number, tgt: number, rate: number, dt: number): number {
  const d = tgt - cur;
  const stp = rate * dt;
  return Math.abs(d) <= stp ? tgt : cur + Math.sign(d) * stp;
}

export class LandingSeek {
  readonly state: SeekState = { l2: 0, k: 0, f: 0, ab: 0 };
  constructor(
    private readonly manual: ManualControl,
    private readonly hip: string,
    private readonly knee: string,
    private readonly foot: string,
  ) {}

  /** 从实际关节角起步（相位进入时用，避免第一拍猛拉） */
  resetFrom(a: SeekState): void {
    this.state.l2 = a.l2; this.state.k = a.k; this.state.f = a.f; this.state.ab = a.ab;
  }

  /** 世界空间 P：目标点 (tx,tz)、悬停高度 hover（米，脚底离地） */
  seek(dt: number, tx: number, tz: number, hover: number, f: FootPos): void {
    const s = this.state;
    const ex = tx - f.x, ez = tz - f.z, ey = hover - (f.y - FOOT_BASE_Y);
    s.ab = app(s.ab, clamp(s.ab + ez / SEEK_SENS.ab, -0.35, 0.10), 1.5, dt);
    s.k = app(s.k, clamp(s.k - ey / SEEK_SENS.knee, -1.30, 0.0), 2.2, dt);
    s.l2 = app(s.l2, clamp(s.l2 + ex / SEEK_SENS.hip, -0.15, 0.85), 2.2, dt);
    s.f = app(s.f, 0.05, 2.0, dt);
    this.manual.setAngle(this.hip, 2, s.l2);
    this.manual.setAngle(this.knee, 2, s.k);
    this.manual.setAngle(this.foot, 2, s.f);
    this.manual.setAngle(this.hip, 0, s.ab, 80, 16);
  }
}
