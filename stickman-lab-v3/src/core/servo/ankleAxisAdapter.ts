/**
 * ankleAxisAdapter.ts —— 标准方向力矩 → 踝轴力矩 的转接口
 *
 * 只做一件事：给定世界系目标力矩 M_des（标准方向，例如纯矢状 (0,0,Mz)），
 * 和当前可用的踝轴 u_i，求各轴力矩 τ_i，使 A·τ ≈ M_des。
 *
 * 分层：本文件属于**伺服层**。执行层只负责把 τ 施加到关节，不读 M_des/CoP。
 *
 * 约定：
 *   +X 前，+Y 上，+Z 侧向
 *   矢状面 = X-Y；纯矢状力矩 = (0, 0, Mz)（绕横轴 Z）
 *   侧向 roll = (Mx, 0, 0)
 *
 * 注意：预环/不可用轴由调用方标 available=false；本文件不判断关节语义。
 */

export interface AdapterAxis {
  /** 世界系单位轴 */
  u: [number, number, number];
  /** 该轴力矩上限（N·m） */
  tauMax: number;
  /** 是否可参与（preRing/锁死轴为 false） */
  available: boolean;
}

export interface AdapterResult {
  /** 与 axes 同序的力矩；不可用轴为 0 */
  tau: number[];
  /** 世界系残差 A·τ − M_des */
  residual: [number, number, number];
  /** 残差模长 */
  residualNorm: number;
}

/** 解对称正定小系统（n ≤ 3）；失败返回 null */
function solveSym(G: number[][], b: number[]): number[] | null {
  const n = b.length;
  const A = G.map((row) => row.slice());
  const x = b.slice();
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r]![col]!) > Math.abs(A[piv]![col]!)) piv = r;
    if (Math.abs(A[piv]![col]!) < 1e-12) return null;
    if (piv !== col) { const t = A[piv]!; A[piv] = A[col]!; A[col] = t; const tb = x[piv]!; x[piv] = x[col]!; x[col] = tb; }
    const d = A[col]![col]!;
    for (let j = col; j < n; j++) A[col]![j] = A[col]![j]! / d;
    x[col] = x[col]! / d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r]![col]!;
      if (f === 0) continue;
      for (let j = col; j < n; j++) A[r]![j] = A[r]![j]! - f * A[col]![j]!;
      x[r] = x[r]! - f * x[col]!;
    }
  }
  return x;
}

/**
 * 将世界系目标力矩映射到可用踝轴。
 * @param Mdes 世界系目标力矩 (N·m)
 * @param axes 各轴定义（世界系轴 + 上限 + 可用性）
 * @param lambda 正则化（防止两轴近共线时力矩爆）
 */
export function mapMomentToAxes(Mdes: [number, number, number], axes: AdapterAxis[], lambda = 1e-4): AdapterResult {
  const avail = axes.map((a, i) => ({ a, i })).filter((x) => x.a.available);
  const tau = axes.map(() => 0);
  if (avail.length === 0) {
    return { tau, residual: [...Mdes], residualNorm: Math.hypot(...Mdes) };
  }
  // 归一化轴，防输入非单位
  const us = avail.map(({ a }) => {
    const l = Math.hypot(a.u[0], a.u[1], a.u[2]) || 1;
    return [a.u[0] / l, a.u[1] / l, a.u[2] / l] as [number, number, number];
  });
  // Gram 矩阵 + 右端
  const G: number[][] = us.map((ui) => us.map((uj) => ui[0] * uj[0] + ui[1] * uj[1] + ui[2] * uj[2]));
  for (let i = 0; i < G.length; i++) G[i]![i] = G[i]![i]! + lambda;
  const b = us.map((u) => u[0] * Mdes[0] + u[1] * Mdes[1] + u[2] * Mdes[2]);
  const sol = solveSym(G, b);
  if (!sol) {
    return { tau, residual: [...Mdes], residualNorm: Math.hypot(...Mdes) };
  }
  // 回填 + 钳位
  for (let k = 0; k < avail.length; k++) {
    const { i, a } = avail[k]!;
    const lim = Math.abs(a.tauMax);
    tau[i] = Math.max(-lim, Math.min(lim, sol[k]!));
  }
  // 残差
  const r: [number, number, number] = [Mdes[0], Mdes[1], Mdes[2]];
  for (let k = 0; k < avail.length; k++) {
    const { i, a } = avail[k]!;
    const l = Math.hypot(a.u[0], a.u[1], a.u[2]) || 1;
    r[0] -= (a.u[0] / l) * tau[i]!;
    r[1] -= (a.u[1] / l) * tau[i]!;
    r[2] -= (a.u[2] / l) * tau[i]!;
  }
  return { tau, residual: r, residualNorm: Math.hypot(...r) };
}

/** 纯矢状基础力矩：只允许 z 分量 */
export function sagittalBaseMoment(Fy: number, copXBase: number, ankleX: number): [number, number, number] {
  return [0, 0, -(copXBase - ankleX) * Fy];
}

/** 侧向 roll 力矩：只允许 x 分量 */
export function lateralRollMoment(Mx: number): [number, number, number] {
  return [Mx, 0, 0];
}
