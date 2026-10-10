/**
 * 支撑期重心管理（迈步原语 A/B 相）——"动作主动写进提案的重心目标"，不是伺服找补。
 *
 * - transferTarget：重心转移轨线 = 弹道段 + 精靠段（Mouchnino 1992 的两段转移；
 *   Rogers & Pai 1990 速度策略：快速段主导）；
 * - counterbalanceZ：稳定模式=**重心侧移补偿**（Mouchnino 1996）：抬腿把质量带走多少、
 *   comZ 目标反向补多少（人类用躯干侧倾实现；我们直接写 CoM 目标）。
 *   耦合增益 counterKc 默认 0（先保持既有行为，实测调参后启用）。
 */
export interface StanceTuning {
  /** 配重耦合增益（前馈；0=关，实测无增益已留档） */
  counterKc: number;
}
export const stanceTuning: StanceTuning = { counterKc: 0.25 };

/** A 相转移目标：粗移 0.08 m/s 到 80%，再精靠 0.03 m/s 收尾 */
export function transferTarget(t: number, target: number): number {
  const dir = Math.sign(target) || 1;
  const mag = Math.min(Math.abs(target), 0.08 * t);
  const m = Math.abs(mag) >= 0.8 * Math.abs(target)
    ? Math.min(Math.abs(target), mag + 0.03 * t)
    : mag;
  return dir * m;
}

/** 稳定模式：摆腿质量侧移 → comZ 反向补偿项（加到支撑脚目标上） */
export function counterbalanceZ(footZ: number, restZ: number): number {
  return stanceTuning.counterKc * (footZ - restZ);
}
