/**
 * Fz 预算（唯一来源）：双支撑时左右法向力目标。
 *
 * 论文依据：
 *   Winter 1995, Gait & Posture 3:193-214
 *     - 双足左右并排站立时，M/L 平衡由 hip load/unload 完成；
 *     - 竖直力 5% 的波动 ≈ 1 cm 的 CoP_ML 位移（约 40 cm 站距）。
 *   MacKinnon & Winter 1993, J Biomech 26:633-644
 *     - 额状面支撑/卸载与髋外展/内收。
 *   Bonnet et al. 2014, J Biomech 47:1603-1608
 *     - 体重分配与 CoP 位置共同控制 M/L 站立。
 *   Hof 2005 / Kuo 1995
 *     - XCoM = CoM + CoMv/ω，作为期望 CoP 的捕获点。
 *
 * 几何关系：
 *   z_cop = (FzL·zL + FzR·zR) / (FzL+FzR)
 *   ΔFz  = FzL − FzR
 *   z_cop − z_mid = (ΔFz / FzTotal) · (zL − zR)/2
 *   ⇒ ΔFz = 2·FzTotal·(z_cop* − z_mid) / (zL − zR)
 */
import type { World } from '../world';

export interface FzBudgetInput {
  fzTotal: number;
  /** 名义总重（mass·g）；预算用它，避免"目标追测量"的内环 */
  fzNominal: number;
  comZ: number;
  comVZ: number;
  comTargetZ: number;
  comY: number;
  zL: number;
  zR: number;
  contactL: boolean;
  contactR: boolean;
  copValidL: boolean;
  copValidR: boolean;
  dt: number;
}

export interface FzBudgetOutput {
  fzLTarget: number;
  fzRTarget: number;
  delta: number;
  valid: boolean;
}

interface BudgetState { delta: number }
const _state = new WeakMap<World, BudgetState>();

const num = (k: string, d: number): number => {
  const v = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[k]);
  return Number.isFinite(v) ? v : d;
};
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function resetFzBudget(w: World): void { _state.delete(w); }

export function computeFzBudget(w: World, i: FzBudgetInput): FzBudgetOutput {
  const g = 9.81;
  const nominal = i.fzNominal > 1 ? i.fzNominal : i.fzTotal;
  if (String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_FZ_BUDGET_ON ?? '1') === '0') {
    const half = nominal * 0.5;
    _state.set(w, { delta: 0 });
    return { fzLTarget: half, fzRTarget: half, delta: 0, valid: false };
  }
  const both = i.contactL && i.contactR;
  const valid = both && i.copValidL && i.copValidR && Math.abs(i.zL - i.zR) > 0.05 && i.fzTotal > 1;
  if (!valid) {
    // 单支撑：承重脚拿全部；无接触：均分（预载/悬空）
    const fzL = i.contactL && !i.contactR ? nominal : (!i.contactL && i.contactR ? 0 : nominal * 0.5);
    const fzR = i.contactR && !i.contactL ? nominal : (!i.contactR && i.contactL ? 0 : nominal * 0.5);
    _state.set(w, { delta: fzL - fzR });
    return { fzLTarget: fzL, fzRTarget: fzR, delta: fzL - fzR, valid: false };
  }

  const comY = Math.max(0.3, i.comY);
  const omega = Math.sqrt(g / comY);
  const kCop = num('SQC_FZ_COP_KP', 0.5);
  const xcomZ = i.comZ + i.comVZ / omega;
  const zMid = 0.5 * (i.zL + i.zR);
  const margin = Math.abs(num('SQC_FZ_COP_MARGIN', 0.06));
  const zLow = Math.min(i.zL, i.zR) - margin;
  const zHigh = Math.max(i.zL, i.zR) + margin;
  const copZTarget = clamp(xcomZ + kCop * (i.comZ - i.comTargetZ), zLow, zHigh);

  const dz = i.zL - i.zR;
  const copDead = Math.abs(num('SQC_FZ_COP_DEAD', 0.006));
  const eCop = copZTarget - zMid;
  const eCopUse = Math.abs(eCop) < copDead ? 0 : eCop;
  const maxFrac = Math.abs(num('SQC_FZ_MAX_FRAC', 0.35));
  const deltaRaw = clamp(2 * nominal * eCopUse / dz, -maxFrac * nominal, maxFrac * nominal);

  let st = _state.get(w);
  if (!st) { st = { delta: deltaRaw }; _state.set(w, st); }
  const tau = Math.max(0, num('SQC_FZ_BUDGET_TC', 0.15));
  const a = tau > 0 ? 1 - Math.exp(-Math.max(0, i.dt) / tau) : 1;
  const want = st.delta + (deltaRaw - st.delta) * a;
  const slew = Math.abs(num('SQC_FZ_SLEW', 1500)) * Math.max(0, i.dt);
  st.delta = clamp(want, st.delta - slew, st.delta + slew);

  const fzLTarget = Math.max(0, nominal * 0.5 + st.delta * 0.5);
  const fzRTarget = Math.max(0, nominal * 0.5 - st.delta * 0.5);
  return { fzLTarget, fzRTarget, delta: st.delta, valid: true };
}
