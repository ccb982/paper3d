import type { World } from '../world';

export type LateralPhase = 'idle' | 'watch' | 'pushBrake' | 'pushRecover';

/**
 * 侧向回正伺服（L4 请求生成）
 *
 * 任务级 PD → CoP：
 *   a_des = -ω²·kp·e - 2ζω·v
 *   cop   = ref + (1+kp)·e + (2ζ/ω)·v
 *
 * 输出拆成两路（同一个 cop 预算，避免叠加两遍）：
 *   fzReq  = kLoad·cop·loadShare   → knee/2 + hip/2 差动，翻左右腿载荷
 *   copReq = cop·(1-loadShare)      → 踝 CoP 目标
 *
 * onset 当帧立即 active + preload；不再等 changeScore/motion gate。
 * braking / reversed / overshoot 只做收力，不取消回正。
 */
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
  private readonly kp = Math.max(0, Number(this.env.SQC_LAT_SERVO_KP ?? 0.5));
  private readonly kd = Math.max(0, Number(this.env.SQC_LAT_SERVO_KD ?? 2.0));
  private readonly preload = Math.max(0, Number(this.env.SQC_LAT_SERVO_PRELOAD ?? 0.02));
  private readonly preloadTau = Math.max(1e-3, Number(this.env.SQC_LAT_SERVO_PRELOAD_TAU ?? 0.12));
  private readonly kLoad = Math.max(0, Number(this.env.SQC_LAT_SERVO_LOAD_K ?? 2000));
  private readonly loadShare = Math.max(0, Math.min(1, Number(this.env.SQC_LAT_SERVO_LOAD_SHARE ?? 0.3)));
  private readonly fzCap = Math.abs(Number(this.env.SQC_LAT_SERVO_FZ_CAP ?? 90));
  private readonly copCap = Math.abs(Number(this.env.SQC_LAT_SERVO_COP_CAP ?? 0.06));
  private readonly over = Math.abs(Number(this.env.SQC_LAT_SERVO_OVER ?? 0.004));
  private readonly rec = Math.max(1e-3, Number(this.env.SQC_LAT_SERVO_REC ?? 0.08));
  private readonly mode = String(this.env.SQC_LAT_SERVO_MODE ?? 'relay');
  private readonly relayAmp = Math.abs(Number(this.env.SQC_LAT_SERVO_RELAY ?? 0.03));
  private readonly relayDead = Math.abs(Number(this.env.SQC_LAT_SERVO_RELAY_DEAD ?? 0.002));
  private readonly relayHold = Math.max(0, Number(this.env.SQC_LAT_SERVO_RELAY_HOLD ?? 0.10));
  private readonly always = String(this.env.SQC_LAT_SERVO_ALWAYS ?? '0') === '1';
  private relayOn = false;
  private relayHoldT = 0;

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
    this.prevOnset = false;
    this.tPhase = 0;
    this.relayOn = false;
    this.relayHoldT = 0;
  }

  update(dt: number): void {
    if (!this.enabled) return;
    const L = this.world.lateral.state;
    const rising = L.onset && !this.prevOnset;
    this.prevOnset = L.onset;

    if (rising && L.source !== 'none' && L.source !== 'self' && L.direction !== 0) {
      this.phase = 'pushBrake';
      this.dir = L.direction;
      this.tPhase = 0;
      this.active = true;
      this.fzReq = this.dir * this.kLoad * this.preload * this.loadShare;
      this.copReq = this.dir * this.preload * (1 - this.loadShare);
    }

    if (this.phase === 'idle' && this.always) {
      const omega = Math.sqrt(9.81 / Math.max(0.3, this.world.perception.com[1]!));
      const cp = (L.comZ - L.refZ) + (this.kd / omega) * L.comVelZ;
      if (Math.abs(cp) > this.relayDead) {
        this.phase = 'pushBrake';
        this.dir = Math.sign(cp) || 1;
        this.tPhase = 0;
        this.active = true;
        this.fzReq = this.dir * this.kLoad * this.preload * this.loadShare;
        this.copReq = this.dir * this.preload * (1 - this.loadShare);
      }
    }

    if (this.phase !== 'pushBrake') {
      if (this.phase === 'idle') {
        this.fzReq *= Math.exp(-dt / this.rec);
        this.copReq *= Math.exp(-dt / this.rec);
        if (Math.abs(this.fzReq) < 0.5 && Math.abs(this.copReq) < 1e-4) {
          this.fzReq = 0;
          this.copReq = 0;
          this.active = false;
        }
      }
      return;
    }

    this.tPhase += dt;
    const comY = Math.max(0.3, this.world.perception.com[1]!);
    const omega = Math.sqrt(9.81 / comY);
    const e = L.comZ - L.refZ;
    const v = L.comVelZ;
    const preload = this.dir * this.preload * Math.exp(-this.tPhase / this.preloadTau);
    let cop: number;
    if (this.mode === 'relay') {
      // 间歇 bang-bang capture-point：CP 超阈值才打一拍，避免连续 CoP 把矢状链拖垮。
      const cp = e + (this.kd / omega) * v;
      if (!this.relayOn && Math.abs(cp) > this.relayDead) {
        this.relayOn = true;
        this.relayHoldT = this.relayHold;
      }
      if (this.relayOn) {
        cop = Math.sign(cp || this.dir) * this.relayAmp;
        this.relayHoldT -= dt;
        if (this.relayHoldT <= 0 && Math.abs(cp) < this.relayDead * 2) this.relayOn = false;
      } else {
        cop = 0;
      }
      if (cop === 0) cop = preload;
    } else {
      cop = (1 + this.kp) * e + (this.kd / omega) * v + preload;
    }

    // 过冲收力：目标幅值随过冲衰减；braking/reversed 不改符号（否则会取消回正）。
    if (L.overshoot > this.over) cop *= Math.max(0.35, 1 - (L.overshoot - this.over) / 0.05);
    cop = Math.max(-this.copCap, Math.min(this.copCap, cop));

    this.severity = Math.min(1, Math.abs(cop) / Math.max(1e-6, this.copCap));
    const fz = Math.max(-this.fzCap, Math.min(this.fzCap, this.kLoad * cop * this.loadShare));
    const copAnkle = cop * (1 - this.loadShare);
    const k = 1 - Math.exp(-dt / Math.max(1e-3, Number(this.env.SQC_LAT_SERVO_RAMP ?? 0.02)));
    this.fzReq += (fz - this.fzReq) * k;
    this.copReq += (copAnkle - this.copReq) * k;

    if (String(this.env.SQC_LAT_SERVO_DBG ?? '0') === '1'
      && Math.floor(this.world.clock / 0.05) !== Math.floor((this.world.clock - dt) / 0.05)) {
      console.log(`LATSERVO t=${this.world.clock.toFixed(2)} e=${(e * 1000).toFixed(1)} v=${(v * 1000).toFixed(0)} cop=${(cop * 1000).toFixed(1)} fzReq=${this.fzReq.toFixed(0)} load=${L.loadDiff.toFixed(0)} copZ=${(L.copZ * 1000).toFixed(1)} br=${L.braking ? 1 : 0} rev=${L.reversed ? 1 : 0} src=${L.source}`);
    }

    // 回正完成后释放；不靠 changeScore 退出。
    if (this.tPhase > 0.2 && Math.abs(e) < 0.001 && Math.abs(v) < 0.005
      && Math.abs(this.fzReq) < 1 && Math.abs(this.copReq) < 1e-4) {
      this.phase = 'idle';
      this.active = false;
    }
  }
}
