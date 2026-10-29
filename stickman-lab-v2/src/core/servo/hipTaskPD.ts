/** HipTaskPD：按论文的髋策略，做 COM/XCoM → 地面侧向力 → hip 力矩。
 *  不做 hip anchor 位置 PD。 */

export interface HipTaskInput {
  xcomZ: number;
  targetXcomZ: number;
  comVelZ: number;
  comAccZ: number;
  fzL: number;
  fzR: number;
  fzMin: number;
  copMarginZL: number;
  copMarginZR: number;
}

export interface HipTaskOutput {
  force: number;
  tauL: number;
  tauR: number;
  budgetL: number;
  budgetR: number;
  error: number;
}

export interface HipTaskOpts {
  kx?: number;
  dv?: number;
  ma?: number;
  lever?: number;
  cap?: number;
  budgetK?: number;
  pairSign?: number;
}

export class HipTaskPD {
  constructor(private readonly opt: HipTaskOpts = {}) {}
  step(s: HipTaskInput): HipTaskOutput {
    const kx = this.opt.kx ?? 2500;
    const dv = this.opt.dv ?? 180;
    const ma = this.opt.ma ?? 40;
    const lever = this.opt.lever ?? 0.18;
    const cap = this.opt.cap ?? 300;
    const budgetK = this.opt.budgetK ?? 0.8;
    const pairSign = (this.opt.pairSign ?? 1) < 0 ? -1 : 1;

    const error = s.xcomZ - s.targetXcomZ;
    // 期望地面侧向力：把 XCoM 拉回支撑中心，并抑制速度/加速度
    const force = -kx * error - dv * s.comVelZ - ma * s.comAccZ;
    const want = force * lever;

    const budgetL = Math.max(0, Math.min(cap, budgetK * Math.max(0, s.fzL) * Math.max(0, s.copMarginZL)));
    const budgetR = Math.max(0, Math.min(cap, budgetK * Math.max(0, s.fzR) * Math.max(0, s.copMarginZR)));

    // 左右髋/1 用反向配对，产生骨盆平移而不是同向扭转
    const tauL = Math.max(-budgetL, Math.min(budgetL, pairSign * want));
    const tauR = Math.max(-budgetR, Math.min(budgetR, -pairSign * want));

    return { force, tauL, tauR, budgetL, budgetR, error };
  }
}
