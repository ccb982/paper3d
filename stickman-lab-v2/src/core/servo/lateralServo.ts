import type { World } from '../world';

export type LateralPhase = 'idle' | 'watch' | 'pushBrake' | 'pushRecover';

export class LateralServo {
  phase: LateralPhase = 'idle';
  dir = 0;
  severity = 0;
  fzReq = 0;
  copReq = 0;
  active = false;
  enabled = true;

  private prevOnset = false;
  private tPhase = 0;
  private readonly env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  private readonly kf = Number(this.env.SQC_LAT_SERVO_KF ?? 80);
  private readonly kc = Number(this.env.SQC_LAT_SERVO_KC ?? 0.03);
  private readonly ramp = Math.max(1e-3, Number(this.env.SQC_LAT_SERVO_RAMP ?? 0.06));
  private readonly rec = Math.max(1e-3, Number(this.env.SQC_LAT_SERVO_REC ?? 0.08));
  private readonly over = Math.abs(Number(this.env.SQC_LAT_SERVO_OVER ?? 0.005));
  private readonly fzCap = Math.abs(Number(this.env.SQC_LAT_SERVO_FZ_CAP ?? 120));
  private readonly copCap = Math.abs(Number(this.env.SQC_LAT_SERVO_COP_CAP ?? 0.05));
  private readonly needScore = Number(this.env.SQC_LAT_SERVO_NEED_SCORE ?? 8);
  private readonly needVel = Number(this.env.SQC_LAT_SERVO_NEED_VEL ?? 0.08);
  private readonly needTtb = Number(this.env.SQC_LAT_SERVO_NEED_TTB ?? 0.15);
  private readonly watchTime = Number(this.env.SQC_LAT_SERVO_WATCH ?? 0.25);

  constructor(private readonly world: World) {
    this.enabled = String(this.env.SQC_LAT_SERVO ?? '0') === '1';
  }

  reset(): void {
    this.phase = 'idle';
    this.dir = 0;
    this.severity = 0;
    this.fzReq = 0;
    this.copReq = 0;
    this.active = false;
    this.prevOnset = false;
    this.tPhase = 0;
  }

  update(dt: number): void {
    if (!this.enabled) return;
    const L = this.world.lateral.state;
    const rising = L.onset && !this.prevOnset;
    this.prevOnset = L.onset;

    if (rising && L.source === 'push' && L.direction !== 0) {
      this.phase = 'watch';
      this.dir = L.direction;
      this.severity = Math.max(0, Math.min(1, (L.changeScore - 1) / 3));
      this.fzReq = 0;
      this.copReq = 0;
      this.tPhase = 0;
      this.active = false;
    }

    if (this.phase === 'watch') {
      this.severity = Math.max(0, Math.min(1, (L.changeScore - 1) / 3));
      const need = L.motionSpeed > this.needVel;
      if (need) {
        this.phase = 'pushBrake';
        this.active = true;
        this.tPhase = 0;
      } else if (this.tPhase > this.watchTime && L.motionSpeed < 0.01) {
        this.phase = 'idle';
        this.active = false;
      }
      this.tPhase += dt;
      return;
    }

    if (this.phase === 'idle') {
      this.fzReq *= Math.exp(-dt / this.rec);
      this.copReq *= Math.exp(-dt / this.rec);
      if (Math.abs(this.fzReq) < 0.5 && Math.abs(this.copReq) < 1e-4) {
        this.fzReq = 0; this.copReq = 0; this.active = false;
      }
      return;
    }

    this.tPhase += dt;

    if (this.phase === 'pushBrake') {
      if (L.reversed || L.overshoot > this.over) {
        this.phase = 'pushRecover';
        this.tPhase = 0;
      } else {
        const boost = L.braking ? 1.15 : 1.0;
        const targetFz = this.dir * Math.min(this.fzCap, this.kf * this.severity * boost);
        const targetCop = this.dir * Math.min(this.copCap, this.kc * this.severity * boost);
        const k = 1 - Math.exp(-dt / this.ramp);
        this.fzReq += (targetFz - this.fzReq) * k;
        this.copReq += (targetCop - this.copReq) * k;
      }
    }

    if (this.phase === 'pushRecover') {
      const k = Math.exp(-dt / this.rec);
      this.fzReq *= k;
      this.copReq *= k;
      if (Math.abs(this.fzReq) < 0.5 && Math.abs(this.copReq) < 1e-4 && Math.abs(L.comVelZ) < 0.005) {
        this.phase = 'idle';
        this.active = false;
      }
    }
  }
}
