import type { World } from '../world';

export type LateralPhase = 'idle' | 'watch' | 'pushBrake' | 'pushRecover';

/**
 * 侧向回正伺服（论文版：相平面间歇临界阻尼 PD）
 *
 *  - 相平面椭圆死区内：输出 0，主动控制 off；
 *  - 出死区：cop = (1+kp)·e + (kd/ω)·v，临界/过阻尼；
 *  - 无 relay、无输出硬死区、无积分；
 *  - 近中心 e=0,v=0 → tau=0 → a=0。
 *
 * fzReq 是可选载移（默认 0）；copReq 给 squatAnkleVector 当 CoP 偏移。
 */
export class LateralServo {
  phase: LateralPhase = 'idle';
  dir = 0;
  severity = 0;
  fzReq = 0;
  copReq = 0;
  active = false;
  enabled = true;

  private readonly env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  private readonly kp = Math.max(0, Number(this.env.SQC_LAT_SERVO_KP ?? 0.5));
  private readonly kd = Math.max(0, Number(this.env.SQC_LAT_SERVO_KD ?? 1.4));
  private readonly deadE = Math.abs(Number(this.env.SQC_LAT_SERVO_DEAD_E ?? 0.001));
  private readonly deadV = Math.abs(Number(this.env.SQC_LAT_SERVO_DEAD_V ?? 0.002));
  private readonly copCap = Math.abs(Number(this.env.SQC_LAT_SERVO_COP_CAP ?? 0.04));
  private readonly loadShare = Math.max(0, Math.min(1, Number(this.env.SQC_LAT_SERVO_LOAD_SHARE ?? 0)));
  private readonly kLoad = Math.max(0, Number(this.env.SQC_LAT_SERVO_LOAD_K ?? 2000));
  private readonly fzCap = Math.abs(Number(this.env.SQC_LAT_SERVO_FZ_CAP ?? 40));
  private readonly ramp = Math.max(1e-3, Number(this.env.SQC_LAT_SERVO_RAMP ?? 0.04));
  private readonly rec = Math.max(1e-3, Number(this.env.SQC_LAT_SERVO_REC ?? 0.08));

  constructor(private readonly world: World) {
    this.enabled = String(this.env.SQC_LAT_SERVO ?? '1') === '1';
  }

  reset(): void {
    this.phase = 'idle';
    this.dir = 0;
    this.severity = 0;
    this.fzReq = 0;
    this.copReq = 0;
    this.active = false;
  }

  update(dt: number): void {
    if (!this.enabled) return;
    const L = this.world.lateral.state;
    const e = L.comZ - L.refZ;
    const v = L.comVelZ;
    const inside = (e / Math.max(1e-6, this.deadE)) ** 2 + (v / Math.max(1e-6, this.deadV)) ** 2 < 1;

    if (inside) {
      this.phase = 'idle';
      this.active = false;
      const k = Math.exp(-dt / this.rec);
      this.fzReq *= k;
      this.copReq *= k;
      if (Math.abs(this.fzReq) < 0.5) this.fzReq = 0;
      if (Math.abs(this.copReq) < 1e-5) this.copReq = 0;
      return;
    }

    const comY = Math.max(0.3, this.world.perception.com[1]!);
    const omega = Math.sqrt(9.81 / comY);
    const cop = (1 + this.kp) * e + (this.kd / omega) * v;
    const copC = Math.max(-this.copCap, Math.min(this.copCap, cop));
    const fz = Math.max(-this.fzCap, Math.min(this.fzCap, this.kLoad * copC * this.loadShare));
    const k = 1 - Math.exp(-dt / this.ramp);
    this.fzReq += (fz - this.fzReq) * k;
    this.copReq += (copC - this.copReq) * k;
    this.phase = 'pushBrake';
    this.active = true;
    this.dir = copC > 0 ? 1 : copC < 0 ? -1 : 0;
    this.severity = Math.min(1, Math.abs(copC) / Math.max(1e-6, this.copCap));

    if (String(this.env.SQC_LAT_SERVO_DBG ?? '0') === '1'
      && Math.floor(this.world.clock / 0.05) !== Math.floor((this.world.clock - dt) / 0.05)) {
      console.log(`LATSERVO t=${this.world.clock.toFixed(2)} e=${(e * 1000).toFixed(2)} v=${(v * 1000).toFixed(1)} cop=${(copC * 1000).toFixed(2)} fzReq=${this.fzReq.toFixed(1)}`);
    }
  }
}
