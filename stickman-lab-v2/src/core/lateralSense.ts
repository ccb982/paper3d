import type { World } from './world';

export interface LateralState {
  comZ: number;
  comVelZ: number;
  comAccZ: number;
  xiZ: number;
  cmpZ: number;
  copZ: number;
  fzL: number;
  fzR: number;
  loadDiff: number;
  roll: number;
  rollRate: number;
  dHatZ: number;
  dHatHPZ: number;
  ttb: number;
  changeScore: number;
  direction: number;
  dominantPart: string;
  partDirection: number;
  partScore: number;
  source: 'none' | 'self' | 'push' | 'load' | 'slip' | 'ground';
  motionDir: number;
  motionSpeed: number;
  forceDir: number;
  forceMotionDot: number;
  braking: boolean;
  reversed: boolean;
  overshoot: number;
  onset: boolean;
  confidence: number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export class LateralSense {
  readonly state: LateralState = {
    comZ: 0, comVelZ: 0, comAccZ: 0, xiZ: 0, cmpZ: 0, copZ: 0,
    fzL: 0, fzR: 0, loadDiff: 0, roll: 0, rollRate: 0,
    dHatZ: 0, dHatHPZ: 0, ttb: Infinity,
    changeScore: 0, direction: 0, dominantPart: 'none', partDirection: 0, partScore: 0, source: 'none',
    motionDir: 0, motionSpeed: 0, forceDir: 0, forceMotionDot: 0, braking: false, reversed: false, overshoot: 0,
    onset: false, confidence: 0,
  };
  enabled = true;

  private ref = { comZ: 0, roll: 0, load: 0, fz: 0 };
  readonly parts: Record<string, { key: string; z: number; vz: number; roll: number; score: number; vzRel: number }> = {};
  private readonly partRefs = new Map<string, { z: number; roll: number; pz: number; proll: number }>();
  private calibrated = false;
  private readonly prevVel = { z: 0, init: false };
  private cusum = { vp: 0, vn: 0, fp: 0, fn: 0, lp: 0, ln: 0 };
  private hold = 0;
  private warmup = 0;
  private prevOnset = false;
  private motionRefDir = 0;
  private reversed = false;
  private overshoot = 0;
  private readonly env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};

  constructor(private readonly world: World) {
    this.enabled = String(this.env.LATERAL_SENSE ?? '1') !== '0';
  }

  reset(): void {
    this.calibrated = false;
    this.ref = { comZ: 0, roll: 0, load: 0, fz: 0 };
    for (const k of Object.keys(this.parts)) delete this.parts[k];
    this.partRefs.clear();
    this.prevVel.z = 0;
    this.prevVel.init = false;
    this.cusum = { vp: 0, vn: 0, fp: 0, fn: 0, lp: 0, ln: 0 };
    this.hold = 0;
    this.warmup = 0;
    this.prevOnset = false;
    this.motionRefDir = 0;
    this.reversed = false;
    this.overshoot = 0;
    Object.assign(this.state, {
      comZ: 0, comVelZ: 0, comAccZ: 0, xiZ: 0, cmpZ: 0, copZ: 0,
      fzL: 0, fzR: 0, loadDiff: 0, roll: 0, rollRate: 0,
      dHatZ: 0, dHatHPZ: 0, ttb: Infinity,
      changeScore: 0, direction: 0, dominantPart: 'none', partDirection: 0, partScore: 0, source: 'none',
    motionDir: 0, motionSpeed: 0, forceDir: 0, forceMotionDot: 0, braking: false, reversed: false, overshoot: 0,
    onset: false, confidence: 0,
    });
  }

