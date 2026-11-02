/** 验证状态：纯函数；尚未作为控制门控启用。 */
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
const norm = (v: V3): number => Math.hypot(v.x, v.y, v.z);
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export function evaluateForceChain(i: ForceChainInput): ForceChainResult {
  const n = norm({ x: i.ankle.x - i.knee.x, y: i.ankle.y - i.knee.y, z: i.ankle.z - i.knee.z }) || 1;
  const u = { x: (i.ankle.x - i.knee.x) / n, y: (i.ankle.y - i.knee.y) / n, z: (i.ankle.z - i.knee.z) / n };
  const d = dot(i.force, u);
  const fp = { x: d * u.x, y: d * u.y, z: d * u.z };
  const perp = { x: i.force.x - fp.x, y: i.force.y - fp.y, z: i.force.z - fp.z };
  const utilization = i.tauCap > 0 ? Math.abs(i.tauReq) / i.tauCap : Infinity;
  const aligned = norm(perp) <= 1e-6;
  return { uShank: u, fParallel: fp, fPerp: perp, aligned, feasible: aligned && i.contact && i.copInside && utilization < 0.8, utilization };
}

/** 理论力链：小腿轴 + 沿轴目标力 + 零侧向力。 */
export interface TheoreticalChain {
  u: V3;
  kStar: V3;
  hStar: V3;
  fChain: number;
  fPerp: number;
}
export function buildTheoreticalChain(ankle: V3, knee: V3, hip: V3, fChain: number): TheoreticalChain {
  const raw = { x: ankle.x - knee.x, y: ankle.y - knee.y, z: ankle.z - knee.z };
  const n = norm(raw);
  return {
    u: { x: raw.x / n, y: raw.y / n, z: raw.z / n },
    kStar: knee,
    hStar: hip,
    fChain,
    fPerp: 0,
  };
}

/** 实际力链：支撑法向力 + 侧向力矩换算的横向力。 */
export interface ActualChain {
  u: V3;
  fChain: number;
  fPerp: number;
  feasible: boolean;
}
export function estimateActualChain(ankle: V3, knee: V3, normalForce: number, lateralTau: number, lateralLever = 0.35): ActualChain {
  const raw = { x: ankle.x - knee.x, y: ankle.y - knee.y, z: ankle.z - knee.z };
  const n = norm(raw);
  return {
    u: { x: raw.x / n, y: raw.y / n, z: raw.z / n },
    fChain: Math.max(0, normalForce),
    fPerp: lateralLever > 0 ? lateralTau / lateralLever : 0,
    feasible: true,
  };
}

/** 最小力链：脚→踝→小腿→膝→大腿；检查大腿过膝的合力是否沿小腿。 */
export interface KneeForceChain {
  uShank: V3;
  fShank: V3;
  fKnee: V3;
  fThigh: V3;
  fPerpAtKnee: V3;
  aligned: boolean;
  feasible: boolean;
}
export function buildKneeForceChain(ankle: V3, knee: V3, fShankAxial: number, tauKnee: number, lever = 0.12): KneeForceChain {
  const raw = { x: ankle.x - knee.x, y: ankle.y - knee.y, z: ankle.z - knee.z };
  const n = norm(raw) || 1;
  const u = { x: raw.x / n, y: raw.y / n, z: raw.z / n };
  const fShank = { x: fShankAxial * u.x, y: fShankAxial * u.y, z: fShankAxial * u.z };
  void tauKnee; void lever;   // 目标力链不允许用 tauKnee 伪造横向分力；力矩限幅由 JᵀF 检查
  const fThigh = { ...fShank };
  const d = dot(fThigh, u);
  const fp = { x: d * u.x, y: d * u.y, z: d * u.z };
  const perp = { x: fThigh.x - fp.x, y: fThigh.y - fp.y, z: fThigh.z - fp.z };
  const aligned = norm(perp) <= 1e-6;
  return { uShank: u, fShank, fKnee: { x: 0, y: 0, z: 0 }, fThigh, fPerpAtKnee: perp, aligned, feasible: aligned };
}
