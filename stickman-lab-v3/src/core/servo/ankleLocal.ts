/**
 * ankleLocal.ts —— 踝局部支撑+回正的单输出目标。
 *
 * 基础支撑和 XCoM 回正共用一个 ankle qRef；
 * 不新增力矩写手，不产生 base/righting 对拉。
 */
export interface AnkleLocalInput {
  p: number;
  comX: number;
  comVX: number;
  comY: number;
  targetX: number;
}

const num = (k: string, d: number): number => {
  const v = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[k]);
  return Number.isFinite(v) ? v : d;
};

const smooth = (u: number): number => u * u * (3 - 2 * u);
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function ankleLocalTarget(i: AnkleLocalInput): number {
  const omega = Math.sqrt(9.81 / Math.max(0.3, i.comY));
  const xcom = i.comX + i.comVX / omega;
  const eX = i.targetX - xcom;
  const env = Math.min(1, i.p / 0.25) * Math.min(1, (1 - i.p) / 0.2);
  const base = num('ANK_ACT', 0.70) * env;
  const rawRight = num('ANK_K', 20) * eX;
  const backScale = Math.max(0, num('SQC_ANKLE_BACK_SCALE', 1));
  const right = rawRight >= 0 ? rawRight : rawRight * backScale;
  return clamp(base + right, -0.05, num('ANK_MAX', 0.90));
}
