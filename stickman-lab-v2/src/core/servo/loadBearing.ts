/**
 * 伺服 · 承重保持（load bearing）——**独立伺服模块**（2026-10-11 用户定调"重做架构"）。
 *
 * 目标（KPI）：单支撑期支撑脚 Fz ≥ 95%W 的占比 ≥90%（`_probe-fz-coverage`）。
 *
 * 实测依据（`_probe-onset` 20ms 对齐）：
 *   · **vz 比 Fz 早 ~0.15-0.2s**（负载 3.813s 才掉，vz 3.708s 就在爬）→ 输入必须用速度/预测，
 *     用 Fz 当前值 = 晚 0.2 秒出手；
 *   · 掉载瞬间外展已全力（147~220 N·m）但角仍 −0.22 → 出手太晚；
 *   · 文献：Wall 2010（velocity/预测运动信号做反馈有效）；Winter 1996（load/unload 是 ML 主机制）。
 *
 * 律：err =（vz + lead×az 的预测速度 − 参考0）→ 欠载判定（Fz 也进，但只是辅助）
 *     → 支撑髋外展直加力矩（把骨盆/CoM 压回支撑脚）+ 前馈保持分量。
 * 纪律：直接写 Drive（ff 通道）；在 pelvisBearing **之后**调用（它是 hip/0 的最后写手之一）。
 */
import type { ServoRefs } from './supportReg';

export const LOAD_BEAR = {
  /** 预测前置（s）：vz + lead×az 外推（实测 onset 差 0.15-0.2） */
  lead: 0.15,
  /** 速度误差增益（N·m / (m/s)） */
  kv: 260,
  /** 欠载分量增益（N·m / 欠载率） */
  kUnder: 90,
  /** 输出上限（N·m；与 pelvisBearing 叠加后仍须 ≤ 外展 τmax 200） */
  cap: 150,   // ★ 80→150（实测 vz=1.09 时需求 283 N·m——80 掐死了承重伺服）
  /** vz 低通（s）——防噪声尖峰（本日多次教训） */
  tau: 0.08,
};

let vzF = 0;

/** 每帧调用（B–E 单支撑段；support = 支撑侧） */
export function loadBearing(ctx: ServoRefs, support: 'l' | 'r', dt: number): void {
  const vzRaw = ctx.sensors.rawVel[2]!;
  const a = 1 - Math.exp(-dt / LOAD_BEAR.tau);
  vzF += (vzRaw - vzF) * a;
  // 预测速度（vz + lead×az）：用低通后的 vz 做差分估 az，避免原始噪声
  const prev = (loadBearing as unknown as { _prev?: number })._prev ?? vzF;
  const az = (vzF - prev) / Math.max(dt, 1e-6);
  (loadBearing as unknown as { _prev?: number })._prev = vzF;
  const vzPred = vzF + LOAD_BEAR.lead * az;
  // 欠载率（辅助量：Fz 低 = 已在掉；预测项负责提前出手）
  const fr = ctx.sensors.feet[support === 'l' ? 0 : 1]!.fz;
  const W = ctx.body.sk.massTotal * 9.81;
  const under = Math.max(0, Math.min(1, (0.95 * W - fr) / W));
  // 输出：速度朝摆动侧（+vz，偏离支撑）→ 加力把 CoM 压回支撑（+ = 支撑髋外展方向）
  const dir = support === 'r' ? 1 : -1;   // 右支撑：+vz=偏离支撑 → 正外展修正（pelvisBearing 同向实证）
  const tau = Math.max(-LOAD_BEAR.cap, Math.min(LOAD_BEAR.cap, (LOAD_BEAR.kv * vzPred + LOAD_BEAR.kUnder * under) * dir));
  const di = ctx.body.dofByName(`hip_${support}`, 0);
  if (di >= 0 && tau !== 0) ctx.bal.drive.setTorque(di, tau);
}
