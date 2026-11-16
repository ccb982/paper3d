/** 支撑命令层：只生成 knee2 目标与竖向支撑前馈。 */
export interface SupportPlanInput {
  knee2Base: number;
  fSupport: number;
  capacity: number;
  contact: boolean;
  fz: number;
  targetFz: number;
  supK?: number;
  supCap?: number;
}

export interface SupportPlan {
  knee2Target: number;
  supFf: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const num = (k: string, d: number): number => {
  const v = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[k]);
  return Number.isFinite(v) ? v : d;
};

export function planSupport(i: SupportPlanInput): SupportPlan {
  // 误差大时逐渐少用支撑（不是一刀切 0）：硬门在阈值附近会逐帧翻转，脚会抖。
  const capMin = Math.abs(num('SQC_SUP_CAP_MIN', 0.2));
  const gateOn = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SUP_CAP_GATE ?? '1') !== '0';
  const capFactor = i.contact && i.capacity > 0 && gateOn
    ? Math.max(capMin, Math.min(1, 1 - Math.max(0, Math.min(1, Math.abs(i.fz - i.targetFz) / Math.max(1, i.targetFz)) - 0.8) / 0.2))
    : (i.contact && i.capacity > 0 ? 1 : 0);
  const k2 = i.knee2Base + (i.capacity > 0 ? capFactor * clamp(i.fSupport * 0.0004, -0.15, 0.15) : 0);
  const supFf = clamp((i.supK ?? 0.2) * (i.targetFz - i.fz), -(i.supCap ?? 40), i.supCap ?? 40);
  return { knee2Target: k2, supFf };
}
