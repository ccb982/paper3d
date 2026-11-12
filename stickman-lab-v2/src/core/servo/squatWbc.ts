const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export interface SquatHipDynamicsInput {
  com: [number, number, number]; comTarget: [number, number, number]; comVel: [number, number, number];
  jCom: [number, number][]; m: [number, number]; h: [number, number]; tauMin: [number, number]; tauMax: [number, number];
  kp?: number; kd?: number; wTask?: number; wReg?: number;
}
export function solveSquatHipDynamics(i: SquatHipDynamicsInput): [number, number] {
  const kp = i.kp ?? 8, kd = i.kd ?? 2.5, wTask = Math.max(0, i.wTask ?? 1), wReg = Math.max(1e-9, i.wReg ?? 1e-3);
  const a = [0, 1, 2].map((k) => kp * (i.comTarget[k]! - i.com[k]!) - kd * i.comVel[k]!);
  const A = [[wReg, 0], [0, wReg]], b = [0, 0];
  for (let k = 0; k < 3; k++) { const j = i.jCom[k]!; for (let r = 0; r < 2; r++) { b[r] += wTask * j[r]! * a[k]!; for (let c = 0; c < 2; c++) A[r]![c] += wTask * j[r]! * j[c]!; } }
  const det = A[0]![0]! * A[1]![1]! - A[0]![1]! * A[1]![0]!;
  const qdd = det !== 0 ? [(b[0]! * A[1]![1]! - A[0]![1]! * b[1]!) / det, (A[0]![0]! * b[1]! - b[0]! * A[1]![0]!) / det] : [0, 0];
  return [clamp(i.m[0] * qdd[0]! + i.h[0], i.tauMin[0], i.tauMax[0]), clamp(i.m[1] * qdd[1]! + i.h[1], i.tauMin[1], i.tauMax[1])];
}
export interface SquatShankDynamicsInput { cop: number; copTarget: number; copMin: number; copMax: number; fz: number; m: number; h: number; tauMin: number; tauMax: number; kpCop?: number; copCap?: number; }
export function solveSquatShankDynamics(i: SquatShankDynamicsInput): number {
  const kpCop = i.kpCop ?? 0.6, cap = Math.abs(i.copCap ?? 30);
  const copTarget = clamp(i.copTarget, Math.min(i.copMin, i.copMax), Math.max(i.copMin, i.copMax));
  const tauCop = clamp((copTarget - i.cop) * Math.max(0, i.fz) * kpCop, -cap, cap);
  return clamp(i.h + tauCop, i.tauMin, i.tauMax);
}