  calibrate(): void {
    const p = this.world.perception;
    this.ref.comZ = p.com[2]!;
    this.ref.roll = this.torsoRoll();
    this.ref.load = p.feet[0]!.fz - p.feet[1]!.fz;
    this.ref.fz = p.feet[0]!.fz + p.feet[1]!.fz;
    this.cusum = { vp: 0, vn: 0, fp: 0, fn: 0, lp: 0, ln: 0 };
    this.partRefs.clear();
    for (const def of this.partDefs) {
      const rb = this.partBody(def.key);
      if (!rb) continue;
      const pb = def.parent ? this.partBody(def.parent) : null;
      const pz = pb ? pb.translation().z : this.world.perception.com[2]!;
      const proll = def.roll ? (pb ? this.bodyRoll(pb) : 0) : 0;
      this.partRefs.set(def.label, { z: rb.translation().z, roll: def.roll ? this.bodyRoll(rb) : 0, pz, proll });
    }
    this.hold = 0;
    this.warmup = 0.3;
    this.prevOnset = false;
    this.motionRefDir = 0;
    this.reversed = false;
    this.overshoot = 0;
    this.calibrated = true;
  }

  update(dt: number): void {
    if (!this.enabled) return;
    const p = this.world.perception;
    if (!this.calibrated) this.calibrate();
    const s = this.state;
    s.comZ = p.com[2]!;
    s.comVelZ = p.comVel[2]!;
    const accRaw = this.prevVel.init ? (s.comVelZ - this.prevVel.z) / Math.max(dt, 1e-6) : 0;
    s.comAccZ = s.comAccZ + (accRaw - s.comAccZ) * (1 - Math.exp(-dt / 0.03));
    this.prevVel.z = s.comVelZ;
    this.prevVel.init = true;
    s.xiZ = p.xi[1]!;
    s.cmpZ = p.cmp[1]!;
    s.fzL = p.feet[0]!.fz;
    s.fzR = p.feet[1]!.fz;
    s.loadDiff = s.fzL - s.fzR;
    const fzSum = Math.max(1e-6, s.fzL + s.fzR);
    s.copZ = (s.fzL * p.feet[0]!.copZ + s.fzR * p.feet[1]!.copZ) / fzSum;
    s.roll = this.torsoRoll();
    s.rollRate = this.world.body.bodies[this.world.body.indexByKey.get('spine4') ?? this.world.body.indexByKey.get('spine3') ?? 0]!.angvel().x;
    s.dHatZ = p.dHat[2]!;
    s.dHatHPZ = p.dHatHP[2]!;
    s.ttb = Math.min(p.feet[0]!.ttb, p.feet[1]!.ttb);

    const dCom = s.comZ - this.ref.comZ;
    const dRoll = s.roll - this.ref.roll;
    const dLoad = s.loadDiff - this.ref.load;
    const sCom = Math.abs(dCom) / 0.01;
    const sVel = Math.abs(s.comVelZ) / 0.05;
    const sAcc = Math.abs(s.comAccZ) / 0.5;
    const sForce = Math.abs(s.dHatHPZ) / 20;
    const sLoad = Math.abs(dLoad) / 50;
    const sRoll = Math.abs(dRoll) / (2 / 57.3);
    s.changeScore = Math.max(sCom, sVel, sAcc, sForce, sLoad, sRoll);
    s.confidence = clamp(p.confidence * (p.support === 'none' ? 0.3 : 1), 0, 1);
    this.updateParts();
    if (this.warmup > 0) {
      this.warmup = Math.max(0, this.warmup - dt);
      this.cusum = { vp: 0, vn: 0, fp: 0, fn: 0, lp: 0, ln: 0 };
      this.hold = 0;
      s.onset = false;
      s.direction = 0;
      return;
    }

    const kv = 0.01;
    const kf = 5;
    const kl = 10;
    this.cusum.vp = Math.max(0, this.cusum.vp + s.comVelZ - kv);
    this.cusum.vn = Math.max(0, this.cusum.vn - s.comVelZ - kv);
    this.cusum.fp = Math.max(0, this.cusum.fp + s.dHatHPZ - kf);
    this.cusum.fn = Math.max(0, this.cusum.fn - s.dHatHPZ - kf);
    this.cusum.lp = Math.max(0, this.cusum.lp + dLoad - kl);
    this.cusum.ln = Math.max(0, this.cusum.ln - dLoad - kl);
    const hv = 0.03;
    const hf = 20;
    const hl = 30;
    const alarm = Math.max(this.cusum.vp, this.cusum.vn) > hv
      || Math.max(this.cusum.fp, this.cusum.fn) > hf
      || Math.max(this.cusum.lp, this.cusum.ln) > hl
      || s.changeScore > 1;
    if (alarm) this.hold = 0.25;
    else this.hold = Math.max(0, this.hold - dt);
    s.onset = this.hold > 0;
    const dirScore = Math.abs(s.dHatHPZ) >= Math.abs(s.comVelZ * 100) ? s.dHatHPZ : s.comVelZ;
    const ctl = this.world.controller as unknown as { actions?: { status?: { active?: boolean } } } | null;
    const self = !!ctl?.actions?.status?.active;
    const slip = p.feet[0]!.slip || p.feet[1]!.slip;
    if (self && Math.abs(s.dHatHPZ) < 15) s.source = 'self';
    else if (p.support === 'none') s.source = 'ground';
    else if (slip) s.source = 'slip';
    else if (Math.abs(s.dHatHPZ) > 10 || Math.abs(s.comVelZ) > 0.015) s.source = 'push';
    else if (Math.abs(dLoad) > 30) s.source = 'load';
    else s.source = 'none';
    s.direction = s.source === 'load'
      ? (dLoad > 0 ? 1 : dLoad < 0 ? -1 : 0)
      : (dirScore > 0 ? 1 : dirScore < 0 ? -1 : 0);
    s.motionSpeed = Math.abs(s.comVelZ);
    s.motionDir = s.comVelZ > 0.001 ? 1 : s.comVelZ < -0.001 ? -1 : 0;
    s.forceDir = s.dHatHPZ > 2 ? 1 : s.dHatHPZ < -2 ? -1 : 0;
    s.forceMotionDot = s.motionDir !== 0 && s.forceDir !== 0 ? s.motionDir * s.forceDir : 0;
    s.braking = s.forceMotionDot < 0;
    if (s.onset && !this.prevOnset) {
      this.motionRefDir = s.motionDir || s.forceDir;
      this.reversed = false;
      this.overshoot = 0;
    }
    this.prevOnset = s.onset;
    if (this.motionRefDir !== 0 && s.motionDir !== 0 && s.motionDir !== this.motionRefDir) this.reversed = true;
    if (this.reversed) {
      const over = Math.max(0, -(s.comZ - this.ref.comZ) * this.motionRefDir);
      if (over > this.overshoot) this.overshoot = over;
    }
    s.reversed = this.reversed;
    s.overshoot = this.overshoot;
  }

