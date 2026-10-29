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
    const wK = this.opt.wKnee ?? 0.6;
    const wKS = this.opt.wKneeSag ?? wK;
    const wA = this.opt.wAnkle ?? 0.5;
    const wAS = this.opt.wAnkleSag ?? wA;
    const wC = this.opt.wCop ?? 1.0;
    const wCS = this.opt.wCopSag ?? wC;
    const kCap = this.opt.kneeCap ?? 40;
    const fCap = this.opt.footCap ?? 20;
    const kSagCap = this.opt.kneeSagCap ?? kCap;
    const fSagCap = this.opt.footSagCap ?? fCap;
    const kCop = this.opt.kCop ?? 0.02;
    const ankleKp = this.opt.ankleKp ?? 8;
    const ankleKd = this.opt.ankleKd ?? 1;
    const ankleRight = this.opt.ankleRight ?? 1;
    const ankleRightSag = this.opt.ankleRightSag ?? -1;
    const ankleKpSag = this.opt.ankleKpSag ?? 40;
    const ankleKdSag = this.opt.ankleKdSag ?? 2;   // m/rad
    const kCopS = this.opt.kCopSag ?? kCop;
    const copUse = Math.max(0.05, Math.min(0.9, this.opt.copUse ?? 0.35));
    const copSign = (this.opt.copSign ?? 1) < 0 ? -1 : 1;
    const kCom = this.opt.kCom ?? 0;
    const footSign = (this.opt.footSign ?? 1) < 0 ? -1 : 1;
    const kneeSign = (this.opt.kneeSign ?? 1) < 0 ? -1 : 1;
    const kSupport = this.opt.kSupport ?? 30;
    const kVert = this.opt.kVert ?? 0.1;
    const dSupport = this.opt.dSupport ?? 2;
    const supportCap = this.opt.supportCap ?? 60;

    // 一个 PD 的两个任务分量：侧向 + 矢状
    const errLat = s.tilt - s.targetTilt;
    const errSag = s.sag - s.targetSag;
    // Hof 2005 / Kuo 1995：把预测 CoM 误差并入同一个踝任务，不是另起一轨
    const taskLat = kp * errLat - kd * s.rateLat + kCom * (s.comPredicted ?? 0);
    // 先只按静态方向：eS>0 时必须 +knee/2；阻尼不再抢符号
    const taskSag = kpS * errSag;
    const normal = Math.max(1, s.fz);
    // 矢状任务力对应的法向分量：不直接写 N，交给膝/基础支撑执行
    const verticalForce = Math.abs(taskSag) / 0.18;
    const normalNeed = Math.max(0, s.baseFz + verticalForce);
    const supportTau = Math.max(-supportCap, Math.min(supportCap,
      -kSupport * ((s.targetComY ?? s.comY ?? 0) - (s.comY ?? 0))
      - dSupport * (s.comYRate ?? 0) + kVert * verticalForce));
    const load = Math.max(0, Math.min(1, (s.fz - s.fzMin) / Math.max(1, 0.25 * Math.max(1, s.fzMin))));
    const edgeZ = Math.max(0, Math.min(1, Math.min(s.copZ - s.copMin, s.copMax - s.copZ) / 0.012));
    const edgeX = Math.max(0, Math.min(1, Math.min(s.copX - s.copMinX, s.copMaxX - s.copX) / 0.015));
    const contactZ = load * edgeZ;
    const contactX = load * edgeX;
    // 踝力矩只能用到 CoP 仍留在脚掌内的额度；到边缘就饱和，不继续滚脚
    const marginZ = Math.max(0, Math.min(s.copZ - s.copMin, s.copMax - s.copZ));
    const marginX = Math.max(0, Math.min(s.copX - s.copMinX, s.copMaxX - s.copX));
    const ankleShare = Math.max(0, Math.min(1, s.ankleShare ?? 1));
    const ankleCapZ = Math.min(fCap, normal * marginZ * 0.8 * ankleShare);
    const ankleCapX = Math.min(fSagCap, normal * marginX * 0.8 * ankleShare);

    // 膝：Jᵀ 分量，不是独立关节 PD
    // 实测 dTilt/dTau < 0（左右一致）：e>0 要正力矩
    const kneeTau = Math.max(-kCap, Math.min(kCap, kneeSign * wK * taskLat));
    // 静态标定：+knee/2 使矢状 sag 减小 → 正反馈符号
    const kneeSagTau = Math.max(-kSagCap, Math.min(kSagCap, wKS * taskSag));

    // 踝不是 CoP 推手：踝只负责把小腿转回目标方向
    // 脚不主动滚边；脚只靠基础法向力压地提供摩擦/承重
    // 直接把踝力矩换算成可用 CoP 位移：用满脚掌余量，但到边缘自动缩回
    const demandZ = Math.max(-marginZ * copUse, Math.min(marginZ * copUse, copSign * wC * kCop * errLat));
    const demandX = wAS <= 0 ? 0 : Math.max(-marginX * copUse, Math.min(marginX * copUse, wCS * kCopS * errSag));
    // 真正闭环到实测 CoP，不是只拿 baseCoP 开环算力矩
    const copZTarget = s.baseCopZ + demandZ;
    const copXTarget = s.baseCopX + demandX;
    // 踝角 PD 主导；CoP 只做安全上限
    const footTau = s.fz > 1
      ? Math.max(-ankleCapZ, Math.min(ankleCapZ,
        contactZ * (-ankleKp * (s.foot0Angle - (s.targetFoot0 + ankleRight * errLat)) - ankleKd * s.foot0Rate)))
      : 0;
    // 目标姿态是释放捕获的 foot/2 角；CoP 只做安全上限
    const footSagTau = s.fz > 1
      ? Math.max(-ankleCapX, Math.min(ankleCapX,
        contactX * (-ankleKpSag * (s.foot2Angle - (s.targetFoot2 + ankleRightSag * errSag)) - ankleKdSag * s.foot2Rate)))
      : 0;

    return { taskLat, taskSag, normal, copZTarget, copXTarget, kneeTau, footTau, kneeSagTau, footSagTau, supportTau, verticalForce, normalNeed, marginZ, marginX, contact: contactZ, ankleCapZ, ankleCapX };
  }
}
