import type { LowerBodyCommand, LowerBodyContext, LowerBodyOutput } from './lowerBody';
// pose helper is used by the command layer; support remains separate.
import { samplePPath } from '../actions';
import { computeSquatSupport } from './squatSupport';


const smooth = (u: number): number => u * u * (3 - 2 * u);
const env = (): Record<string, string | undefined> =>
  ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {});
const num = (key: string, def: number): number => {
  const v = Number(env()[key]);
  return Number.isFinite(v) ? v : def;
};

export class SquatDownCommand implements LowerBodyCommand {
  readonly id = 'squatDown' as const;
  private readonly qRef: Float64Array;
  private readonly tauGravity: Float64Array;
  private readonly ff: Float64Array;
  private readonly kp: Float64Array;
  private readonly kd: Float64Array;
  private t = 0;
  private output: LowerBodyOutput | null = null;
  private gBuf: Float64Array | null = null;
  private sBuf: Float64Array | null = null;
  private fzLp = 350;
  private fzRp = 350;
  private footMidZ = 0;
  private latLocked = false;
  private readonly q0: Float64Array;
  private q0Valid = false;
  private latRef: { hipL:number; hipR:number; kneeL:number; kneeR:number; footL:number; footR:number; zL:number; zR:number } | null = null;

  constructor(n: number) {
    this.qRef = new Float64Array(n);
    this.tauGravity = new Float64Array(n);
    this.ff = new Float64Array(n);
    this.kp = new Float64Array(n);
    this.kd = new Float64Array(n);
    this.q0 = new Float64Array(n);
  }

  reset(): void {
    this.t = 0;
    this.qRef.fill(0);
    this.tauGravity.fill(0);
    this.ff.fill(0);
    this.kp.fill(0);
    this.kd.fill(0);
    this.fzLp = 350;
    this.fzRp = 350;
    this.footMidZ = 0;
    this.latLocked = false;
    this.latRef = null;
    this.q0.fill(0);
    this.q0Valid = false;
    this.output = null;
  }

