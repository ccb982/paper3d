export type SupportPhase = 'SELECT' | 'SHIFT' | 'HOLD' | 'RETURN';

export interface SupportInput {
  fzL: number;
  fzR: number;
  comZ: number;
  feetMidZ: number;
  roll?: number;
  rollRef?: number;
  dt: number;
}

export interface SupportConfig {
  diff: number;
  shift: number;
  shiftT: number;
  holdT: number;
  returnT: number;
  hysteresis: number;
  lean: number;
}

export interface SupportOutput {
  phase: SupportPhase;
  supportSide: 'l' | 'r';
  targetDiff: number;
  comTargetZ: number;
  upperLean: number;
  baseScale: number;
}

export const DEFAULT_SUPPORT: SupportConfig = {
  diff: 0,
  shift: 0,
  shiftT: 0.2,
  holdT: 0.5,
  returnT: 0.2,
  hysteresis: 15,
  lean: 0,
};

export class SupportController {
  private phase: SupportPhase = 'SELECT';
  private side: 'l' | 'r' = 'l';
  private t = 0;

  reset(): void {
    this.phase = 'SELECT';
    this.side = 'l';
    this.t = 0;
  }

  step(i: SupportInput, c: SupportConfig = DEFAULT_SUPPORT): SupportOutput {
    this.t += i.dt;
    const diff = i.fzL - i.fzR;
    const loadedSide: 'l' | 'r' = diff > 0 ? 'l' : 'r';
    const rollErr = i.roll !== undefined && i.rollRef !== undefined ? i.roll - i.rollRef : 0;
    if (this.phase === 'SELECT') {
      if (Math.abs(rollErr) > c.hysteresis) {
        this.side = rollErr > 0 ? 'l' : 'r';
        this.phase = 'SHIFT';
        this.t = 0;
      } else if (Math.abs(diff) > c.hysteresis) {
        this.side = loadedSide;
        this.phase = 'SHIFT';
        this.t = 0;
      }
    } else if (this.phase === 'SHIFT' && this.t >= c.shiftT) {
      this.phase = 'HOLD';
      this.t = 0;
    } else if (this.phase === 'HOLD' && this.t >= c.holdT) {
      this.phase = 'RETURN';
      this.t = 0;
    } else if (this.phase === 'RETURN' && this.t >= c.returnT) {
      this.phase = 'SELECT';
      this.t = 0;
    }
    const dir = this.side === 'l' ? 1 : -1;
    const active = this.phase === 'SHIFT' || this.phase === 'HOLD';
    const targetDiff = active ? dir * c.diff : 0;
    const comTargetZ = i.feetMidZ + (active ? dir * c.shift : 0);
    return {
      phase: this.phase,
      supportSide: this.side,
      targetDiff,
      comTargetZ,
      upperLean: active ? dir * c.lean : 0,
      baseScale: active ? 1 : 0,
    };
  }
}
