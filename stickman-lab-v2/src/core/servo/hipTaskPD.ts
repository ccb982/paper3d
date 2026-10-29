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
  onset: boolean;
  ttb: number;
  confidence: number;
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
  reserve?: number;
  pairSign?: number;
  leadK?: number;
  onsetK?: number;
}

export class HipTaskPD {
  constructor(private readonly opt: HipTaskOpts = {}) {}
  step(s: HipTaskInput): HipTaskOutput {
    const kx = this.opt.kx ?? 2500;
    const dv = this.opt.dv ?? 180;
    const ma = this.opt.ma ?? 40;
    const lever = this.opt.lever ?? 0.18;
    const cap = this.opt.cap ?? 300;
    const budgetK = this.opt.budgetK ?? 1.0;
    const reserve = Math.max(0, Math.min(1, this.opt.reserve ?? 0.6));
    const pairSign = (this.opt.pairSign ?? 1) < 0 ? -1 : 1;
    const leadK = this.opt.leadK ?? 2;
    const onsetK = this.opt.onsetK ?? 1;

    const error = s.xcomZ - s.targetXcomZ;
    // 期望地面侧向力：把 XCoM 拉回支撑中心，并抑制速度/加速度
    const force0 = -kx * error - dv * s.comVelZ - ma * s.comAccZ;
    // 高精度检测触发：onset/TTB/置信度越危险，越早放大髋力
    const lead = Math.max(0, Math.min(1, (0.5 - s.ttb) / 0.5));
    const urgency = Math.max(0, Math.min(1, s.confidence)) * (s.onset ? 1 : lead);
    const force = force0 * (1 + leadK * urgency + onsetK * (s.onset ? 1 : 0));
    const want = force * lever;

    const budgetL = Math.max(0, Math.min(cap, reserve * budgetK * Math.max(0, s.fzL) * Math.max(0, s.copMarginZL)));
    const budgetR = Math.max(0, Math.min(cap, reserve * budgetK * Math.max(0, s.fzR) * Math.max(0, s.copMarginZR)));

    // 左右髋/1 用反向配对，产生骨盆平移而不是同向扭转
    const tauL = Math.max(-budgetL, Math.min(budgetL, pairSign * want));
    const tauR = Math.max(-budgetR, Math.min(budgetR, -pairSign * want));

    return { force, tauL, tauR, budgetL, budgetR, error };
  }
}
