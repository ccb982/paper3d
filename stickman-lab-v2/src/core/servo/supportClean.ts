/** supportClean.ts —— 支撑柱骨架重构版（2026-10-15 用户："架构重置"）
 *
 *  第一性公式（无闸门 / 无锁 / 无模式 / 无捕获事件）：
 *      支撑腿每轴：τ = B0_j（真·常值力矩通道） + kP·(θ_ref − θ) + 单向阻尼
 *      单向阻尼（用户："只有往外偏是阻尼"）：dev·θ̇ > 0（往外）才 τ_damp=−kD·θ̇；回程零写入
 *      θ_ref：首帧捕获（=抬腿结束那刻），此后恒定
 *
 *  · B0 标定目标 = 初态静态载荷（对账工具直接量）——纯基础力维持初态的"由构造保证"
 *  · 全部走提案总线（PRI.action）；不写 pair（不走 λ 弹簧通道）
 *  · 摆动腿：同一公式（B0 小档=持位力矩）
 */
import { propose, PRI } from '../proposalBus';
import type { ServoRefs } from './supportReg';

const envOf = (): Record<string, string> =>
  ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {});

const _ref = new Map<string, number>();
export function supportCleanReset(): void {
  _ref.clear();
}

const AXES: Array<[string, number]> = [
  ['hip', 0], ['hip', 1], ['hip', 2],
  ['knee', 0], ['knee', 1], ['knee', 2],
  ['foot', 0], ['foot', 1], ['foot', 2],
];

export function supportClean(ctx: ServoRefs, side: 'l' | 'r'): void {
  const e = envOf();
  // 支撑侧默认（=现名册）；摆动侧默认（=今日实测定档 髋2:+80 / 膝2:−55）
  const sup = side === 'r';
  const B0: Record<string, number> = sup
    ? { hip0: Number(e.SC_HIP0 ?? 80), hip1: 0, hip2: Number(e.SC_HIP2 ?? 40),
        knee0: Number(e.SC_KNEE0 ?? 30), knee1: 0, knee2: Number(e.SC_KNEE2 ?? 0),
        foot0: Number(e.SC_FOOT0 ?? 0), foot1: 0, foot2: Number(e.SC_FOOT2 ?? 0) }
    : { hip0: Number(e.SW_HIP0 ?? 0), hip1: 0, hip2: Number(e.SW_HIP2 ?? 80),
        knee0: Number(e.SW_KNEE0 ?? 0), knee1: 0, knee2: Number(e.SW_KNEE2 ?? -55),
        foot0: Number(e.SW_FOOT0 ?? 0), foot1: 0, foot2: Number(e.SW_FOOT2 ?? 0) };
  const kP = Number(e.SC_KP ?? 120);    // 回正刚度 N·m/rad（★ 12s 定档 60→120）
  const kD = Number(e.SC_KD ?? 12);     // 单向阻尼 N·m·s/rad（★ 12s 定档 6→12）
  const cap = Number(e.SC_CAP ?? 100);  // 单轴出力钳（★ 12s 定档 150→100——关键》）
  for (const [jn, ax] of AXES) {
    const di = ctx.body.dofByName(`${jn}_${side}`, ax);
    if (di < 0) continue;
    const d0 = ctx.body.dofs[di]!;
    const key = `${jn}_${side}:${ax}`;
    if (!_ref.has(key)) _ref.set(key, d0.angle);
    const dev = _ref.get(key)! - d0.angle;
    const outward = dev * d0.vel > 0;
    const damp = outward ? -kD * d0.vel : 0;
    const tau = Math.max(-cap, Math.min(cap, (B0[`${jn}${ax}`] ?? 0) + kP * dev + damp));
    propose({ dof: di, kind: 'torque', pri: PRI.action, tau, src: 'supportClean' });
  }
}
