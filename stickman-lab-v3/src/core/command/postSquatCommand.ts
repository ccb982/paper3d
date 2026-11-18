/**
 * PostSquatCommand —— 交接后的命令层。
 *
 * 只负责生成：
 *   qRef / foot 目标 / contact 目标
 * 不写 PD、不写 executor。
 */
import type { World } from '../world';
import type { Sensors } from '../sensors';
import { computeSquatSupport } from './squatSupport';

export interface PostSquatTargets {
  qRef: Float64Array;
  kp: Float64Array;
  kd: Float64Array;
  ff: Float64Array;
  tauGravity: Float64Array;
  /** 交接后 foot0/1/2 的目标；先保持捕获角，后续由 contact 层更新。 */
  foot: { l: [number, number, number]; r: [number, number, number] };
  comTarget: { x: number; y: number; z: number };
}

export class PostSquatCommand {
  private readonly qRef: Float64Array;
  private readonly kp: Float64Array;
  private readonly kd: Float64Array;
  private readonly ff: Float64Array;
  private readonly tauGravity: Float64Array;
  private readonly q0: Float64Array;
  private gBuf: Float64Array | null = null;
  private sBuf: Float64Array | null = null;
  private captured = false;
  private com0 = { x: 0, y: 0, z: 0 };
  private comCaptured = false;
  private foot: { l: [number, number, number]; r: [number, number, number] } = {
    l: [0, 0, 0],
    r: [0, 0, 0],
  };

  constructor(n: number) {
    this.qRef = new Float64Array(n);
    this.kp = new Float64Array(n);
    this.kd = new Float64Array(n);
    this.ff = new Float64Array(n);
    this.tauGravity = new Float64Array(n);
    this.q0 = new Float64Array(n);
  }

  reset(): void {
    this.captured = false;
    this.qRef.fill(0);
    this.kp.fill(0);
    this.kd.fill(0);
    this.ff.fill(0);
    this.tauGravity.fill(0);
    this.foot = { l: [0, 0, 0], r: [0, 0, 0] };
    this.comCaptured = false;
  }

  capture(w: World): void {
    const body = w.body;
    for (let i = 0; i < body.dofs.length; i++) {
      this.q0[i] = body.dofs[i]!.angle;
      this.qRef[i] = this.q0[i]!;
      const isFoot = /^foot_/.test(body.dofs[i]!.name);
      this.kp[i] = isFoot ? 0 : (0.5 * body.dofs[i]!.tauMax) / Math.max(0.3, Math.abs(body.dofs[i]!.min), Math.abs(body.dofs[i]!.max));
      this.kd[i] = isFoot ? 30 : 0.02 * Math.max(10, body.dofs[i]!.tauMax);
      this.ff[i] = 0;
      this.tauGravity[i] = 0;
    }
    if (!this.gBuf || this.gBuf.length !== body.dofs.length) { this.gBuf = new Float64Array(body.dofs.length); this.sBuf = new Float64Array(body.dofs.length); }
    computeSquatSupport(body, this.gBuf, this.sBuf!, this.tauGravity);
    for (const s of ['l', 'r'] as const) {
      for (const ax of [0, 1, 2] as const) {
        const i = body.dofByName(`foot_${s}`, ax);
        if (i >= 0) this.foot[s][ax] = body.dofs[i]!.angle;
      }
    }
    this.captured = true;
  }

  step(w: World, s: Sensors): PostSquatTargets {
    if (!this.captured) this.capture(w);
    if (!this.comCaptured) { this.com0 = { x: s.com[0]!, y: s.com[1]!, z: s.com[2]! }; this.comCaptured = true; }
    return { qRef: this.qRef, kp: this.kp, kd: this.kd, ff: this.ff, tauGravity: this.tauGravity, foot: this.foot, comTarget: this.com0 };
  }
}
