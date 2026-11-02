/** 力链约束：u_shank、F_parallel、F_perp、feasible。纯函数，不写执行器。 */
export interface V3 { x: number; y: number; z: number }
export interface ForceChainInput {
  ankle: V3; knee: V3; hip: V3;
  force: V3;
  contact: boolean;
  copInside: boolean;
  tauReq: number;
  tauCap: number;
}
export interface ForceChainResult {
  uShank: V3;
  fParallel: V3;
  fPerp: V3;
  aligned: boolean;
  feasible: boolean;
  utilization: number;
}
const norm = (v: V3): number => Math.hypot(v.x, v.y, v.z) || 1;
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export function evaluateForceChain(i: ForceChainInput): ForceChainResult {
  const n = norm({ x: i.ankle.x - i.knee.x, y: i.ankle.y - i.knee.y, z: i.ankle.z - i.knee.z });
  const u = { x: (i.ankle.x - i.knee.x) / n, y: (i.ankle.y - i.knee.y) / n, z: (i.ankle.z - i.knee.z) / n };
  const d = dot(i.force, u);
  const fp = { x: d * u.x, y: d * u.y, z: d * u.z };
  const perp = { x: i.force.x - fp.x, y: i.force.y - fp.y, z: i.force.z - fp.z };
  const utilization = i.tauCap > 0 ? Math.abs(i.tauReq) / i.tauCap : Infinity;
  const aligned = norm(perp) <= 1e-6;
  return { uShank: u, fParallel: fp, fPerp: perp, aligned, feasible: aligned && i.contact && i.copInside && utilization < 0.8, utilization };
}
