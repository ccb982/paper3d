export type PushPhase = 'PUSH' | 'HOLD' | 'RETURN' | 'DONE';

export interface LateralPushInput {
  fzL: number;
  fzR: number;
  roll: number;
  rollRef: number;
  dt: number;
}

export interface LateralPushConfig {
  pushN: number;
  lean: number;
  pushT: number;
  holdT: number;
  returnT: number;
}

export interface LateralPushOutput {
  phase: PushPhase;
  swingSide: 'l' | 'r';
  supportSide: 'l' | 'r';
  pushFoot0: number;
  upperLean: number;
  supportScale: number;
}

export const DEFAULT_LATERAL_PUSH: LateralPushConfig = {
  pushN: 0,
  lean: 0,
  pushT: 0.4,
  holdT: 0.5,
  returnT: 0.2,
};

export class LateralPush {
  private phase: PushPhase = 'DONE';
  private support: 'l' | 'r' = 'r';
  private side: 'l' | 'r' = 'l';
  private t = 0;

  reset(): void {
    this.phase = 'DONE';
    this.support = 'r';
    this.side = 'l';
    this.t = 0;
  }

  start(fzL: number, fzR: number): void {
    this.support = fzL >= fzR ? 'l' : 'r';
    this.side = this.support === 'l' ? 'r' : 'l';
    this.phase = 'PUSH';
    this.t = 0;
  }

  step(i: LateralPushInput, c: LateralPushConfig = DEFAULT_LATERAL_PUSH): LateralPushOutput {
    this.t += i.dt;
    if (this.phase === 'DONE') {
      const rollErr = i.roll - i.rollRef;
      if (Math.abs(rollErr) > 0.01) {
        this.support = i.fzL >= i.fzR ? 'l' : 'r';
        this.side = this.support === 'l' ? 'r' : 'l';
        this.phase = 'PUSH';
        this.t = 0;
      }
    } else if (this.phase === 'PUSH' && this.t >= c.pushT) {
      this.phase = 'HOLD';
      this.t = 0;
    } else if (this.phase === 'HOLD' && this.t >= c.holdT) {
      this.phase = 'RETURN';
      this.t = 0;
    } else if (this.phase === 'RETURN' && this.t >= c.returnT) {
      this.phase = 'DONE';
      this.t = 0;
    }

    const supportSide: 'l' | 'r' = this.support;
    const dir = this.side === 'l' ? -1 : 1;
    const supportDir = this.support === 'l' ? -1 : 1;
    const active = this.phase === 'PUSH' || this.phase === 'HOLD';
    const pulse = this.phase === 'PUSH' ? Math.sin(Math.PI * Math.min(1, this.t / Math.max(1e-6, c.pushT))) : 0;
    return {
      phase: this.phase,
      swingSide: this.side,
      supportSide,
      pushFoot0: dir * c.pushN * pulse,
      upperLean: active ? supportDir * c.lean : 0,
      supportScale: active ? 1 : 0,
    };
  }
}
