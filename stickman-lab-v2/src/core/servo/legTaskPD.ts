/** 唯一的 Shank 关节角 PD：knee/1、foot/0、foot/2 直接追目标角，并含姿势软限位。 */
import { softJointLimit } from './softLimit';

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
  footZ: number;
  targetFootZ: number;
  footZRate: number;
  foot1Angle: number;
  targetFoot1: number;
  foot1Rate: number;

  knee1Angle: number;
  knee1Rate: number;
  knee2Angle: number;
  knee2Rate: number;
  targetKnee1: number;
  targetKnee2: number;
  knee1Lo: number; knee1Hi: number;
  foot0Lo: number; foot0Hi: number;
  foot2Lo: number; foot2Hi: number;
}

export interface ShankTaskOutput {
  taskLat: number;
  taskSag: number;
  normal: number;
  copZTarget: number;
  copXTarget: number;
  kneeTau: number;       // knee/1
  footTau: number;       // foot/0
  foot1Tau: number;      // foot/1
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
  knee1Kp?: number;
  knee1Kd?: number;
  knee2Kp?: number;
  knee2Kd?: number;
  foot0Kp?: number;
  foot0Kd?: number;
  footZKp?: number;
  footZKd?: number;
  foot2Kp?: number;
  foot2Kd?: number;
  foot1Kp?: number;
  foot1Kd?: number;
  softK?: number;
  softD?: number;
  softCap?: number;
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
    const kCap = this.opt.kneeCap ?? 60;
    const kSagCap = this.opt.kneeSagCap ?? 60;
    const fSagCap = this.opt.footSagCap ?? 60;
    const kSign = (this.opt.kneeSign ?? 1) < 0 ? -1 : 1;
    const kSupportN = this.opt.kSupportN ?? 0.15;
    const kCopZ = this.opt.kCopZ ?? 100;
    const kCopX = this.opt.kCopX ?? 100;
    const kCopB = this.opt.kCopB ?? 2;
    const footMin = Math.abs(this.opt.footMin ?? 0);
    const supportNCap = Math.abs(this.opt.supportNCap ?? 30);
    const fSign = (this.opt.footSign ?? 1) < 0 ? -1 : 1;
    const knee1Kp = this.opt.knee1Kp ?? 100;
    const knee1Kd = this.opt.knee1Kd ?? 8;
    const knee2Kp = this.opt.knee2Kp ?? 300;
    const knee2Kd = this.opt.knee2Kd ?? 20;
    const foot0Kp = this.opt.foot0Kp ?? 100;
    const foot0Kd = this.opt.foot0Kd ?? 8;
    const footZKp = this.opt.footZKp ?? 3000;
    const footZKd = this.opt.footZKd ?? 200;
    const foot2Kp = this.opt.foot2Kp ?? 200;
    const foot2Kd = this.opt.foot2Kd ?? 12;
    const foot1Kp = this.opt.foot1Kp ?? 80;
    const foot1Kd = this.opt.foot1Kd ?? 6;
    const softK = this.opt.softK ?? 1200;
    const softD = this.opt.softD ?? 30;
    const softCap = this.opt.softCap ?? 60;
    const eLat = s.tilt - s.targetTilt;
    const eSag = s.sag - s.targetSag;
    const uLat = kp * eLat - kd * s.rateLat;
    const uSag = kpS * eSag - kdS * s.rateSag;
    const loaded = s.fz > 1;
    const contact = Math.max(0, Math.min(1, s.fz / Math.max(1, s.fzMin)));
    // 关节角 PD：膝/踝/脚直接追目标角，不再用小腿线当目标
    const kneeTau = loaded
      ? Math.max(-kCap, Math.min(kCap,
        -knee1Kp * (s.knee1Angle - s.targetKnee1) - knee1Kd * s.knee1Rate
        + softJointLimit(s.knee1Angle, s.knee1Rate, s.knee1Lo, s.knee1Hi, softK, softD, softCap)))
      : 0;
    const kneeSagTau = loaded
      ? Math.max(-kSagCap, Math.min(kSagCap, -knee2Kp * (s.knee2Angle - s.targetKnee2) - knee2Kd * s.knee2Rate))
      : 0;
    // CoP-first：踝力矩由 CoP 误差生成，再受接触余量限制
    const marginZ = Math.max(0, Math.min(s.copZ - s.copMin, s.copMax - s.copZ));
    const marginX = Math.max(0, Math.min(s.copX - s.copMinX, s.copMaxX - s.copX));
    const capZ = Math.min(fCap, Math.max(0, s.fz * marginZ * 0.8));
    const capX = Math.min(fSagCap, Math.max(0, s.fz * marginX * 0.8));
    const eN = (s.normalTarget ?? s.fz) - s.fz;
    const supportN = Math.max(-supportNCap, Math.min(supportNCap, kSupportN * eN));
    // 角度 PD 为主；CoP margin 只做安全限幅，不驱动踝
    const rawAngle0 = -foot0Kp * (s.foot0Angle - s.targetFoot0) - foot0Kd * s.foot0Rate
      - footZKp * (s.footZ - s.targetFootZ) - footZKd * s.footZRate
      + softJointLimit(s.foot0Angle, s.foot0Rate, s.foot0Lo, s.foot0Hi, softK, softD, softCap);
    const rawAngle2 = -foot2Kp * (s.foot2Angle - s.targetFoot2) - foot2Kd * s.foot2Rate + supportN
      + softJointLimit(s.foot2Angle, s.foot2Rate, s.foot2Lo, s.foot2Hi, softK, softD, softCap);
    const rawF0 = loaded ? Math.max(-capZ, Math.min(capZ, contact * rawAngle0)) : 0;
    const rawF2 = loaded ? Math.max(-capX, Math.min(capX, contact * rawAngle2)) : 0;
    const foot1Raw = loaded
      ? Math.max(-fCap, Math.min(fCap, -foot1Kp * (s.foot1Angle - s.targetFoot1) - foot1Kd * s.foot1Rate
        + softJointLimit(s.foot1Angle, s.foot1Rate, s.foot0Lo, s.foot0Hi, softK, softD, softCap)))
      : 0;
    const key = s.sideSign < 0 ? -1 : 1;
    let st = this.footState.get(key);
    if (!st) { st = { f0: 0, f2: 0, n: 0 }; this.footState.set(key, st); }
    const lp = Math.max(0.01, Math.min(1, this.opt.footLp ?? 0.10));
    st.f0 += (rawF0 - st.f0) * lp;
    st.f2 += (rawF2 - st.f2) * lp;
    st.n += (supportN - st.n) * lp;
    if (loaded && footMin > 0 && Math.abs(st.f0) > 1e-6) {
      const sg = st.f0 >= 0 ? 1 : -1;
      st.f0 = sg * Math.max(footMin, Math.abs(st.f0));
    }
    const footTau = st.f0;
    const foot1Tau = foot1Raw;
    const footSagTau = st.f2;
    return {
      taskLat: uLat, taskSag: uSag, normal: Math.max(1, s.fz),
      copZTarget: s.baseCopZ, copXTarget: s.baseCopX,
      kneeTau, footTau, foot1Tau, kneeSagTau, footSagTau, supportTau: 0,
      verticalForce: 0, normalNeed: s.fz, marginZ: 0, marginX: 0,
      contact: loaded ? 1 : 0, ankleCapZ: fCap, ankleCapX: fSagCap,
    };
  }

}
