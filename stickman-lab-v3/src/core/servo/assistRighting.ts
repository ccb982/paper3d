import type { World } from '../world';
import type { Sensors } from '../sensors';
import { baseState } from './baseTable';
import { envNum, envStr } from '../env';
import { propose, PRI } from '../proposalBus';

export type AssistLayer = 'leg' | 'hip' | 'upper' | 'limb';
export type AssistMode = 'off' | 'monitor' | 'assist';

export interface AssistLayerCfg {
  delay: number;
  ramp: number;
  tol: number;
  eIn: number;
  eOut: number;
  hold: number;
  maxGain: number;
  targetJump: number;
  kpScale: number;
  kdScale: number;
  auth: number;
  qddMax: number;
}

export interface AssistJointState {
  dof: number;
  name: string;
  axis: number;
  layer: AssistLayer;
  q: number;
  qd: number;
  target: number;
  e: number;
  edot: number;
  severity: number;
  persistent: number;
  gain: number;
  tau: number;
  valid: boolean;
}

export interface AssistRootState {
  on: boolean;
  active: boolean;
  ex: number;
  ez: number;
  ax: number;
  az: number;
  ay: number;
  ey: number;
  gain: number;
}

export interface AssistSnapshot {
  t: number;
  mode: AssistMode;
  state: string;
  active: boolean;
  maxSeverity: number;
  maxGain: number;
  joints: AssistJointState[];
  root: AssistRootState;
}

const DEFAULTS: Record<AssistLayer, AssistLayerCfg> = {
  leg: { delay: 0.30, ramp: 0.50, tol: 0.05, eIn: 0.03, eOut: 0.01, hold: 0.30, maxGain: 1, targetJump: 0.03, kpScale: 0.4, kdScale: 0.04, auth: 1.0, qddMax: 250 },
  hip: { delay: 0.45, ramp: 0.60, tol: 0.06, eIn: 0.04, eOut: 0.015, hold: 0.30, maxGain: 1, targetJump: 0.03, kpScale: 0.3, kdScale: 0.03, auth: 0.8, qddMax: 250 },
  upper: { delay: 0.80, ramp: 0.80, tol: 0.08, eIn: 0.05, eOut: 0.02, hold: 0.30, maxGain: 0, targetJump: 0.04, kpScale: 0.05, kdScale: 0.005, auth: 0.2, qddMax: 150 },
  limb: { delay: 1.00, ramp: 1.00, tol: 0.10, eIn: 0.06, eOut: 0.025, hold: 0.30, maxGain: 0, targetJump: 0.05, kpScale: 0.05, kdScale: 0.005, auth: 0.2, qddMax: 100 },
};

function layerOf(name: string): AssistLayer | null {
  if (/^(knee|foot|ankle)_/.test(name)) return 'leg';
  if (/^hip_/.test(name)) return 'hip';
  if (/^(spine|neck)/.test(name)) return 'upper';
  if (/^(shoulder|elbow|hand|arm)/.test(name)) return 'limb';
  return null;
}

function cfgFor(layer: AssistLayer): AssistLayerCfg {
  const d = DEFAULTS[layer];
  const k = layer.toUpperCase();
  return {
    delay: envNum(`V3_AR_${k}_DELAY`, d.delay, 0),
    ramp: envNum(`V3_AR_${k}_RAMP`, d.ramp, 1e-6),
    tol: envNum(`V3_AR_${k}_TOL`, d.tol, 1e-6),
    eIn: envNum(`V3_AR_${k}_EIN`, d.eIn, 0),
    eOut: envNum(`V3_AR_${k}_EOUT`, d.eOut, 0),
    hold: envNum(`V3_AR_${k}_HOLD`, d.hold, 0),
    maxGain: envNum(`V3_AR_${k}_MAXGAIN`, d.maxGain, 0),
    targetJump: envNum(`V3_AR_${k}_JUMP`, d.targetJump, 0),
    kpScale: envNum(`V3_AR_${k}_KP_SCALE`, d.kpScale, 0),
    kdScale: envNum(`V3_AR_${k}_KD_SCALE`, d.kdScale, 0),
    auth: envNum(`V3_AR_${k}_AUTH`, d.auth, 0),
    qddMax: envNum(`V3_AR_${k}_QDD`, d.qddMax, 1),
  };
}

