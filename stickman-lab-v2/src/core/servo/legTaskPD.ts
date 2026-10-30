/** 唯一的 Shank task PD：矢状 + 侧向两个分量，同一个任务力分配。 */

export interface ShankTaskInput {
  tilt: number;          // 侧向 shank 相对 footUp
  targetTilt: number;    // 侧向目标（0）
  rateLat: number;

  sag: number;           // 矢状 shank 相对 footUp
  targetSag: number;     // 释放时确定，左右同一个
  rateSag: number;

  fz: number;
  fzMin: number;
  baseFz: number;
  normalTarget: number;

  copZ: number;
  baseCopZ: number;
  copMin: number;
  copMax: number;

  copX: number;
  baseCopX: number;
  copMinX: number;
  copMaxX: number;

  sideSign: 1 | -1;
  comPredicted?: number;
  ankleShare?: number;
  comY?: number;
  targetComY?: number;
  comYRate?: number;
  foot0Angle: number;
  foot2Angle: number;
  targetFoot0: number;
  targetFoot2: number;
  foot0Rate: number;
  foot2Rate: number;
}

export interface ShankTaskOutput {
  taskLat: number;
  taskSag: number;
  normal: number;
  copZTarget: number;
  copXTarget: number;
  kneeTau: number;       // knee/1
  footTau: number;       // foot/0
  kneeSagTau: number;    // knee/2
  footSagTau: number;    // foot/2
  supportTau: number;
  verticalForce: number;
  normalNeed: number;
  marginZ: number;
  marginX: number;
  contact: number;
  ankleCapZ: number;
  ankleCapX: number;    // 竖直支撑分量
}

export interface ShankTaskOpts {
  kp?: number;
  kd?: number;
  kpSag?: number;
  kdSag?: number;
  wKnee?: number;
  wAnkle?: number;
  wAnkleSag?: number;
  wCop?: number;
  wKneeSag?: number;
  wCopSag?: number;
  kneeCap?: number;
  footCap?: number;
  kneeSagCap?: number;
  footSagCap?: number;
  kCop?: number;
  kCopSag?: number;
  ankleKp?: number;
  ankleKd?: number;
  ankleRight?: number;
  ankleRightSag?: number;
  ankleKpSag?: number;
  ankleKdSag?: number;
  sagAssistLat?: number;
  copUse?: number;
  copSign?: number;
  kCom?: number;
  footSign?: number;
  kneeSign?: number;
  kSupportN?: number;
  kCopZ?: number;
  kCopX?: number;
  kCopB?: number;
  footMin?: number;
  supportNCap?: number;
  kSupport?: number;
  dSupport?: number;
  supportCap?: number;
  kVert?: number;
  footLp?: number;
}

export class ShankTaskPD {
  private readonly footState = new Map<1 | -1, { f0: number; f2: number; n: number }>();
  constructor(private readonly opt: ShankTaskOpts = {}) {}
  step(s: ShankTaskInput): ShankTaskOutput {
    const kp = this.opt.kp ?? 30;
    const kd = this.opt.kd ?? 3;
    const kpS = this.opt.kpSag ?? kp;
    const kdS = this.opt.kdSag ?? kd;
    const wK = this.opt.wKnee ?? 1.0;
    const wF = this.opt.wAnkle ?? 1.0;
    const wS = this.opt.wAnkleSag ?? 1.0;
    const fCap = this.opt.footCap ?? 40;
    const kCap = this.opt.kneeCap ?? 40;
    const fSagCap = this.opt.footSagCap ?? 60;
    const kSign = (this.opt.kneeSign ?? 1) < 0 ? -1 : 1;
    const kSupportN = this.opt.kSupportN ?? 0.15;
    const kCopZ = this.opt.kCopZ ?? 100;
    const kCopX = this.opt.kCopX ?? 100;
    const kCopB = this.opt.kCopB ?? 2;
    const footMin = Math.abs(this.opt.footMin ?? 0);
    const supportNCap = Math.abs(this.opt.supportNCap ?? 30);
    const fSign = (this.opt.footSign ?? 1) < 0 ? -1 : 1;
    const eLat = s.tilt - s.targetTilt;
    const eSag = s.sag - s.targetSag;
    const uLat = kp * eLat - kd * s.rateLat;
    const uSag = kpS * eSag - kdS * s.rateSag;
    const loaded = s.fz > 1;
    const contact = Math.max(0, Math.min(1, s.fz / Math.max(1, s.fzMin)));
    const kneeTau = loaded ? Math.max(-kCap, Math.min(kCap, kSign * wK * uLat)) : 0;
    // CoP-first：踝力矩由 CoP 误差生成，再受接触余量限制
    const marginZ = Math.max(0, Math.min(s.copZ - s.copMin, s.copMax - s.copZ));
    const marginX = Math.max(0, Math.min(s.copX - s.copMinX, s.copMaxX - s.copX));
    const capZ = Math.min(fCap, Math.max(0, s.fz * marginZ * 0.8));
    const capX = Math.min(fSagCap, Math.max(0, s.fz * marginX * 0.8));
    const eN = (s.normalTarget ?? s.fz) - s.fz;
    const supportN = Math.max(-supportNCap, Math.min(supportNCap, kSupportN * eN));
    // 角度 PD 为主；CoP margin 只做安全限幅，不驱动踝
    const rawAngle0 = fSign * wF * uLat;
    const rawAngle2 = wS * (-kpS * eSag - kdS * s.rateSag) + supportN;
    let rawF0 = loaded ? Math.max(-capZ, Math.min(capZ, contact * rawAngle0)) : 0;
    if (loaded && footMin > 0 && Math.abs(rawF0) > 1e-6) {
      const sg = rawF0 >= 0 ? 1 : -1;
      rawF0 = sg * Math.max(footMin, Math.abs(rawF0));
    }
    const rawF2 = loaded ? Math.max(-capX, Math.min(capX, contact * rawAngle2)) : 0;
    const key = s.sideSign < 0 ? -1 : 1;
    let st = this.footState.get(key);
    if (!st) { st = { f0: 0, f2: 0, n: 0 }; this.footState.set(key, st); }
    const lp = Math.max(0.01, Math.min(1, this.opt.footLp ?? 0.10));
    st.f0 += (rawF0 - st.f0) * lp;
    st.f2 += (rawF2 - st.f2) * lp;
    st.n += (supportN - st.n) * lp;
    const footTau = st.f0;
    const footSagTau = st.f2;
    return {
      taskLat: uLat, taskSag: uSag, normal: Math.max(1, s.fz),
      copZTarget: s.baseCopZ, copXTarget: s.baseCopX,
      kneeTau, footTau, kneeSagTau: 0, footSagTau, supportTau: 0,
      verticalForce: 0, normalNeed: s.fz, marginZ: 0, marginX: 0,
      contact: loaded ? 1 : 0, ankleCapZ: fCap, ankleCapX: fSagCap,
    };
  }

}
