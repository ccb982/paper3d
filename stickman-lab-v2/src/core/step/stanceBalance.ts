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
  /** ★ 稳定模式闭环增益（0=关）：躯干侧倾=物理质量块修重心 */
  stabKz: number;
  stabKx: number;
}
export const stanceTuning: StanceTuning = { counterKc: 0.25, stabKz: 1.4, stabKx: 1.4 };

/** 实测灵敏度：spine 侧倾(0/2 轴) → CoM 位移（m/rad；_probe-lean-sign） */
export const LEAN_SENS_Z = 0.30;    // lean0 正 → comZ 正
export const LEAN_SENS_X = -0.36;   // lean2 正 → comX 负

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

/**
 * ★ 稳定模式（Mouchnino 1996）：闭环躯干侧倾调重心——抬腿/站稳期间由动作主动写。
 * 输入：横向/矢状重心误差（实际−基准，米）；输出：spine1–3 的侧屈/前屈目标。
 * 传感灵敏度用 _probe-lean-sign 实测；限幅 ±0.15 rad 防过摆。
 */
export function leanRegulator(errZ: number, errX: number): { lean0: number; lean2: number } {
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  // 横向：comZ ≈ +LEAN_SENS_Z·lean0 → 反向驱动
  const lean0 = clamp(-stanceTuning.stabKz * errZ / LEAN_SENS_Z, -0.18, 0.18);
  // 矢状：comX ≈ +LEAN_SENS_X·lean2（负灵敏度）→ 反向驱动
  const lean2 = clamp(-stanceTuning.stabKx * errX / LEAN_SENS_X, -0.28, 0.28);   // 矢状权限加大（向后倒反复出现）
  return { lean0, lean2 };
}