export class AssistRighting {
  readonly mode: AssistMode;
  private readonly qTarget: Float64Array;
  private readonly valid: Uint8Array;
  private readonly rt: Array<{ D: number; below: number; lastTarget: number; gain: number }>;
  private readonly states: AssistJointState[];
  private readonly cfg: Record<AssistLayer, AssistLayerCfg>;
  private readonly trace: boolean;
  private readonly velMax: number;
  private readonly focusKneeHip: boolean;
  private readonly rootOn: boolean;
  private readonly rootDelay: number;
  private readonly rootRamp: number;
  private readonly rootKp: number;
  private readonly rootKd: number;
  private readonly rootCap: number;
  private readonly rootEIn: number;
  private readonly rootEOut: number;
  private readonly rootMaxGain: number;
  private readonly rootYOn: boolean;
  private readonly rootKpY: number;
  private readonly rootKdY: number;
  private readonly rootCapY: number;
  private comTargetX = 0;
  private comTargetZ = 0;
  private comTargetY = 0;
  private comValid = false;
  private comYValid = false;
  private rootD = 0;
  private rootGain = 0;
  private rootActive = false;
  private rootEx = 0;
  private rootEz = 0;
  private rootAx = 0;
  private rootAz = 0;
  private rootAy = 0;
  private rootEy = 0;
  private hasTargets = false;
  private lastState = '';
  private lastSnap = -1;
  private snap: AssistSnapshot;

  constructor(private readonly w: World, private readonly sensors: Sensors) {
    const n = w.body.dofs.length;
    this.qTarget = new Float64Array(n);
    this.valid = new Uint8Array(n);
    this.rt = Array.from({ length: n }, () => ({ D: 0, below: 0, lastTarget: Number.NaN, gain: 0 }));
    this.states = w.body.dofs.map((d, i) => ({
      dof: i,
      name: d.name,
      axis: d.axis,
      layer: layerOf(d.name) ?? 'limb',
      q: 0,
      qd: 0,
      target: 0,
      e: 0,
      edot: 0,
      severity: 0,
      persistent: 0,
      gain: 0,
      tau: 0,
      valid: false,
    }));
    this.cfg = { leg: cfgFor('leg'), hip: cfgFor('hip'), upper: cfgFor('upper'), limb: cfgFor('limb') };
    const m = envStr('V3_AR_MODE').toLowerCase();
    this.mode = m === 'off' ? 'off' : m === 'assist' ? 'assist' : 'monitor';
    this.trace = envStr('V3_AR_TRACE') === '1';
    this.velMax = envNum('V3_AR_VEL_MAX', 2.0, 0.05);
    this.focusKneeHip = envStr('V3_AR_FOCUS') !== 'all';
    this.rootOn = envStr('V3_AR_ROOT') !== '0';
    this.rootDelay = envNum('V3_AR_ROOT_DELAY', 0.10, 0);
    this.rootRamp = envNum('V3_AR_ROOT_RAMP', 0.35, 1e-6);
    this.rootKp = envNum('V3_AR_ROOT_KP', 25, 0);
    this.rootKd = envNum('V3_AR_ROOT_KD', 10, 0);
    this.rootCap = envNum('V3_AR_ROOT_CAP', 4.0, 0);
    this.rootEIn = envNum('V3_AR_ROOT_EIN', 0.015, 0);
    this.rootEOut = envNum('V3_AR_ROOT_EOUT', 0.006, 0);
    this.rootMaxGain = envNum('V3_AR_ROOT_MAXGAIN', 1, 0);
    this.rootYOn = envStr('V3_AR_ROOT_Y') === '1';
    this.rootKpY = envNum('V3_AR_ROOT_KPY', 30, 0);
    this.rootKdY = envNum('V3_AR_ROOT_KDY', 12, 0);
    this.rootCapY = envNum('V3_AR_ROOT_CAP_Y', 6, 0);
    this.snap = {
      t: 0, mode: this.mode, state: '', active: false, maxSeverity: 0, maxGain: 0, joints: [],
      root: { on: this.rootOn, active: false, ex: 0, ez: 0, ax: 0, az: 0, ay: 0, ey: 0, gain: 0 },
    };
    (globalThis as { __V3_AR?: AssistSnapshot }).__V3_AR = this.snap;
  }

  beginTargets(): void {
    this.valid.fill(0);
    this.hasTargets = false;
    this.comValid = false;
  }

  setTargetDof(dof: number, q: number): void {
    if (dof < 0 || dof >= this.qTarget.length || !Number.isFinite(q)) return;
    this.qTarget[dof] = q;
    this.valid[dof] = 1;
  }

