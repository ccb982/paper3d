/** 下盘两个 task PD：ShankTaskPD + PelvisTaskPD。 */

export interface ShankTaskInput {
  tilt: number;          // shank 相对 footUp
  rate: number;
  fz: number;
  copZ: number;
  ankleZ: number;
  copMin: number;
  copMax: number;
}

export interface ShankTaskOutput {
  task: number;
  copTarget: number;
  kneeTau: number;
  footTau: number;
}

export interface ShankTaskOpts {
  kp?: number;
  kd?: number;
  wKnee?: number;
  wCop?: number;
  kneeCap?: number;
  footCap?: number;
  kCop?: number;
}

export class ShankTaskPD {
  constructor(private readonly opt: ShankTaskOpts = {}) {}
  step(s: ShankTaskInput): ShankTaskOutput {
    const kp = this.opt.kp ?? 30;
    const kd = this.opt.kd ?? 3;
    const wK = this.opt.wKnee ?? 0.6;
    const wC = this.opt.wCop ?? 1.0;
    const kCap = this.opt.kneeCap ?? 40;
    const fCap = this.opt.footCap ?? 20;
    const kCop = this.opt.kCop ?? 50;
    const task = kp * s.tilt - kd * s.rate;
    const kneeTau = Math.max(-kCap, Math.min(kCap, wK * task));
    const copTarget = Math.max(s.copMin, Math.min(s.copMax,
      Math.max(s.ankleZ - 0.05, Math.min(s.ankleZ + 0.05, s.ankleZ + wC * kCop * s.tilt))));
    const footTau = s.fz > 1 ? Math.max(-fCap, Math.min(fCap, s.fz * (copTarget - s.copZ))) : 0;
    return { task, copTarget, kneeTau, footTau };
  }
}

export interface PelvisTaskInput {
  dy: number;       // hipY_L - hipY_R
  rate: number;
}
export interface PelvisTaskOutput { task: number; tauL: number; tauR: number; }
export interface PelvisTaskOpts { kp?: number; kd?: number; cap?: number; }

export class PelvisTaskPD {
  constructor(private readonly opt: PelvisTaskOpts = {}) {}
  step(s: PelvisTaskInput): PelvisTaskOutput {
    const kp = this.opt.kp ?? 1000;
    const kd = this.opt.kd ?? 0;
    const cap = this.opt.cap ?? 120;
    const task = kp * s.dy - kd * s.rate;
    return {
      task,
      tauL: Math.max(-cap, Math.min(cap, task)),
      tauR: Math.max(-cap, Math.min(cap, -task)),
    };
  }
}
