/** HipTaskPD：只追左右髋的位置，不产生总竖直力。
 *  侧向目标来自双脚支撑中心；x/y 来自释放姿态。
 *  只写 hip/1（额状骨盆），不写 hip/2（基础 pair 占用）。 */

export interface HipTarget {
  l: { x: number; y: number; z: number };
  r: { x: number; y: number; z: number };
}

export interface HipTaskInput {
  target: HipTarget;
  actualZ: { l: number; r: number };
  rateZ: { l: number; r: number };
  fz: { l: number; r: number };
  fzMin: number;
  copMarginZ: { l: number; r: number };
  accZ: number;   // 侧向加速度，中心也要抵消
  comPredZ: number;
  comVelZ: number;
}

export interface HipTaskOutput {
  tauL: number;
  tauR: number;
  errorL: number;
  errorR: number;
  budgetL: number;
  budgetR: number;
}

export interface HipTaskOpts {
  kp?: number;
  kd?: number;
  cap?: number;
  dead?: number;
  kAcc?: number;
  kPred?: number;
  kVel?: number;
  budgetK?: number;
}

export class HipTaskPD {
  constructor(private readonly opt: HipTaskOpts = {}) {}
  step(s: HipTaskInput): HipTaskOutput {
    const kp = this.opt.kp ?? 80;
    const kd = this.opt.kd ?? 8;
    const cap = this.opt.cap ?? 60;
    const dead = this.opt.dead ?? 0;
    const kAcc = this.opt.kAcc ?? 2;
    const kPred = this.opt.kPred ?? 0;
    const kVel = this.opt.kVel ?? 0;
    const budgetK = this.opt.budgetK ?? 0.8;
    const eL = s.target.l.z - s.actualZ.l;
    const eR = s.target.r.z - s.actualZ.r;
    // 强髋必须由脚底 N/CoP 预算封顶：不是有误差就无限出力
    const budgetL = Math.max(0, Math.min(cap, budgetK * s.fz.l * Math.max(0, s.copMarginZ.l)));
    const budgetR = Math.max(0, Math.min(cap, budgetK * s.fz.r * Math.max(0, s.copMarginZ.r)));
    const deadZ = (e: number): number => Math.abs(e) <= dead ? 0 : e - Math.sign(e) * dead;
    const accTau = -kAcc * s.accZ - kPred * s.comPredZ - kVel * s.comVelZ;
    const wantL = kp * deadZ(eL) - kd * s.rateZ.l + accTau;
    const wantR = kp * deadZ(eR) - kd * s.rateZ.r + accTau;
    const tauL = Math.max(-budgetL, Math.min(budgetL, wantL));
    const tauR = Math.max(-budgetR, Math.min(budgetR, wantR));
    return { tauL, tauR, errorL: eL, errorR: eR, budgetL, budgetR };
  }
}
