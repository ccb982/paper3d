/**
 * PostSquatCommand —— 交接后命令层。
 *
 * 交接帧零力：
 *   qRef = 当前角
 *   kp/kd 正常
 *   ff/tauGravity = 0
 *   脚 kp=0，仅低阻尼
 *
 * 之后支撑只通过 hip/knee qRef 小幅、限速伸展，逐步增加。
 */
import type { World } from '../world';
import type { Sensors } from '../sensors';
import { captureShankLeg } from '../servo/shankIK';

const smooth = (u: number): number => u * u * (3 - 2 * u);

export interface PostSquatTargets {
  qRef: Float64Array;
  kp: Float64Array;
  kd: Float64Array;
  ff: Float64Array;
  tauGravity: Float64Array;
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
  private captured = false;
  private t = 0;
  private com0 = { x: 0, y: 0, z: 0 };
  private hipY0: { l: number; r: number } = { l: 0, r: 0 };
  foot: { l: [number, number, number]; r: [number, number, number] } = { l: [0, 0, 0], r: [0, 0, 0] };

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
    this.t = 0;
    this.qRef.fill(0);
    this.kp.fill(0);
    this.kd.fill(0);
    this.ff.fill(0);
    this.tauGravity.fill(0);
    this.foot = { l: [0, 0, 0], r: [0, 0, 0] };
  }

  capture(w: World): void {
    const body = w.body;
    for (let i = 0; i < body.dofs.length; i++) {
      const d = body.dofs[i]!;
      this.q0[i] = d.angle;
      this.qRef[i] = d.angle;
      const isFoot = /^foot_/.test(d.name);
      this.kp[i] = isFoot ? 0 : (0.5 * d.tauMax) / Math.max(0.3, Math.abs(d.min), Math.abs(d.max));
      this.kd[i] = isFoot ? 2 : 0.02 * Math.max(10, d.tauMax);
      this.ff[i] = 0;
      this.tauGravity[i] = 0;
    }
    for (const side of ['l', 'r'] as const) {
      for (const ax of [0, 1, 2] as const) {
        const i = body.dofByName(`foot_${side}`, ax);
        if (i >= 0) this.foot[side][ax] = body.dofs[i]!.angle;
      }
      this.hipY0[side] = captureShankLeg(w, side).hip.y;
    }
    this.captured = true;
  }

  step(w: World, s: Sensors): PostSquatTargets {
    if (!this.captured) this.capture(w);
    if (this.t === 0) this.com0 = { x: s.com[0]!, y: s.com[1]!, z: s.com[2]! };
    this.t += w.dt;
    const ramp = smooth(Math.min(1, this.t / 0.2));
    for (const side of ['l', 'r'] as const) {
      const hipY = captureShankLeg(w, side).hip.y;
      const eH = Math.max(-0.12, Math.min(0.12, this.hipY0[side] - hipY));
      const h2 = w.body.dofByName(`hip_${side}`, 2);
      const k2 = w.body.dofByName(`knee_${side}`, 2);
      if (h2 >= 0) this.qRef[h2] = this.q0[h2]! - 3.0 * eH * ramp;
      if (k2 >= 0) this.qRef[k2] = this.q0[k2]! + 9.0 * eH * ramp;
    }
    return { qRef: this.qRef, kp: this.kp, kd: this.kd, ff: this.ff, tauGravity: this.tauGravity, foot: this.foot, comTarget: this.com0 };
  }
}