  step(ctx: LowerBodyContext): LowerBodyOutput {
    const body = ctx.world.body;
    const fzL = body.footNormalForce('l', ctx.dt);
    const fzR = body.footNormalForce('r', ctx.dt);
    const both = fzL > 5 && fzR > 5;
    if (both) this.t += ctx.dt;
    const descentT = Math.max(0.1, num('SQD_T', 5.0));
    const p = smooth(Math.min(1, this.t / descentT));
    const k = samplePPath(p);
    const n = body.dofs.length;
    if (!this.q0Valid) {
      for (let i = 0; i < n; i++) this.q0[i] = body.dofs[i]!.angle;
      this.q0Valid = true;
    }

    for (let i = 0; i < n; i++) {
      const d = body.dofs[i]!;
      const lim = Math.max(Math.abs(d.min), Math.abs(d.max), 0.3);
      this.qRef[i] = d.angle;
      this.tauGravity[i] = 0;
      this.ff[i] = 0;
      this.kp[i] = (0.5 * d.tauMax) / lim;
      this.kd[i] = 0.02 * Math.max(10, d.tauMax);
    }

    const setAng = (name: string, axis: number, v: number, kp: number, kd: number): void => {
      const i = body.dofByName(name, axis);
      if (i < 0) return;
      this.qRef[i] = v;
      this.kp[i] = kp;
      this.kd[i] = kd;
    };
    const setTorque = (name: string, axis: number, v: number): void => {
      const i = body.dofByName(name, axis);
      if (i >= 0) this.ff[i] = this.ff[i]! + v;
    };

    const ankEnv = Math.min(1, p / 0.25) * Math.min(1, (1 - p) / 0.2);
    const comErr = k.comX - ctx.sensors.com[0]!;
    const ankleTgt = Math.max(-0.05, Math.min(num('ANK_MAX', 0.45), num('ANK_ACT', 0.25) * ankEnv + num('ANK_K', 6) * comErr));
    const hipCorr = Math.max(-num('HIP_COM_MAX', 0.15), Math.min(num('HIP_COM_MAX', 0.15), -num('HIP_COM_K', 0) * comErr));
    const kneeCorr = Math.max(-num('KNEE_COM_MAX', 0.15), Math.min(num('KNEE_COM_MAX', 0.15), -num('KNEE_COM_K', 0) * comErr));

    for (const sd of ['l', 'r'] as const) {
      setAng(`hip_${sd}`, 2, k.hip + hipCorr, 300, 0.02 * Math.max(10, body.dofByName(`hip_${sd}`, 2) >= 0 ? body.dofs[body.dofByName(`hip_${sd}`, 2)]!.tauMax : 220));
      setAng(`knee_${sd}`, 2, k.knee + kneeCorr, 550, 0.02 * Math.max(10, body.dofByName(`knee_${sd}`, 2) >= 0 ? body.dofs[body.dofByName(`knee_${sd}`, 2)]!.tauMax : 220));
      setAng(`shoulder_${sd}`, 2, k.shoulder, 80, 10);
      setAng(`foot_${sd}`, 2, ankleTgt, 300, 0.02 * Math.max(10, body.dofByName(`foot_${sd}`, 2) >= 0 ? body.dofs[body.dofByName(`foot_${sd}`, 2)]!.tauMax : 220));
    }
    setAng('spine1', 2, k.sp1, 300, 40);
    setAng('spine2', 2, k.sp2, 300, 40);
    setAng('spine3', 2, k.sp3, 300, 40);
    setAng('neck', 2, k.neck, 60, 8);

    if (!this.gBuf || this.gBuf.length !== n) { this.gBuf = new Float64Array(n); this.sBuf = new Float64Array(n); }
    computeSquatSupport(body, this.gBuf, this.sBuf!, this.tauGravity);

    const a = 1 - Math.exp(-ctx.dt / 0.05);
    this.fzLp += (fzL - this.fzLp) * a;
    this.fzRp += (fzR - this.fzRp) * a;
    const foot = (sd: 'l' | 'r'): { z: number } => body.bodies[body.indexByKey.get(`foot_${sd}`)!]!.translation();
    this.footMidZ = (foot('l').z + foot('r').z) / 2;
    this.latLocked = p > 0.55;

    if (this.latLocked) {
      if (!this.latRef) {
        const g0 = (name: string, axis: number): number => { const i = body.dofByName(name, axis); return i >= 0 ? body.dofs[i]!.angle : 0; };
        this.latRef = {
          hipL: g0('hip_l',0), hipR: g0('hip_r',0),
          kneeL: g0('knee_l',0), kneeR: g0('knee_r',0),
          footL: g0('foot_l',0), footR: g0('foot_r',0),
          zL: foot('l').z, zR: foot('r').z,
        };
      }
      const widthErr = (this.latRef.zL - this.latRef.zR) - (foot('l').z - foot('r').z);
      const out = Math.max(-0.12, Math.min(0.12, 3.0 * widthErr));
      setAng('hip_l',0,this.latRef.hipL - out,300,0.02 * Math.max(10, body.dofs[body.dofByName('hip_l',0)]!.tauMax));
      setAng('hip_r',0,this.latRef.hipR + out,300,0.02 * Math.max(10, body.dofs[body.dofByName('hip_r',0)]!.tauMax));
      setAng('knee_l',0,this.latRef.kneeL,200,0.02 * Math.max(10, body.dofs[body.dofByName('knee_l',0)]!.tauMax));
      setAng('knee_r',0,this.latRef.kneeR,200,0.02 * Math.max(10, body.dofs[body.dofByName('knee_r',0)]!.tauMax));
      setAng('foot_l',0,this.latRef.footL,200,0.02 * Math.max(10, body.dofs[body.dofByName('foot_l',0)]!.tauMax));
      setAng('foot_r',0,this.latRef.footR,200,0.02 * Math.max(10, body.dofs[body.dofByName('foot_r',0)]!.tauMax));
    } else {
      const e = (this.fzLp - this.fzRp) / Math.max(1, this.fzLp + this.fzRp);
      const hipExcess = Math.abs(e) - num('HIP_TH', 0.10);
      let m = 0;
      if (hipExcess > num('LAT_DEAD', 0.02)) m = Math.max(-num('LAT_MAX', 35), Math.min(num('LAT_MAX', 35), num('LAT_K', 80) * hipExcess * Math.sign(e)));
      m *= num('LAT_SIGN', -1);
      setTorque('hip_l',0,m);
      setTorque('hip_r',0,-m);
      const loadE = (this.fzLp - this.fzRp) / Math.max(1, this.fzLp + this.fzRp);
      let roll = 0;
      if (Math.abs(loadE) > num('LAT_DEAD', 0.02)) roll = Math.max(-num('LOAD_FOOT_MAX', 0.04), Math.min(num('LOAD_FOOT_MAX', 0.04), num('LOAD_FOOT_K', 0.12) * loadE));
      roll *= num('LOAD_FOOT_SIGN', -1);
      const h0l = body.dofByName('hip_l',0), h0r = body.dofByName('hip_r',0);
      const k0l = body.dofByName('knee_l',0), k0r = body.dofByName('knee_r',0);
      const f0l = body.dofByName('foot_l',0), f0r = body.dofByName('foot_r',0);
      if (h0l >= 0) setAng('hip_l',0,this.q0[h0l]!,300,0.02 * Math.max(10, body.dofs[h0l]!.tauMax));
      if (h0r >= 0) setAng('hip_r',0,this.q0[h0r]!,300,0.02 * Math.max(10, body.dofs[h0r]!.tauMax));
      if (k0l >= 0) setAng('knee_l',0,this.q0[k0l]!,200,0.02 * Math.max(10, body.dofs[k0l]!.tauMax));
      if (k0r >= 0) setAng('knee_r',0,this.q0[k0r]!,200,0.02 * Math.max(10, body.dofs[k0r]!.tauMax));
      if (f0l >= 0) setAng('foot_l',0,this.q0[f0l]! + roll,120,0.02 * Math.max(10, body.dofs[f0l]!.tauMax));
      if (f0r >= 0) setAng('foot_r',0,this.q0[f0r]! - roll,120,0.02 * Math.max(10, body.dofs[f0r]!.tauMax));
    }

    const supScale = num('V3_SQ_SUPPORT_SCALE', 1);
    if (supScale !== 1) for (let i = 0; i < n; i++) if (/^(hip|knee|foot|ankle)_/.test(body.dofs[i]!.name)) this.tauGravity[i] = this.tauGravity[i]! * supScale;
    const entryT = Math.max(0.01, num('SQD_ENTRY', 0.35));
    const blend = smooth(Math.min(1, this.t / entryT));
    for (let i = 0; i < n; i++) {
      const d = body.dofs[i]!;
      if (!/^(hip|knee|foot|ankle|spine|neck|shoulder)_/.test(d.name)) continue;
      this.qRef[i] = this.q0[i]! + (this.qRef[i]! - this.q0[i]!) * blend;
      this.kp[i] = this.kp[i]! * blend;
      this.kd[i] = this.kd[i]! * blend;
      this.tauGravity[i] = this.tauGravity[i]! * blend;
      this.ff[i] = this.ff[i]! * blend;
      if (d.axis === 0 && /^(hip|knee|foot)_/.test(d.name)) {
        this.kp[i] = d.name.startsWith('hip') ? 800 : d.name.startsWith('knee') ? 800 : 300;
        this.kd[i] = 0.02 * Math.max(10, d.tauMax);
        if (d.name.startsWith('hip')) this.ff[i] = 0;
      }
    }
    // 大腿根侧向虚拟锁：高刚度目标，不做物理硬约束。
    const hipLockKp = Math.abs(num('SQC_HIP0_LOCK_KP', 2000));
    const hipLockKd = Math.abs(num('SQC_HIP0_LOCK_KD', 50));
    const hipIn = Math.abs(num('SQC_HIP_IN_TARGET', 0.10)) * smooth(Math.max(0, Math.min(1, (p - 0.25) / 0.45)));
    for (const side of ['l', 'r'] as const) {
      const i = body.dofByName(`hip_${side}`, 0);
      if (i < 0) continue;
      const sign = side === 'l' ? 1 : -1;
      this.qRef[i] = this.q0[i]! + sign * hipIn;
      this.kp[i] = hipLockKp;
      this.kd[i] = hipLockKd;
      this.ff[i] = 0;
    }

    // 姿态变换牵扯到的轴向：大腿/小腿/脚的本地轴向全部锁 0。
    for (const side of ['l', 'r'] as const) {
      for (const [jn, kpV, kdV, capV] of [
        ['hip', 900, 40, 120],
        ['knee', 800, 30, 90],
        ['foot', 300, 20, 50],
      ] as const) {
        const i = body.dofByName(`${jn}_${side}`, 1);
        if (i < 0) continue;
        const axialEnv = 0.35 + 0.65 * smooth(Math.max(0, Math.min(1, p / 0.25)));
        const active = jn === 'hip' ? Math.abs(num('SQC_HIP1_ACTIVE_ROT', 0.10)) * axialEnv * (side === 'l' ? 1 : -1) : 0;
        this.qRef[i] = jn === 'hip' ? this.q0[i]! + active : 0;
        this.kp[i] = Math.abs(num(`SQC_${jn.toUpperCase()}1_LOCK_KP`, kpV));
        this.kd[i] = Math.abs(num(`SQC_${jn.toUpperCase()}1_LOCK_KD`, kdV));
        this.ff[i] = 0;
        void capV;
      }
    }

    // 大腿轴向转时，脚/1 反向配平，避免脚跟着大腿一起转。
    for (const side of ['l', 'r'] as const) {
      const h1 = body.dofByName(`hip_${side}`,1);
      const k1 = body.dofByName(`knee_${side}`,1);
      const f1 = body.dofByName(`foot_${side}`,1);
      if (h1 < 0 || f1 < 0) continue;
      const hRel = this.qRef[h1]! - this.q0[h1]!;
      const kRel = k1 >= 0 ? this.qRef[k1]! - this.q0[k1]! : 0;
      this.qRef[f1] = this.q0[f1]! - hRel - kRel;
      this.kp[f1] = 500;
      this.kd[f1] = 25;
    }

    ctx.setComTarget?.(k.comX, this.footMidZ);
    this.output = {
      qRef: this.qRef,
      tauGravity: this.tauGravity,
      ff: this.ff,
      support: ctx.world.perception.support,
      mode: this.id,
      kp: this.kp,
      kd: this.kd,
      latLocked: this.latLocked,
    };
    return this.output;
  }
}
