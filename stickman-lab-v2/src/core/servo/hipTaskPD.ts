/** HipTaskPD：按论文的髋策略，做 COM/XCoM → 地面侧向力 → hip 力矩。
 *  不做 hip anchor 位置 PD。 */

export interface HipTaskInput {
  xcomZ: number;
  targetXcomZ: number;
  comVelZ: number;
  comAccZ: number;
  comY: number;
  targetComY: number;
  comVelY: number;
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
  knee2AngleL: number;
  knee2AngleR: number;
  knee2RateL: number;
  knee2RateR: number;
  targetKnee2L: number;
  targetKnee2R: number;
  hip0AngleL: number;
  hip0AngleR: number;
  hip0RateL: number;
  hip0RateR: number;
  targetHip0L: number;
  targetHip0R: number;
  hipRoll: number;
  hipRollRate: number;
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
  knee2Kp?: number;
  knee2Kd?: number;
  knee2Cap?: number;
  kSupportY?: number;
  dSupportY?: number;
  supportYCap?: number;
  knee2HeightK?: number;
  knee2HeightD?: number;
  knee2HeightCap?: number;
  hip0Kp?: number;
  hip0Kd?: number;
  hip0Cap?: number;
  hipLevelK?: number;
  hipLevelD?: number;
  hipLevelCap?: number;
}

export class HipTaskPD {
  private support: 'l' | 'r' | 'both' = 'both';
  private readonly knee2Lp = new Map<1 | -1, number>();
  private readonly knee2VelLp = new Map<1 | -1, number>();
  constructor(private readonly opt: HipTaskOpts = {}) {}
  step(s: HipTaskInput): HipTaskOutput {
    const kx = this.opt.kx ?? 2500;
    const dv = this.opt.dv ?? 180;
    const ma = this.opt.ma ?? 40;
    const lever = this.opt.lever ?? 0.90;
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
    const knee2Kp = this.opt.knee2Kp ?? 200;
    const knee2Kd = this.opt.knee2Kd ?? 12;
    const knee2Cap = this.opt.knee2Cap ?? 45;
    const kSupportY = this.opt.kSupportY ?? 0;
    const dSupportY = this.opt.dSupportY ?? 0;
    const supportYCap = this.opt.supportYCap ?? 60;
    const knee2HeightK = this.opt.knee2HeightK ?? 4;
    const knee2HeightD = this.opt.knee2HeightD ?? 0.3;
    const knee2HeightCap = this.opt.knee2HeightCap ?? 0.45;
    const hip0Kp = this.opt.hip0Kp ?? 120;
    const hip0Kd = this.opt.hip0Kd ?? 10;
    const hip0Cap = this.opt.hip0Cap ?? 40;
    const hipLevelK = this.opt.hipLevelK ?? 300;
    const hipLevelD = this.opt.hipLevelD ?? 20;
    const hipLevelCap = this.opt.hipLevelCap ?? 30;

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
    // 按承重分配髋/0，不用固定 0.65；每侧各自受自己的 budget 限制
    const sumFz = Math.max(1e-6, s.fzL + s.fzR);
    const rawL = Math.max(0, s.fzL) / sumFz;
    const rawR = Math.max(0, s.fzR) / sumFz;
    const wL = 0.35 + 0.65 * rawL;
    const wR = 0.35 + 0.65 * rawR;
    const h0L = Math.max(-hip0Cap, Math.min(hip0Cap, -hip0Kp * (s.hip0AngleL - s.targetHip0L) - hip0Kd * s.hip0RateL));
    const h0R = Math.max(-hip0Cap, Math.min(hip0Cap, -hip0Kp * (s.hip0AngleR - s.targetHip0R) - hip0Kd * s.hip0RateR));
    // 骨盆水平：左右髋 anchor 高度差 → 差分 hip/0
    const level = Math.max(-hipLevelCap, Math.min(hipLevelCap, -hipLevelK * s.hipRoll - hipLevelD * s.hipRollRate));
    const tauL = Math.max(-budgetL, Math.min(budgetL, (common + diff) * wL + h0L + level));
    const tauR = Math.max(-budgetR, Math.min(budgetR, (common - diff) * wR + h0R - level));

    // 膝/2 是髋-大腿链的矢状承重轴：角度 PD + COM 高度承重项
    const eY = s.comY - s.targetComY;
    const supportY = Math.max(-supportYCap, Math.min(supportYCap, -kSupportY * eY - dSupportY * s.comVelY));
    const eHipY = s.targetComY - s.comY;   // 髋低于目标时为正
    const heightBias = Math.max(-knee2HeightCap, Math.min(knee2HeightCap, knee2HeightK * eHipY - knee2HeightD * s.comVelY));
    const k2TargetL = s.targetKnee2L + heightBias;
    const k2TargetR = s.targetKnee2R + heightBias;
    const vlPrevL = this.knee2VelLp.get(-1) ?? 0;
    const vlPrevR = this.knee2VelLp.get(1) ?? 0;
    const vL = vlPrevL + (s.knee2RateL - vlPrevL) * 0.40;
    const vR = vlPrevR + (s.knee2RateR - vlPrevR) * 0.40;
    this.knee2VelLp.set(-1, vL);
    this.knee2VelLp.set(1, vR);
    const k2RawL = s.fzL > 1
      ? Math.max(-knee2Cap, Math.min(knee2Cap, -knee2Kp * (s.knee2AngleL - k2TargetL) - knee2Kd * vL + supportY))
      : 0;
    const k2RawR = s.fzR > 1
      ? Math.max(-knee2Cap, Math.min(knee2Cap, -knee2Kp * (s.knee2AngleR - k2TargetR) - knee2Kd * vR + supportY))
      : 0;
    const k2Lp = 0.60;
    const prevL = this.knee2Lp.get(-1) ?? 0;
    const prevR = this.knee2Lp.get(1) ?? 0;
    let knee2L = prevL + (k2RawL - prevL) * k2Lp;
    let knee2R = prevR + (k2RawR - prevR) * k2Lp;
    const slewK2 = 30;
    knee2L = prevL + Math.max(-slewK2, Math.min(slewK2, knee2L - prevL));
    knee2R = prevR + Math.max(-slewK2, Math.min(slewK2, knee2R - prevR));
    this.knee2Lp.set(-1, knee2L);
    this.knee2Lp.set(1, knee2R);
    const normalL = 0.5 * totalFz;
    const normalR = totalFz - normalL;
    return { force, tauL, tauR, budgetL, budgetR, error, support: this.support, loadTarget, knee2L, knee2R, normalL, normalR };
  }
}