  private readonly partDefs = [
    { label: 'arm_l', key: 'arm_l', parent: 'spine4', thZ: 0.02, thV: 0.12, thRoll: 0, roll: false },
    { label: 'arm_r', key: 'arm_r', parent: 'spine4', thZ: 0.02, thV: 0.12, thRoll: 0, roll: false },
    { label: 'hand_l', key: 'hand_l', parent: 'arm_l', thZ: 0.03, thV: 0.15, thRoll: 0, roll: false },
    { label: 'hand_r', key: 'hand_r', parent: 'arm_r', thZ: 0.03, thV: 0.15, thRoll: 0, roll: false },
    { label: 'trunk', key: 'spine4', parent: 'torso', thZ: 0.008, thV: 0.06, thRoll: 1 / 57.3, roll: true },
    { label: 'pelvis', key: 'torso', parent: '', thZ: 0.008, thV: 0.06, thRoll: 1 / 57.3, roll: true },
    { label: 'head', key: 'head', parent: 'spine4', thZ: 0.01, thV: 0.08, thRoll: 1.5 / 57.3, roll: true },
    { label: 'leg_l', key: 'thigh_l', parent: 'torso', thZ: 0.015, thV: 0.08, thRoll: 0, roll: false },
    { label: 'leg_r', key: 'thigh_r', parent: 'torso', thZ: 0.015, thV: 0.08, thRoll: 0, roll: false },
    { label: 'knee_l', key: 'shin_l', parent: 'thigh_l', thZ: 0.012, thV: 0.08, thRoll: 0, roll: false },
    { label: 'knee_r', key: 'shin_r', parent: 'thigh_r', thZ: 0.012, thV: 0.08, thRoll: 0, roll: false },
    { label: 'foot_l', key: 'foot_l', parent: 'shin_l', thZ: 0.01, thV: 0.05, thRoll: 0, roll: false },
    { label: 'foot_r', key: 'foot_r', parent: 'shin_r', thZ: 0.01, thV: 0.05, thRoll: 0, roll: false },
  ];