  setTargetByName(name: string, axis: number, q: number): void {
    const i = this.w.body.dofByName(name, axis);
    if (i >= 0) this.setTargetDof(i, q);
  }

  setComTarget(x: number, z: number, y?: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    this.comTargetX = x;
    this.comTargetZ = z;
    this.comValid = true;
    if (Number.isFinite(y) && !this.comYValid) {
      this.comTargetY = y!;
      this.comYValid = true;
    }
  }

  commitTargets(): void {
    for (let i = 0; i < this.valid.length; i++) {
      if (this.valid[i]) {
        this.hasTargets = true;
        return;
      }
    }
    this.hasTargets = false;
  }

  reset(): void {
    this.valid.fill(0);
    this.hasTargets = false;
    this.lastState = '';
    this.lastSnap = -1;
    for (const r of this.rt) {
      r.D = 0;
      r.below = 0;
      r.lastTarget = Number.NaN;
      r.gain = 0;
    }
    for (const s of this.states) {
      s.valid = false;
      s.gain = 0;
      s.persistent = 0;
      s.severity = 0;
      s.e = 0;
      s.edot = 0;
      s.tau = 0;
    }
    this.comValid = false;
    this.comYValid = false;
    this.rootD = 0;
    this.rootGain = 0;
    this.rootActive = false;
    this.rootEx = 0;
    this.rootEz = 0;
    this.rootAx = 0;
    this.rootAz = 0;
    this.snap = {
      t: this.w.clock, mode: this.mode, state: '', active: false, maxSeverity: 0, maxGain: 0, joints: [],
      root: { on: this.rootOn, active: false, ex: 0, ez: 0, ax: 0, az: 0, ay: 0, ey: 0, gain: 0 },
    };
    (globalThis as { __V3_AR?: AssistSnapshot }).__V3_AR = this.snap;
  }

  step(dt: number): void {
    const st = baseState();
    if (st !== this.lastState) {
      this.lastState = st;
      for (const r of this.rt) {
        r.D = 0;
        r.below = 0;
        r.lastTarget = Number.NaN;
        r.gain = 0;
      }
      this.rootD = 0;
      this.rootGain = 0;
      this.rootActive = false;
      this.comYValid = false;
    }
    if (this.mode === 'off' || st !== 'squat' || !this.hasTargets) {
      for (const s of this.states) {
        s.valid = false;
        s.gain = 0;
        s.persistent = 0;
        s.severity = 0;
        s.tau = 0;
      }
      this.rootGain = 0;
      this.rootActive = false;
      this.rootAx = 0;
      this.rootAz = 0;
      this.publish(st, false, 0, 0);
      return;
    }

    let active = false;
    let maxSeverity = 0;
    let maxGain = 0;
    for (let i = 0; i < this.w.body.dofs.length; i++) {
      const d = this.w.body.dofs[i]!;
      const s = this.states[i]!;
      const r = this.rt[i]!;
      const layer = layerOf(d.name);
      if (!this.valid[i] || !layer) {
        r.D = 0;
        r.below = 0;
        r.lastTarget = Number.NaN;
        r.gain = 0;
        s.valid = false;
        s.gain = 0;
        s.persistent = 0;
        continue;
      }
      const cfg = this.cfg[layer];
      const target = this.qTarget[i]!;
      const e = target - d.angle;
      const ae = Math.abs(e);
      if (Number.isFinite(r.lastTarget) && Math.abs(target - r.lastTarget) > cfg.targetJump) {
        r.D = 0;
        r.below = 0;
      }
      r.lastTarget = target;
      if (ae > cfg.eIn) {
        r.D = Math.min(10, r.D + dt);
        r.below = 0;
      } else if (ae < cfg.eOut) {
        r.below += dt;
        r.D = 0;
      }
      const u = Math.max(0, Math.min(1, (r.D - cfg.delay) / Math.max(1e-6, cfg.ramp)));
      const gain = ae < cfg.eOut ? 0 : u * u * (3 - 2 * u) * cfg.maxGain;
      r.gain = gain;
      const severity = ae / Math.max(1e-6, cfg.tol);
      const tauMax = Math.max(1, d.tauMax);
      const cap = Math.max(1, cfg.auth * tauMax);
      const vel = Math.max(-this.velMax, Math.min(this.velMax, d.vel));
      const focused = !this.focusKneeHip || /^(knee|hip)_/.test(d.name);
      const floor = /^hip_/.test(d.name) ? 0.8 : /^knee_/.test(d.name) ? 3.0 : /^(foot|ankle)_/.test(d.name) ? 1.5 : 0.1;
      const iEff = Math.max(d.inertia, floor);
      const tauAcc = Math.max(1, cfg.qddMax * iEff);
      const tauCap = Math.min(cap, tauAcc);
      const tau = this.mode === 'assist' && focused
        ? Math.max(-tauCap, Math.min(tauCap, gain * (cfg.kpScale * tauMax * e - cfg.kdScale * tauMax * vel)))
        : 0;
      if (this.mode === 'assist' && focused && Math.abs(tau) > 1e-6) {
        propose({ dof: i, kind: 'ext', pri: PRI.reflex, channel: 'external', tau, cap: tauCap, src: 'v3.assistRighting' });
      }
      s.q = d.angle;
      s.qd = d.vel;
      s.target = target;
      s.e = e;
      s.edot = -d.vel;
      s.severity = severity;
      s.persistent = r.D;
      s.gain = gain;
      s.tau = tau;
      s.valid = true;
      if (focused && gain > 1e-4) active = true;
      if (severity > maxSeverity) maxSeverity = severity;
      if (focused && gain > maxGain) maxGain = gain;
    }
    this.stepRoot(dt);
    if (this.rootActive) active = true;
    this.publish(st, active, maxSeverity, maxGain);
  }

