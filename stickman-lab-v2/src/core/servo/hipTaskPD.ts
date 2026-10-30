/** HipTaskPD：按论文的髋策略，做 COM/XCoM → 地面侧向力 → hip 力矩。
 *  不做 hip anchor 位置 PD。 */

export interface HipTaskInput {
  xcomZ: number;
  targetXcomZ: number;
  comVelZ: number;
  comAccZ: number;
  fzL: number;
  fzR: number;
  baseFzL: number;
  baseFzR: number;
  fzMin: number;
  copMarginZL: number;
  copMarginZR: number;
  hipYL: number;
  hipYR: number;
  loadDiff: number;   // fzL - fzR
  onset: boolean;
  ttb: number;
  confidence: number;
  leadT: number;
}

export interface HipTaskOutput {
  force: number;
  tauL: number;
  tauR: number;
  budgetL: number;
  budgetR: number;
  error: number;
  support: 'l' | 'r' | 'both';
  loadTarget: number;
  knee2L: number;
  knee2R: number;
  normalL: number;
  normalR: number;
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
  levelK?: number;
  kff?: number;
  preload?: number;
  supportGain?: number;
  otherGain?: number;
  knee2K?: number;
  knee2Cap?: number;
}

export class HipTaskPD {
  private support: 'l' | 'r' | 'both' = 'both';
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
    const levelK = this.opt.levelK ?? 0.03;
    const kff = this.opt.kff ?? 1200;
    const preload = this.opt.preload ?? 0.3;
    const supportGain = this.opt.supportGain ?? 1.0;
    const otherGain = this.opt.otherGain ?? 0.35;
    const knee2K = this.opt.knee2K ?? 0.5;
    const knee2Cap = this.opt.knee2Cap ?? 60;

    const error = s.xcomZ - s.targetXcomZ;
    const lead = Math.max(0, Math.min(1, (0.5 - s.ttb) / 0.5));
    const urgency = Math.max(0, Math.min(1, s.confidence)) * (s.onset ? 1 : lead);
    // 收紧 = 主动刚度/阻尼倍率，不是固定静态力矩
    const stiff = 1 + preload * (1 + urgency);
    // 期望地面侧向力：把 XCoM 拉回支撑中心，并抑制速度/加速度
    const feedback = -kx * stiff * error - dv * stiff * s.comVelZ - ma * s.comAccZ;
    const xhat = s.xcomZ + s.comVelZ * s.leadT + 0.5 * s.comAccZ * s.leadT * s.leadT;
    const ff = -kff * (xhat - s.targetXcomZ);
    const force0 = feedback + ff;
    const force = force0 * (1 + leadK * urgency + onsetK * (s.onset ? 1 : 0));
    const want = force * lever;

    // 预算在释放姿态上锁定；当前 CoP margin 只用于降额，不从零重算
    const footHalf = Math.max(0.01, Number((globalThis as { process?: { env?: Record<string,string> } }).process?.env?.SQC_COM_FOOT_HALF ?? 0.038));
    const baseBudgetL = reserve * budgetK * Math.max(0, s.baseFzL) * footHalf;
    const baseBudgetR = reserve * budgetK * Math.max(0, s.baseFzR) * footHalf;
    const loadL = s.baseFzL > 1 ? Math.min(1, Math.max(0, s.fzL / s.baseFzL)) : 0;
    const loadR = s.baseFzR > 1 ? Math.min(1, Math.max(0, s.fzR / s.baseFzR)) : 0;
    const budgetL = Math.max(0, Math.min(cap, baseBudgetL * loadL));
    const budgetR = Math.max(0, Math.min(cap, baseBudgetR * loadR));

    // 左右独立：common 做骨盆/COM 平移，diff 做骨盆水平/左右负载差
    // 选支撑侧：用 XCoM + 速度趋势，不能只等位置误差变大；小死区防抖
    // 不显式选支撑腿：两髋同时发力
    this.support = 'both';
    const totalFz = s.fzL + s.fzR;
    const loadTarget = 0;
    const loadErr = loadTarget - (s.fzL - s.fzR);

    const common = pairSign * want;
    // 负载差用 diff 转移：支撑侧目标 65~75%，另一侧 25~35%
    // 负载差方向：支撑侧要承重；符号取反后试
    const diff = 0;
    const total = budgetL + budgetR;
    // 支撑侧必须拿到主要力矩；非支撑侧只辅助，不反向主导
    const gL = 0.65;
    const gR = 0.65;
    const tauL = Math.max(-total, Math.min(total, (common + diff) * gL));
    const tauR = Math.max(-total, Math.min(total, (common - diff) * gR));

    const knee2Base = Math.max(-knee2Cap, Math.min(knee2Cap, knee2K * want));
    const normalL = 0.5 * totalFz;
    const normalR = totalFz - normalL;
    return { force, tauL, tauR, budgetL, budgetR, error, support: this.support, loadTarget, knee2L: knee2Base, knee2R: knee2Base, normalL, normalR };
  }
}
