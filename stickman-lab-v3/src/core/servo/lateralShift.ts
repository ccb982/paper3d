export type LateralPhase = 'LEFT' | 'CENTER_L' | 'RIGHT' | 'CENTER_R';

export interface LateralShiftInput {
  fzL: number;
  fzR: number;
  copZ: number;
  feetMidZ: number;
  dt: number;
}

export interface LateralShiftOutput {
  phase: LateralPhase;
  targetDiff: number;
  copTargetZ: number;
  foot0: number;
}

export interface LateralShiftConfig {
  diff: number;
  copOffset: number;
  hold: number;
  center: number;
  kLoad: number;
  kCop: number;
  cap: number;
}

export const DEFAULT_LATERAL_SHIFT: LateralShiftConfig = {
  diff: 10,
  copOffset: 0.01,
  hold: 0.2,
  center: 0.2,
  kLoad: 0.5,
  kCop: 200,
  cap: 20,
};

export class LateralShift {
  private phase: LateralPhase = 'LEFT';
  private t = 0;

  reset(): void {
    this.phase = 'LEFT';
    this.t = 0;
  }

  step(i: LateralShiftInput, c: LateralShiftConfig = DEFAULT_LATERAL_SHIFT): LateralShiftOutput {
    this.t += i.dt;
    const advance = (next: LateralPhase): void => {
      this.phase = next;
      this.t = 0;
    };
    if (this.phase === 'LEFT' && this.t >= c.hold) advance('CENTER_L');
    else if (this.phase === 'CENTER_L' && this.t >= c.center) advance('RIGHT');
    else if (this.phase === 'RIGHT' && this.t >= c.hold) advance('CENTER_R');
    else if (this.phase === 'CENTER_R' && this.t >= c.center) advance('LEFT');

    const targetDiff = this.phase === 'LEFT' ? c.diff : this.phase === 'RIGHT' ? -c.diff : 0;
    const dir = this.phase === 'LEFT' ? 1 : this.phase === 'RIGHT' ? -1 : 0;
    const copTargetZ = i.feetMidZ + dir * c.copOffset;
    const eLoad = targetDiff - (i.fzL - i.fzR);
    const eCop = copTargetZ - i.copZ;
    const foot0 = Math.max(-c.cap, Math.min(c.cap, c.kLoad * eLoad + c.kCop * eCop));
    return { phase: this.phase, targetDiff, copTargetZ, foot0 };
  }
}