  private stepRoot(dt: number): void {
    if (!this.rootOn || !this.comValid) {
      this.rootGain = 0;
      this.rootActive = false;
      this.rootAx = 0;
      this.rootAz = 0;
      return;
    }
    const comX = this.sensors.com[0] ?? 0;
    const comZ = this.sensors.com[2] ?? 0;
    const vx = this.sensors.comVel[0] ?? 0;
    const vz = this.sensors.comVel[2] ?? 0;
    const ex = this.comTargetX - comX;
    const ez = this.comTargetZ - comZ;
    const e = Math.hypot(ex, ez);
    if (e > this.rootEIn) {
      this.rootD = Math.min(10, this.rootD + dt);
    } else if (e < this.rootEOut) {
      this.rootD = 0;
    }
    const u = Math.max(0, Math.min(1, (this.rootD - this.rootDelay) / Math.max(1e-6, this.rootRamp)));
    const gain = e < this.rootEOut ? 0 : u * u * (3 - 2 * u) * this.rootMaxGain;
    const ax = Math.max(-this.rootCap, Math.min(this.rootCap, gain * (this.rootKp * ex - this.rootKd * vx)));
    const az = Math.max(-this.rootCap, Math.min(this.rootCap, gain * (this.rootKp * ez - this.rootKd * vz)));
    const ey = this.comYValid ? this.comTargetY - (this.sensors.com[1] ?? 0) : 0;
    const vy = this.sensors.comVel[1] ?? 0;
    const ay = this.rootYOn && this.comYValid
      ? Math.max(-this.rootCapY, Math.min(this.rootCapY, gain * (this.rootKpY * ey - this.rootKdY * vy)))
      : 0;
    this.rootGain = gain;
    this.rootActive = gain > 1e-4;
    this.rootEx = ex;
    this.rootEz = ez;
    this.rootAx = ax;
    this.rootAz = az;
    this.rootAy = ay;
    this.rootEy = ey;
    if (this.mode === 'assist' && gain > 1e-4) {
      const ix = ax * dt;
      const iz = az * dt;
      const iy = ay * dt;
      for (const b of this.w.body.bodies) {
        const m = b.mass();
        if (m <= 0) continue;
        b.applyImpulse({ x: m * ix, y: m * iy, z: m * iz }, true);
      }
    }
  }

  snapshot(): AssistSnapshot {
    return this.snap;
  }

  private publish(st: string, active: boolean, maxSeverity: number, maxGain: number): void {
    if (!this.trace && this.w.clock - this.lastSnap < 0.05) return;
    this.lastSnap = this.w.clock;
    const joints: AssistJointState[] = [];
    for (const s of this.states) if (s.valid) joints.push({ ...s });
    this.snap = {
      t: this.w.clock, mode: this.mode, state: st, active, maxSeverity, maxGain, joints,
      root: { on: this.rootOn, active: this.rootActive, ex: this.rootEx, ez: this.rootEz, ax: this.rootAx, az: this.rootAz, ay: this.rootAy, ey: this.rootEy, gain: this.rootGain },
    };
    (globalThis as { __V3_AR?: AssistSnapshot }).__V3_AR = this.snap;
  }
}
