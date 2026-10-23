/** 统一平衡分配器（QP 风格）：CoM / HAT 任务 + 执行器 cap。
 *  当前是标量加权 QP 的首版：先满足 HAT，再在 cap 内分 CoM 残差。
 *  不直接写关节，只输出 ua/uh/ub 与 residual，供 squat 层映射。
 */
export interface QpInput {
  comDemand: number;   // m/s^2 等效
  hatDemand: number;   // rad 等效
  copCap: number;      // m
  hipCap: number;      // N·m
  trunkCap: number;    // N·m
  wa?: number;
  wh?: number;
  wb?: number;
}

export interface QpOutput {
  ua: number;
  uh: number;
  ub: number;
  residual: number;
  cost: number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function solveBalanceQp(i: QpInput): QpOutput {
  const wa = Math.max(1e-3, i.wa ?? 4);
  const wh = Math.max(1e-3, i.wh ?? 1);
  const wb = Math.max(1e-3, i.wb ?? 1.5);
  // 先做 HAT 任务（用户优先上身），再在剩余 CoM 中分踝/髋
  const ub = clamp(i.hatDemand, -i.trunkCap, i.trunkCap);
  const rem = i.comDemand - ub * 0.25;
  const ankleShare = wh / (wa + wh);
  const ua0 = rem * ankleShare;
  const ua = clamp(ua0, -i.copCap, i.copCap);
  const uh = clamp(rem - ua, -i.hipCap, i.hipCap);
  const residual = rem - ua - uh;
  const cost = wa * ua * ua + wh * uh * uh + wb * ub * ub;
  return { ua, uh, ub, residual, cost };
}
