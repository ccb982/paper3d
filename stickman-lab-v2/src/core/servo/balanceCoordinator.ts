/** 统一平衡/姿态协调器：一个目标、一套状态、一套分配。
 *  纯函数；不写关节。squat 层根据 plan 分配踝/髋/背肌。
 */
export type BalanceMode = 'normal' | 'trunkRecover' | 'hipAssist' | 'fall';

export interface BalanceInput {
  comErr: number;
  comVel: number;
  trunkScore: number;
  copMargin: number;
  copLimit: number;
  kp: number;
  kd: number;
}

export interface BalancePlan {
  mode: BalanceMode;
  copDemand: number;
  copOffset: number;
  copResidual: number;
  hipShare: number;
  trunkScale: number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function planBalance(i: BalanceInput): BalancePlan {
  const demand = i.kp * i.comErr + i.kd * i.comVel;
  const offset = clamp(demand, -i.copLimit, i.copLimit);
  const residual = demand - offset;
  const trunkBig = i.trunkScore > 2;
  const copEdge = Math.abs(i.copMargin) > 0.04;
  const saturated = Math.abs(demand) > i.copLimit || copEdge;
  const mode: BalanceMode = trunkBig ? 'trunkRecover' : saturated ? 'hipAssist' : 'normal';
  const excess = Math.max(0, Math.abs(demand) - i.copLimit) / Math.max(1e-6, i.copLimit)
    + Math.max(0, Math.abs(i.copMargin) - 0.04) / 0.02;
  const hipShare = mode === 'hipAssist' ? clamp(excess, 0, 1) : 0;
  return {
    mode,
    copDemand: demand,
    copOffset: offset,
    copResidual: residual,
    hipShare,
    trunkScale: mode === 'hipAssist' ? 0.7 : 1,
  };
}
