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
  private latRef: { kneeL: number; kneeR: number } | null = null;
  private hipInRandom: number | null = null;

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
    this.hipInRandom = null;
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
    const omega = Math.sqrt(9.81 / Math.max(0.3, ctx.sensors.com[1]!));
    const xcomErr = k.comX - (ctx.sensors.com[0]! + ctx.sensors.comVel[0]! / omega);
    // 矢状力只能从踝/地面反力来；踝背屈用 XCoM 误差把膝盖/骨盆往前送。
    const ankMax = num('ANK_MAX', 0.90);
    let ankleTgt = num('ANK_ACT', 0.70) * ankEnv + num('ANK_K', 20) * xcomErr;
    ankleTgt = Math.max(-0.05, Math.min(ankMax, ankleTgt));
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
        this.latRef = { kneeL: g0('knee_l', 0), kneeR: g0('knee_r', 0) };
      }
      setAng('knee_l', 0, this.latRef.kneeL, 200, 0.02 * Math.max(10, body.dofs[body.dofByName('knee_l', 0)]!.tauMax));
      setAng('knee_r', 0, this.latRef.kneeR, 200, 0.02 * Math.max(10, body.dofs[body.dofByName('knee_r', 0)]!.tauMax));
    } else {
      const e = (this.fzLp - this.fzRp) / Math.max(1, this.fzLp + this.fzRp);
      const hipExcess = Math.abs(e) - num('HIP_TH', 0.10);
      let m = 0;
      if (hipExcess > num('LAT_DEAD', 0.02)) m = Math.max(-num('LAT_MAX', 35), Math.min(num('LAT_MAX', 35), num('LAT_K', 80) * hipExcess * Math.sign(e)));
      m *= num('LAT_SIGN', -1);
      setTorque('hip_l', 0, m);
      setTorque('hip_r', 0, -m);
      const k0l = body.dofByName('knee_l', 0), k0r = body.dofByName('knee_r', 0);
      if (k0l >= 0) setAng('knee_l', 0, this.q0[k0l]!, 200, 0.02 * Math.max(10, body.dofs[k0l]!.tauMax));
      if (k0r >= 0) setAng('knee_r', 0, this.q0[k0r]!, 200, 0.02 * Math.max(10, body.dofs[k0r]!.tauMax));
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
    // 膝内收作为随机变量：每次蹲下抽一次 hip0 偏置（0..amp），保持旧交接目标结构。
    const hipLockKp = Math.abs(num('SQC_HIP0_LOCK_KP', 1000));
    const hipLockKd = Math.abs(num('SQC_HIP0_LOCK_KD', 30));
    if (this.hipInRandom === null) {
      const fixed = num('SQC_HIP_IN_TARGET', 0.10);
      if (num('SQC_HIP_IN_RANDOM', 1) === 0) {
        this.hipInRandom = fixed;
      } else {
        const amp = Math.abs(fixed);
        // 默认只随机 0..amp（不内收 → 大内收），避免随机外展把交接姿态推到另一侧。
        const lo = Number(num('SQC_HIP_IN_MIN', 0));
        const hi = Number(num('SQC_HIP_IN_MAX', amp));
        const a = Math.min(lo, hi);
        const b = Math.max(lo, hi);
        this.hipInRandom = a + Math.random() * Math.max(0, b - a);
      }
    }
    const hipIn = this.hipInRandom * smooth(Math.max(0, Math.min(1, (p - 0.25) / 0.45)));
    for (const side of ['l', 'r'] as const) {
      const i = body.dofByName(`hip_${side}`, 0);
      if (i < 0) continue;
      const sign = side === 'l' ? 1 : -1;
      // 交接前保持与旧基线相同的 hip0 目标结构，避免锁定后目标突变。
      this.qRef[i] = this.q0[i]! + sign * hipIn;
      this.kp[i] = hipLockKp;
      this.kd[i] = hipLockKd;
      this.ff[i] = 0;
    }

    // 轴向基线取左右 q0 的公共值：保留支撑，不再把左右各自的 q0 差异带进去。
    const h1l = body.dofByName('hip_l',1), h1r = body.dofByName('hip_r',1);
    const k1l = body.dofByName('knee_l',1), k1r = body.dofByName('knee_r',1);
    const f1l = body.dofByName('foot_l',1), f1r = body.dofByName('foot_r',1);
    const common = (a: number, b: number): number => (a >= 0 && b >= 0 ? 0.5 * (this.q0[a]! + this.q0[b]!) : 0);
    const commonHip1 = common(h1l, h1r);
    const commonKnee1 = common(k1l, k1r);
    const commonFoot1 = common(f1l, f1r);
    for (const side of ['l', 'r'] as const) {
      for (const [jn, kpV, kdV, capV] of [
        ['hip', 300, 10, 120],
        ['knee', 300, 10, 90],
        ['foot', 300, 10, 50],
      ] as const) {
        const i = body.dofByName(`${jn}_${side}`, 1);
        if (i < 0) continue;
        const axialEnv = 0.35 + 0.65 * smooth(Math.max(0, Math.min(1, p / 0.25)));
        const active = jn === 'hip' ? Math.abs(num('SQC_HIP1_ACTIVE_ROT', 0)) * axialEnv * (side === 'l' ? 1 : -1) : 0;
        const base = jn === 'hip' ? commonHip1 : jn === 'knee' ? commonKnee1 : commonFoot1;
        this.qRef[i] = base + active;
        this.kp[i] = Math.abs(num(`SQC_${jn.toUpperCase()}1_LOCK_KP`, kpV));
        this.kd[i] = Math.abs(num(`SQC_${jn.toUpperCase()}1_LOCK_KD`, kdV));
        this.ff[i] = 0;
        void capV;
      }
    }

    // 轴向配平：用命令目标相对公共基线，并 clamp。
    for (const side of ['l', 'r'] as const) {
      const h1 = body.dofByName(`hip_${side}`,1);
      const k1 = body.dofByName(`knee_${side}`,1);
      const f1 = body.dofByName(`foot_${side}`,1);
      if (h1 < 0 || f1 < 0) continue;
      const hRel = this.qRef[h1]! - commonHip1;
      const kRel = k1 >= 0 ? this.qRef[k1]! - commonKnee1 : 0;
      this.qRef[f1] = Math.max(-0.09, Math.min(0.09, commonFoot1 - hRel - kRel));
      this.kp[f1] = Math.abs(num('SQC_FOOT1_LOCK_KP', 300));
      this.kd[f1] = Math.abs(num('SQC_FOOT1_LOCK_KD', 20));
    }

    ctx.setComTarget?.(k.comX, this.footMidZ);
    const noPd = new Set<number>();
    for (const sd of ['l', 'r'] as const) {
      const i = body.dofByName(`foot_${sd}`, 0);
      if (i >= 0) noPd.add(i);
    }
    this.output = {
      qRef: this.qRef,
      noPd,
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