  private partBody(key: string): { translation(): { z: number }; linvel(): { z: number }; rotation(): { x: number; y: number; z: number; w: number } } | null {
    const bi = this.world.body.indexByKey.get(key);
    return bi === undefined ? null : this.world.body.bodies[bi]!;
  }

  private bodyRoll(rb: { rotation(): { x: number; y: number; z: number; w: number } }): number {
    const q = rb.rotation();
    const ux = 2 * (q.x * q.y - q.w * q.z);
    const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
    const uz = 2 * (q.w * q.x + q.y * q.z);
    return Math.atan2(uz, Math.hypot(ux, uy));
  }

  private updateParts(): void {
    const s = this.state;
    let best = 0, bestLabel = 'none', bestDir = 0, bestZ = 0;
    for (const def of this.partDefs) {
      const rb = this.partBody(def.key);
      if (!rb) continue;
      const z = rb.translation().z;
      const vz = rb.linvel().z;
      const roll = def.roll ? this.bodyRoll(rb) : 0;
      const pb = def.parent ? this.partBody(def.parent) : null;
      const pz = pb ? pb.translation().z : s.comZ;
      const pvz = pb ? pb.linvel().z : s.comVelZ;
      const proll = def.roll ? (pb ? this.bodyRoll(pb) : 0) : 0;
      const ref = this.partRefs.get(def.label);
      const dz = (z - pz) - (ref ? ref.z - ref.pz : 0);
      const dvz = vz - pvz;
      const droll = (roll - proll) - (ref ? ref.roll - ref.proll : 0);
      const sz = Math.abs(dz) / def.thZ;
      const sv = Math.abs(dvz) / def.thV;
      const sr = def.thRoll > 0 ? Math.abs(droll) / def.thRoll : 0;
      const score = Math.max(sz, sv, sr);
      this.parts[def.label] = { key: def.key, z, vz, roll, score, vzRel: dvz };
      if (score > best) {
        best = score;
        bestLabel = def.label;
        bestDir = sr >= sz && sr >= sv ? (droll > 0 ? 1 : droll < 0 ? -1 : 0) : (dz > 0 ? 1 : dz < 0 ? -1 : 0);
        bestZ = dz;
      }
    }
    const wholeScore = Math.max(
      Math.abs(s.comZ - this.ref.comZ) / 0.01,
      Math.abs(s.comVelZ) / 0.05,
      Math.abs(s.roll - this.ref.roll) / (1 / 57.3),
    );
    this.parts['body'] = { key: 'com', z: s.comZ, vz: s.comVelZ, roll: s.roll, score: wholeScore, vzRel: s.comVelZ };
    if (wholeScore > 1.2 && wholeScore > best * 1.15) {
      bestLabel = 'body';
      best = wholeScore;
      bestDir = Math.sign(s.comZ - this.ref.comZ) || Math.sign(s.roll - this.ref.roll);
    }
    s.dominantPart = best < 0.5 ? 'none' : bestLabel;
    s.partDirection = best < 0.5 ? 0 : bestDir;
    s.partScore = best;
    void bestZ;
  }

  private torsoRoll(): number {
    const body = this.world.body;
    const i = body.indexByKey.get('spine4') ?? body.indexByKey.get('spine3');
    if (i === undefined) return 0;
    const q = body.bodies[i]!.rotation();
    const ux = 2 * (q.x * q.y - q.w * q.z);
    const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
    const uz = 2 * (q.w * q.x + q.y * q.z);
    return Math.atan2(uz, Math.hypot(ux, uy));
  }
}
