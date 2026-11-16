import type { World } from './world';
import { qMul, qOf, qRotateVec } from './quat';

export interface FootPerception {
  fz: number;
  copX: number;
  copZ: number;
  copValid: boolean;
  contact: boolean;
  slip: boolean;
  ttb: number;
  copVelX: number;
  copVelZ: number;
}

const G = 9.81;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class Perception {
  readonly com = new Float64Array(3);
  readonly comVel = new Float64Array(3);
  readonly comAcc = new Float64Array(3);
  readonly xi = new Float64Array(2);
  readonly hG = new Float64Array(6);
  readonly hDot = new Float64Array(6);
  readonly dHat = new Float64Array(6);
  readonly dHatRaw = new Float64Array(6);
  readonly dHatHP = new Float64Array(6);
  readonly dHatSlow = new Float64Array(6);
  readonly bias = new Float64Array(6);
  readonly cmp = new Float64Array(2);
  readonly feet: FootPerception[] = [
    { fz: 0, copX: 0, copZ: 0, copValid: false, contact: false, slip: false, ttb: Infinity, copVelX: 0, copVelZ: 0 },
    { fz: 0, copX: 0, copZ: 0, copValid: false, contact: false, slip: false, ttb: Infinity, copVelX: 0, copVelZ: 0 },
  ];
  support: 'both' | 'l' | 'r' | 'none' = 'none';
  confidence = 0;
  delay = 0.01;
  passive = true;
  enabled = true;

  private readonly prevH = new Float64Array(6);
  private readonly prevComVel = new Float64Array(3);
  private readonly prevCop = [new Float64Array(2), new Float64Array(2)];
  private readonly prevCopValid = [false, false];
  private readonly copBuf = new Float64Array(3);
  private readonly wrenchBuf = new Float64Array(6);
  private readonly groundF = new Float64Array(3);
  private readonly groundM = new Float64Array(3);
  private readonly ex = new Float64Array(3);
  private readonly ey = new Float64Array(3);
  private readonly ez = new Float64Array(3);
  private readonly comVelRaw = new Float64Array(3);
  private initialized = false;
  private calibLeft = 0;
  private calibTotal = 0;
  private readonly calibAcc = new Float64Array(6);
  private readonly env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  private readonly halfX = Math.abs(Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.PERCEPTION_FOOT_HALF_X ?? 0.12));
  private readonly halfZ = Math.abs(Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.PERCEPTION_FOOT_HALF_Z ?? 0.055));
  private readonly mu = Math.abs(Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.PERCEPTION_FOOT_MU ?? 0.6));
  private readonly vSlip = Math.abs(Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.PERCEPTION_SLIP_V ?? 0.05));
  private readonly lpComVel = Math.max(1e-4, Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.PERCEPTION_COMVEL_TAU ?? 0.02));
  private readonly lpD = Math.max(1e-4, Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.PERCEPTION_DHAT_TAU ?? 0.02));
  private readonly lpSlow = Math.max(1e-3, Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.PERCEPTION_DHAT_SLOW_TAU ?? 0.5));
  private readonly lpCop = Math.max(1e-4, Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.PERCEPTION_COP_TAU ?? 0.02));

  constructor(private readonly world: World) {
    this.enabled = String(this.env.PERCEPTION ?? '1') !== '0';
    this.delay = Math.max(0, Number(this.env.PERCEPTION_DELAY ?? 0.01));
  }

  reset(): void {
    this.com.fill(0);
    this.comVel.fill(0);
    this.comAcc.fill(0);
    this.xi.fill(0);
    this.hG.fill(0);
    this.hDot.fill(0);
    this.dHat.fill(0);
    this.dHatRaw.fill(0);
    this.dHatHP.fill(0);
    this.dHatSlow.fill(0);
    this.bias.fill(0);
    this.cmp.fill(0);
    this.prevH.fill(0);
    this.prevComVel.fill(0);
    this.initialized = false;
    this.calibLeft = 0;
    this.calibTotal = 0;
    this.calibAcc.fill(0);
    for (const f of this.feet) {
      f.fz = 0; f.copX = 0; f.copZ = 0; f.copValid = false;
      f.contact = false; f.slip = false; f.ttb = Infinity;
      f.copVelX = 0; f.copVelZ = 0;
    }
    this.prevCop[0]!.fill(0);
    this.prevCop[1]!.fill(0);
    this.prevCopValid[0] = false;
    this.prevCopValid[1] = false;
    this.support = 'none';
    this.confidence = 0;
  }

  calibrate(frames = 240): void {
    this.calibLeft = Math.max(1, frames);
    this.calibTotal = this.calibLeft;
    this.calibAcc.fill(0);
  }

  update(dt: number): void {
    if (!this.enabled) return;
    const body = this.world.body;
    body.com(this.com);
    body.comVel(this.comVelRaw);
    const kc = 1 - Math.exp(-dt / this.lpComVel);
    for (let i = 0; i < 3; i++) {
      this.comVel[i] = this.comVel[i]! + (this.comVelRaw[i]! - this.comVel[i]!) * kc;
    }
    for (let i = 0; i < 3; i++) {
      this.comAcc[i] = (this.comVel[i]! - this.prevComVel[i]!) / Math.max(dt, 1e-6);
      this.prevComVel[i] = this.comVel[i]!;
    }

    const hLin = [0, 0, 0];
    const hAng = [0, 0, 0];
    for (const rb of body.allBodies) {
      const m = rb.mass();
      if (m <= 0) continue;
      const c = rb.worldCom();
      const v = rb.linvel();
      const w = rb.angvel();
      hLin[0] += m * v.x; hLin[1] += m * v.y; hLin[2] += m * v.z;
      const I = rb.principalInertia();
      const qw = qMul(qOf(rb.rotation()), rb.principalInertiaLocalFrame());
      qRotateVec(qw, 1, 0, 0, this.ex);
      qRotateVec(qw, 0, 1, 0, this.ey);
      qRotateVec(qw, 0, 0, 1, this.ez);
      const dx = this.ex[0]! * w.x + this.ex[1]! * w.y + this.ex[2]! * w.z;
      const dy = this.ey[0]! * w.x + this.ey[1]! * w.y + this.ey[2]! * w.z;
      const dz = this.ez[0]! * w.x + this.ez[1]! * w.y + this.ez[2]! * w.z;
      hAng[0] += I.x * dx * this.ex[0]! + I.y * dy * this.ey[0]! + I.z * dz * this.ez[0]!;
      hAng[1] += I.x * dx * this.ex[1]! + I.y * dy * this.ey[1]! + I.z * dz * this.ez[1]!;
      hAng[2] += I.x * dx * this.ex[2]! + I.y * dy * this.ey[2]! + I.z * dz * this.ez[2]!;
      const rx = c.x - this.com[0]!;
      const ry = c.y - this.com[1]!;
      const rz = c.z - this.com[2]!;
      const px = m * v.x, py = m * v.y, pz = m * v.z;
      hAng[0] += ry * pz - rz * py;
      hAng[1] += rz * px - rx * pz;
      hAng[2] += rx * py - ry * px;
    }
    this.hG[0] = hLin[0]; this.hG[1] = hLin[1]; this.hG[2] = hLin[2];
    this.hG[3] = hAng[0]; this.hG[4] = hAng[1]; this.hG[5] = hAng[2];

    this.groundF.fill(0);
    this.groundM.fill(0);
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? 'l' : 'r';
      const ok = body.footCoP(side, dt, this.copBuf);
      const f = this.feet[s]!;
      const okW = body.footWrench(side, dt, this.wrenchBuf);
      f.copValid = ok;
      f.copX = ok ? this.copBuf[0]! : f.copX;
      f.copZ = ok ? this.copBuf[1]! : f.copZ;
      f.fz = ok ? this.copBuf[2]! : 0;
      f.contact = okW && f.fz > 1;
      const fx = this.wrenchBuf[0]!, fy = this.wrenchBuf[1]!, fz = this.wrenchBuf[2]!;
      this.groundF[0] += fx; this.groundF[1] += fy; this.groundF[2] += fz;
      if (ok) {
        const rx = f.copX - this.com[0]!;
        const ry = -this.com[1]!;
        const rz = f.copZ - this.com[2]!;
        this.groundM[0] += ry * fz - rz * fy;
        this.groundM[1] += rz * fx - rx * fz;
        this.groundM[2] += rx * fy - ry * fx;
      }
      const fi = body.indexByKey.get(`foot_${side}`);
      const rb = fi !== undefined ? body.bodies[fi] : null;
      const vx = rb ? rb.linvel().x : 0;
      const vz = rb ? rb.linvel().z : 0;
      const vh = Math.hypot(vx, vz);
      f.slip = f.fz > 20 && vh > this.vSlip;
      if (ok && this.prevCopValid[s]) {
        const rawX = (f.copX - this.prevCop[s]![0]!) / Math.max(dt, 1e-6);
        const rawZ = (f.copZ - this.prevCop[s]![1]!) / Math.max(dt, 1e-6);
        const kp = 1 - Math.exp(-dt / this.lpCop);
        f.copVelX += (rawX - f.copVelX) * kp;
        f.copVelZ += (rawZ - f.copVelZ) * kp;
      } else {
        f.copVelX = 0; f.copVelZ = 0;
      }
      this.prevCop[s]![0] = f.copX;
      this.prevCop[s]![1] = f.copZ;
      this.prevCopValid[s] = ok;
      this.updateTtb(f, rb);
    }
    const l = this.feet[0]!.contact;
    const r = this.feet[1]!.contact;
    this.support = l && r ? 'both' : l ? 'l' : r ? 'r' : 'none';

    if (!this.initialized) {
      this.prevH.set(this.hG);
      this.dHat.fill(0);
      this.dHatRaw.fill(0);
      this.initialized = true;
    } else {
      for (let i = 0; i < 6; i++) this.hDot[i] = (this.hG[i]! - this.prevH[i]!) / Math.max(dt, 1e-6);
      const m = body.sk.massTotal;
      const gY = this.world.world.gravity.y;
      this.dHatRaw[0] = this.hDot[0]! - this.groundF[0]!;
      this.dHatRaw[1] = this.hDot[1]! - m * gY - this.groundF[1]!;
      this.dHatRaw[2] = this.hDot[2]! - this.groundF[2]!;
      this.dHatRaw[3] = this.hDot[3]! - this.groundM[0]!;
      this.dHatRaw[4] = this.hDot[4]! - this.groundM[1]!;
      this.dHatRaw[5] = this.hDot[5]! - this.groundM[2]!;
      if (this.calibLeft > 0) {
        for (let i = 0; i < 6; i++) this.calibAcc[i] = this.calibAcc[i]! + this.dHatRaw[i]!;
        this.calibLeft--;
        if (this.calibLeft === 0) {
          for (let i = 0; i < 6; i++) this.bias[i] = this.calibAcc[i]! / this.calibTotal;
        }
      }
      const ka = 1 - Math.exp(-dt / this.lpD);
      const ks = 1 - Math.exp(-dt / this.lpSlow);
      for (let i = 0; i < 6; i++) {
        this.dHat[i] = this.dHat[i]! + (this.dHatRaw[i]! - this.bias[i]! - this.dHat[i]!) * ka;
        this.dHatSlow[i] = this.dHatSlow[i]! + (this.dHat[i]! - this.dHatSlow[i]!) * ks;
        this.dHatHP[i] = this.dHat[i]! - this.dHatSlow[i]!;
      }
      this.prevH.set(this.hG);
    }

    const gNow = Math.max(0, -this.world.world.gravity.y);
    const omega = Math.sqrt((gNow > 1e-6 ? gNow : G) / Math.max(0.3, this.com[1]!));
    this.xi[0] = this.com[0]! + this.comVel[0]! / omega;
    this.xi[1] = this.com[2]! + this.comVel[2]! / omega;
    const fzSum = this.feet[0]!.fz + this.feet[1]!.fz;
    if (fzSum > 1) {
      const copZ = (this.feet[0]!.fz * this.feet[0]!.copZ + this.feet[1]!.fz * this.feet[1]!.copZ) / fzSum;
      this.cmp[1] = copZ - this.hDot[3]! / fzSum;
      const copX = (this.feet[0]!.fz * this.feet[0]!.copX + this.feet[1]!.fz * this.feet[1]!.copX) / fzSum;
      this.cmp[0] = copX + this.hDot[4]! / fzSum;
    } else {
      this.cmp[0] = this.com[0]!;
      this.cmp[1] = this.com[2]!;
    }

    const contactFrac = (l ? 0.5 : 0) + (r ? 0.5 : 0);
    const dMag = Math.hypot(this.dHat[0]!, this.dHat[2]!);
    const noiseFrac = dMag / Math.max(1, fzSum);
    this.confidence = clamp(0.55 * contactFrac + 0.45 * (1 - clamp(noiseFrac / 0.5, 0, 1)), 0, 1);
  }

  private updateTtb(f: FootPerception, rb: { translation(): { x: number; y: number; z: number } } | null): void {
    if (!f.copValid || !rb) { f.ttb = Infinity; return; }
    const p = rb.translation();
    const zMin = p.z - this.halfZ;
    const zMax = p.z + this.halfZ;
    const xMin = p.x - this.halfX;
    const xMax = p.x + this.halfX;
    const eps = 1e-4;
    let t = Infinity;
    if (f.copVelZ > eps) t = Math.min(t, (zMax - f.copZ) / f.copVelZ);
    else if (f.copVelZ < -eps) t = Math.min(t, (f.copZ - zMin) / -f.copVelZ);
    if (f.copVelX > eps) t = Math.min(t, (xMax - f.copX) / f.copVelX);
    else if (f.copVelX < -eps) t = Math.min(t, (f.copX - xMin) / -f.copVelX);
    f.ttb = t < 0 ? 0 : t;
  }
}
