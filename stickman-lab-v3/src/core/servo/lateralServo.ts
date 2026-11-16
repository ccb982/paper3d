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
  private readonly kp = Math.max(0, Number(this.env.SQC_LAT_SERVO_KP ?? 1.0));
  private readonly kd = Math.max(0, Number(this.env.SQC_LAT_SERVO_KD ?? 2.0));
  private readonly deadE = Math.abs(Number(this.env.SQC_LAT_SERVO_DEAD_E ?? 0.003));
  private readonly deadV = Math.abs(Number(this.env.SQC_LAT_SERVO_DEAD_V ?? 0.005));
  private readonly copCap = Math.abs(Number(this.env.SQC_LAT_SERVO_COP_CAP ?? 0.04));
  private readonly copMax = Math.abs(Number(this.env.SQC_LAT_SERVO_COP_MAX ?? 0.12));
  private readonly recGain = Math.max(0, Number(this.env.SQC_LAT_SERVO_REC_GAIN ?? 1.0));
  private readonly momK = Number(this.env.SQC_LAT_SERVO_MOM ?? 0.05);
  private readonly rollMomK = Number(this.env.SQC_LAT_SERVO_ROLL_MOM ?? 0);
  private readonly idleDamp = Math.max(0, Number(this.env.SQC_LAT_SERVO_IDLE_DAMP ?? 0.2));
  private readonly loadShare = Math.max(0, Math.min(1, Number(this.env.SQC_LAT_SERVO_LOAD_SHARE ?? 0)));
  private readonly kLoad = Math.max(0, Number(this.env.SQC_LAT_SERVO_LOAD_K ?? 2000));
  private readonly fzCap = Math.abs(Number(this.env.SQC_LAT_SERVO_FZ_CAP ?? 40));
  private readonly ramp = Math.max(1e-3, Number(this.env.SQC_LAT_SERVO_RAMP ?? 0.04));
  private readonly rec = Math.max(1e-3, Number(this.env.SQC_LAT_SERVO_REC ?? 0.08));
  private readonly gate = String(this.env.SQC_LAT_SERVO_GATE ?? '1') === '1';
  private readonly gateD = Math.abs(Number(this.env.SQC_LAT_SERVO_GATE_DHAT ?? 15));
  private readonly gateOnset = String(this.env.SQC_LAT_SERVO_GATE_ONSET ?? '0') === '1';
  private readonly postK = Number(this.env.SQC_LAT_SERVO_POST_ROLL ?? 0.15);
  private readonly postDead = Math.abs(Number(this.env.SQC_LAT_SERVO_POST_DEAD ?? 0.3)) / 57.3;
  private armed = false;

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
    this.armed = false;
  }

  update(dt: number): void {
    if (!this.enabled) return;
    const L = this.world.lateral.state;
    const e = L.comZ - L.refZ;
    const v = L.comVelZ;
    const inside = (e / Math.max(1e-6, this.deadE)) ** 2 + (v / Math.max(1e-6, this.deadV)) ** 2 < 1;

    // 10% 姿态残差：即使没有外部扰动，也用很小的 CoP 偏置把上身拉回 court。
    const eRoll = L.refRoll - L.roll;
    const postCop = Math.abs(eRoll) > this.postDead
      ? Math.max(-0.006, Math.min(0.006, this.postK * eRoll))
      : 0;
    if (postCop !== 0 && !this.armed) {
      this.copReq += (postCop - this.copReq) * (1 - Math.exp(-dt / 0.15));
      this.active = true;
      this.phase = 'pushBrake';
      this.dir = postCop > 0 ? 1 : -1;
      return;
    }

    // 静态蹲姿：没有外部扰动时 balance 不抢，被动层负责。
    if (this.gate) {
      if ((this.gateOnset && L.onset) || Math.abs(L.dHatHPZ) > this.gateD) this.armed = true;
      if (inside) this.armed = false;
      if (!this.armed) {
        this.phase = 'idle';
        this.active = false;
        const k0 = Math.exp(-dt / this.rec);
        this.fzReq *= k0;
        this.copReq *= k0;
        if (Math.abs(this.fzReq) < 0.5) this.fzReq = 0;
        if (Math.abs(this.copReq) < 1e-5) this.copReq = 0;
        return;
      }
    }

    const comY = Math.max(0.3, this.world.perception.com[1]!);
    const omega = Math.sqrt(9.81 / comY);
    const m = Math.max(1, this.world.sk.massTotal);

    if (inside) {
      // 静止带内：只做动量泄放，不再位置推。
      if (this.idleDamp > 0 && Math.abs(v) > 1e-3) {
        const damp = Math.max(-this.copCap, Math.min(this.copCap, this.idleDamp * (v / omega)));
        const kd2 = 1 - Math.exp(-dt / this.ramp);
        this.copReq += (damp - this.copReq) * kd2;
        this.active = true;
        this.phase = 'pushBrake';
        this.dir = damp > 0 ? 1 : -1;
        this.severity = Math.min(1, Math.abs(damp) / Math.max(1e-6, this.copCap));
        return;
      }
      this.phase = 'idle';
      this.active = false;
      const k = Math.exp(-dt / this.rec);
      this.fzReq *= k;
      this.copReq *= k;
      if (Math.abs(this.fzReq) < 0.5) this.fzReq = 0;
      if (Math.abs(this.copReq) < 1e-5) this.copReq = 0;
      return;
    }

    // 位置/速度 PD + 动量泄放（线性 pZ、角动量 hX）。
    const copMom = this.momK * (L.pZ / (m * omega));
    const copRoll = this.rollMomK * (L.hX / (m * comY * omega));
    const cop = (1 + this.kp) * e + (this.kd / omega) * v + copMom + copRoll;
    const capEff = Math.min(this.copMax, this.copCap * (1 + this.recGain * Math.abs(e) / 0.05));
    const copC = Math.max(-capEff, Math.min(capEff, cop));
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
