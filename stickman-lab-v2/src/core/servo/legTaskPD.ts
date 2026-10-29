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
  comY?: number;
  targetComY?: number;
  comYRate?: number;
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
  supportTau: number;    // 竖直支撑分量
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
  kCom?: number;
  kSupport?: number;
  dSupport?: number;
  supportCap?: number;
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
    const kCop = this.opt.kCop ?? 50;
    const kCopS = this.opt.kCopSag ?? kCop;
    const kCom = this.opt.kCom ?? 0;
    const kSupport = this.opt.kSupport ?? 30;
    const dSupport = this.opt.dSupport ?? 2;
    const supportCap = this.opt.supportCap ?? 60;

    // 一个 PD 的两个任务分量：侧向 + 矢状
    const errLat = s.tilt - s.targetTilt;
    const errSag = s.sag - s.targetSag;
    // Hof 2005 / Kuo 1995：把预测 CoM 误差并入同一个踝任务，不是另起一轨
    const taskLat = kp * errLat - kd * s.rateLat + kCom * (s.comPredicted ?? 0);
    const taskSag = kpS * errSag - kdS * s.rateSag;
    const normal = Math.max(1, s.fz);
    const supportTau = Math.max(-supportCap, Math.min(supportCap,
      kSupport * ((s.targetComY ?? s.comY ?? 0) - (s.comY ?? 0)) - dSupport * (s.comYRate ?? 0)));
    const load = Math.max(0, Math.min(1, (s.fz - s.fzMin) / Math.max(1, 0.25 * Math.max(1, s.fzMin))));
    const edgeZ = Math.max(0, Math.min(1, Math.min(s.copZ - s.copMin, s.copMax - s.copZ) / 0.012));
    const edgeX = Math.max(0, Math.min(1, Math.min(s.copX - s.copMinX, s.copMaxX - s.copX) / 0.015));
    const contact = load * edgeZ * edgeX;
    // 踝力矩只能用到 CoP 仍留在脚掌内的额度；到边缘就饱和，不继续滚脚
    const marginZ = Math.max(0, Math.min(s.copZ - s.copMin, s.copMax - s.copZ));
    const marginX = Math.max(0, Math.min(s.copX - s.copMinX, s.copMaxX - s.copX));
    const ankleCapZ = Math.min(fCap, normal * marginZ * 0.8);
    const ankleCapX = Math.min(fSagCap, normal * marginX * 0.8);

    // 膝：Jᵀ 分量，不是独立关节 PD
    const kneeTau = Math.max(-kCap, Math.min(kCap, -wK * taskLat));
    // 静态标定：+knee/2 使矢状 sag 减小 → 正反馈符号
    const kneeSagTau = Math.max(-kSagCap, Math.min(kSagCap, wKS * taskSag));

    // 踝不是 CoP 推手：踝只负责把小腿转回目标方向
    // 脚不主动滚边；脚只靠基础法向力压地提供摩擦/承重
    const footTau = s.fz > 1
      ? Math.max(-ankleCapZ, Math.min(ankleCapZ, contact * s.sideSign * wA * taskLat))
      : 0;
    const footSagTau = s.fz > 1
      ? Math.max(-ankleCapX, Math.min(ankleCapX, contact * -wAS * taskSag))
      : 0;
    // 只为回读保留；不再拿它推动脚
    const copZTarget = s.copZ;
    const copXTarget = s.copX;

    return { taskLat, taskSag, normal, copZTarget, copXTarget, kneeTau, footTau, kneeSagTau, footSagTau, supportTau };
  }
}
