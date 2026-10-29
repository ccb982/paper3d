/** 唯一的 Shank task PD：一个任务，Jᵀ 分给 knee/1 + foot/0 + CoP。 */

export interface ShankTaskInput {
  tilt: number;          // shank 相对 footUp
  targetTilt: number;    // 法庭释放时捕获一次
  rate: number;
  fz: number;
  copZ: number;
  baseCopZ: number;
  baseFz: number;
  ankleZ: number;
  copMin: number;
  copMax: number;
  sideSign: 1 | -1;   // 左 +1，右 -1（J 的镜像符号）
  comPredicted?: number;
}

export interface ShankTaskOutput {
  task: number;        // 小腿任务力 F_task
  normal: number;      // 脚底法向力 N
  copTarget: number;
  kneeTau: number;
  footTau: number;     // 踝转接力矩（foot/0）
}

export interface ShankTaskOpts {
  kp?: number;
  kd?: number;
  wKnee?: number;
  wCop?: number;
  kneeCap?: number;
  footCap?: number;
  kCop?: number;
  kCom?: number;
}

export class ShankTaskPD {
  constructor(private readonly opt: ShankTaskOpts = {}) {}
  step(s: ShankTaskInput): ShankTaskOutput {
    const kp = this.opt.kp ?? 30;
    const kd = this.opt.kd ?? 3;
    const wK = this.opt.wKnee ?? 0.6;
    const wC = this.opt.wCop ?? 1.0;
    const kCap = this.opt.kneeCap ?? 40;
    const fCap = this.opt.footCap ?? 20;
    const kCop = this.opt.kCop ?? 50;
    const kCom = this.opt.kCom ?? 0;

    const err = s.tilt - s.targetTilt;
    const task = kp * err - kd * s.rate;   // 小腿任务力
    const normal = Math.max(1, s.fz);        // 脚承重

    // 同一个 task 的 Jᵀ 分量，不是独立膝关节 PD
    // 静态标定：+knee 力矩使 tilt 增大（两侧同号）→ 负反馈
    const kneeTau = Math.max(-kCap, Math.min(kCap, -wK * task));

    // 脚 CoP 闭环：baseCoP 来自基础力，只加 ΔCoP
    const baseCop = s.baseCopZ;
    const baseFz = Math.max(1, s.baseFz);
    // foot/0 的 CoP 方向左右镜像
    const rawCop = baseCop + wC * kCop * s.sideSign * err + kCom * (s.comPredicted ?? 0);
    const copTarget = Math.max(s.copMin, Math.min(s.copMax,
      Math.max(baseCop - 0.05, Math.min(baseCop + 0.05, rawCop))));
    // 踝只转接：脚底法向力 N 乘 CoP 误差，不是独立 PD
    const footTau = s.fz > 1
      ? Math.max(-fCap, Math.min(fCap, normal * (copTarget - s.copZ)))
      : 0;

    return { task, normal, copTarget, kneeTau, footTau };
  }
}
