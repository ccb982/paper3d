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
  kSupport?: number;
  dSupport?: number;
  supportCap?: number;
  kVert?: number;
}

export class ShankTaskPD {
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
    const fSign = (this.opt.footSign ?? 1) < 0 ? -1 : 1;
    const eLat = s.tilt - s.targetTilt;
    const eSag = s.sag - s.targetSag;
    const uLat = kp * eLat - kd * s.rateLat;
    const uSag = kpS * eSag - kdS * s.rateSag;
    const loaded = s.fz > 1;
    const footTau = loaded ? Math.max(-fCap, Math.min(fCap, fSign * wF * uLat)) : 0;
    const kneeTau = loaded ? Math.max(-kCap, Math.min(kCap, kSign * wK * uLat)) : 0;
    // 矢状踝：目标角直接 PD；不做 CoP 预算
    const footSagTau = loaded ? Math.max(-fSagCap, Math.min(fSagCap, wS * (-kpS * eSag - kdS * s.rateSag))) : 0;
    return {
      taskLat: uLat, taskSag: uSag, normal: Math.max(1, s.fz),
      copZTarget: s.baseCopZ, copXTarget: s.baseCopX,
      kneeTau, footTau, kneeSagTau: 0, footSagTau, supportTau: 0,
      verticalForce: 0, normalNeed: s.fz, marginZ: 0, marginX: 0,
      contact: loaded ? 1 : 0, ankleCapZ: fCap, ankleCapX: fSagCap,
    };
  }

}
