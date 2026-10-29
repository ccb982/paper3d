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
    const levelK = this.opt.levelK ?? 0.01;
    const kff = this.opt.kff ?? 1200;
    const preload = this.opt.preload ?? 0.3;

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
    const common = pairSign * want;
    const diff = Math.max(-1, Math.min(1, (s.fzL - s.fzR) * levelK));
    const total = budgetL + budgetR;
    const tauL = Math.max(-total, Math.min(total, common + diff));
    const tauR = Math.max(-total, Math.min(total, common - diff));

    return { force, tauL, tauR, budgetL, budgetR, error };
  }
}
