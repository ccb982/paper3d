/** trunkClean.ts —— 躯干链全新写手（2026-10-15 用户："写一个全新的，一个通道一个写手，审批制安排好"）
 *
 *  通道划分（一通道一写手）：
 *   · 侧向通道（spine1-3 轴0）：基础 B0_LAT + 回正 kP·dev + 单向阻尼
 *   · 矢状通道（spine1-3 轴2）：基础 B0_SAG + 回正 kP·dev + 单向阻尼
 *   · 旋转通道（spine1-3 轴1）：基础 B0_ROT + 回正
 *   · 盆骨拉平通道（dy 驱动 → 叠加到 spine1/0）：B + P·dy + D·dyd（摆动侧沉→托回水平）
 *
 *  预算审批（实时力链，脚→膝→髋→脊柱 依次往上）：
 *   capFoot=fz×脚半宽×k → capKnee=min(300, ×6) → capHip=min(228, ×6) → capSpine=min(470, capHip×2)
 *   全量（基础+回正）走 min(本级预算, 硬件 tauMax)。
 *
 *  调用：由 supportClean 在支撑侧调用一次/帧（唯一入口）；与旧 upperBase/lateralStab 不共存（旧件默认关）。
 */
import { propose, PRI } from '../proposalBus';
import { isLiftDone } from './supportReg';   // 抬腿完成门（躯干通道=抬腿后上岗）
import type { ServoRefs } from './supportReg';
import { dirState } from './dirState';   // ★ 全局方向态（与腿链同套）

const envOf = (): Record<string, string> =>
  ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {});

const _ref = new Map<string, number>();
const _devLp = new Map<string, number>();
let _dyPrev: number | null = null;
let _dydLp = 0;
export function trunkCleanReset(): void {
  _ref.clear();
  _devLp.clear();
  _dyPrev = null;
  _dydLp = 0;
}

const AXES: Array<[string, number]> = [
  ['spine1', 0], ['spine1', 1], ['spine1', 2],
  ['spine2', 0], ['spine2', 1], ['spine2', 2],
  ['spine3', 0], ['spine3', 1], ['spine3', 2],
];

export function trunkClean(ctx: ServoRefs, side: 'l' | 'r', dt = 1 / 240): void {
  if (!isLiftDone()) return;   // ★ 抬腿后才上岗（转移段不该有躯干通道写手）
  const e = envOf();
  // ── 基础（人体档：躯干歪几度 → 侧弯 20-35 N·m；先默认小档，法庭标定）──
  const B0: Record<string, number> = {
    lat: Number(e.TR_B0_LAT ?? 10),
    sag: Number(e.TR_B0_SAG ?? 5),
    rot: Number(e.TR_B0_ROT ?? 0),
  };
  // ★ 四方向独立（用户："四个方向的系数都要独立"）
  const kPN = Number(e.TR_KP_N ?? e.TR_KP ?? 80), kPP = Number(e.TR_KP_P ?? e.TR_KP ?? 80);
  const kDN = Number(e.TR_KD_N ?? e.TR_KD ?? 8), kDP = Number(e.TR_KD_P ?? e.TR_KD ?? 8);
  // ── 盆骨拉平通道（dy 驱动）──
  const pelvB = Number(e.TR_PELV_B ?? 6);
  const pelvP = Number(e.TR_PDY ?? 200);
  const pelvD = Number(e.TR_DDY ?? 40);
  const pelvClamp = Number(e.TR_PELV_CLAMP ?? 0.05);
  const sup0 = ctx.body.dofByName(`hip_${side}`, 0);
  const sw0 = ctx.body.dofByName(`hip_${side === 'l' ? 'r' : 'l'}`, 0);
  let dy = 0, dyd = 0;
  if (sup0 >= 0 && sw0 >= 0) {
    dy = ctx.body.dofs[sup0]!.anchorWorld[1]! - ctx.body.dofs[sw0]!.anchorWorld[1]!;
    const raw = _dyPrev === null ? 0 : (dy - _dyPrev) / Math.max(dt, 1e-6);
    _dyPrev = dy;
    _dydLp += (raw - _dydLp) * (1 - Math.exp(-dt / 0.05));
    dyd = _dydLp;
  }
  // ── 预算审批（实时力链）──
  const budOn = String(e.TR_BUDGET ?? '1') !== '0';
  const fzS = ctx.sensors.feet[side === 'l' ? 0 : 1]!.fz;
  const copK = Number(e.TR_COPK ?? 0.7);
  const capFoot = Math.max(15, fzS * 0.045 * copK);
  const capKnee = Math.min(300, capFoot * 6);
  const capHip = Math.min(228, capKnee * 6);
  const capSpine = Math.min(Number(e.TR_CAPSPINE ?? 470), capHip * 2);
  for (const [jn, ax] of AXES) {
    const di = ctx.body.dofByName(jn, ax);
    if (di < 0) continue;
    const d0 = ctx.body.dofs[di]!;
    const key = `${jn}:${ax}`;
    if (!_ref.has(key)) _ref.set(key, d0.angle);
    const dev = _ref.get(key)! - d0.angle;
    const dirN = ax === 0 ? dirState.latN : dirState.sagN;   // ★ 全局方向态（与腿链同套）
    const aKp = dirN ? kPN : kPP, aKd = dirN ? kDN : kDP;
    const outward = dev * d0.vel > 0;
    const damp = outward ? -aKd * d0.vel : 0;
    const base = ax === 0 ? B0.lat : ax === 2 ? B0.sag : B0.rot;
    let pelv = 0;
    if (jn === 'spine1' && ax === 0) {
      pelv = Math.max(-pelvClamp, Math.min(pelvClamp, (pelvB + pelvP * dy + pelvD * dyd) / 1000));
    }
    const hw = d0.tauMax ?? 200;
    const budget = budOn ? Math.min(capSpine, hw) : hw;
    const tau = Math.max(-budget, Math.min(budget, base + aKp * dev + damp + pelv * 1000));
    if (Math.abs(tau) < 0.3) continue;
    propose({ dof: di, kind: 'torque', pri: PRI.action, tau, src: 'trunkClean' });
  }
}
