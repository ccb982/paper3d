/**
 * Actual force chain v0: direct contact force + CoP. Validation only.
 */
import type { World } from '../world';

export interface ActualForceChain {
  F: { x: number; y: number; z: number };
  cop: { x: number; z: number };
  fParallel: number;
  fPerp: number;
  tau: { hip: number; knee: number; ankle: number };
  contact: boolean;
  feasible: boolean;
  confidence: number;
  copInside: boolean;
  frictionUtil: number;
  tauUtil: number;
}

function hull(points: Array<{ x: number; z: number }>): Array<{ x: number; z: number }> {
  const p = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  if (p.length <= 2) return p;
  const cross = (o: {x:number;z:number}, a: {x:number;z:number}, b: {x:number;z:number}): number => (a.x-o.x)*(b.z-o.z)-(a.z-o.z)*(b.x-o.x);
  const lo: typeof p = [], up: typeof p = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length-2]!, lo[lo.length-1]!, q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]!; while (up.length >= 2 && cross(up[up.length-2]!, up[up.length-1]!, q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop(); return lo.concat(up);
}
function inside(poly: Array<{ x: number; z: number }>, p: { x: number; z: number }): boolean {
  if (poly.length < 3) return false;
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const c = (b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x);
    if (Math.abs(c) < 1e-9) continue;
    const s = Math.sign(c);
    if (sign === 0) sign = s; else if (s !== sign) return false;
  }
  return true;
}

export function measureActualForceChain(
  w: World, side: 'l' | 'r',
  hip: { x: number; y: number }, knee: { x: number; y: number }, ankle: { x: number; y: number },
): ActualForceChain {
  const ji = w.sk.joints.findIndex((j) => j.name === `hip_${side}`);
  const legBodies = ji >= 0 ? new Set(w.body.subtree[ji] ?? []) : new Set<number>();
  const samples = w.body.allContactSamples(w.dt).filter((c) => legBodies.has(c.body));
  let fx = 0, fy = 0, fz = 0, jsum = 0, jtsum = 0, cx = 0, cz = 0;
  let th = 0, tk = 0, ta = 0;
  const pts: Array<{ x: number; z: number }> = [];
  for (const p of samples) {
    pts.push({ x: p.x, z: p.z });
    jtsum += p.jt;
    fx += p.fx; fy += p.fy; fz += p.fz; jsum += p.jn;
    cx += p.x * p.jn; cz += p.z * p.jn;
    const arm = (j: { x: number; y: number }): number => (p.x - j.x) * p.fy - (p.y - j.y) * p.fx;
    th -= arm(hip); tk -= arm(knee); ta += arm(ankle);
  }
  // 髋以下自重项：Fg=(0,-mg,0)，按各段 COM 对关节取矩。
  let gh = 0, gk = 0, ga = 0;
  for (const key of [`thigh_${side}`, `shin_${side}`, `foot_${side}`, `arch_${side}`, `mfoot_${side}`]) {
    const bi = w.body.indexByKey.get(key); if (bi === undefined) continue;
    const rb = w.body.bodies[bi]!; const p = rb.worldCom(); const mg = rb.mass() * 9.81;
    gh += (p.x - hip.x) * (-mg); gk += (p.x - knee.x) * (-mg); ga += (p.x - ankle.x) * (-mg);
  }
  const F = { x: fx, y: fy, z: fz };
  const cop = jsum > 1e-9 ? { x: cx / jsum, z: cz / jsum } : { x: ankle.x, z: 0 };
  const u = { x: knee.x - ankle.x, y: knee.y - ankle.y };
  const n = Math.hypot(u.x, u.y) || 1;
  const un = { x: u.x / n, y: u.y / n };
  const poly = hull(pts);
  const copInside = inside(poly, cop);
  const frictionUtil = jsum > 1e-9 ? jtsum / jsum : 0;
  const tmax = (n: string): number => { const i = w.body.dofByName(n, 2); return i >= 0 ? Math.max(1, w.body.dofs[i]!.tauMax) : 1; };
  const tauUtil = Math.max(Math.abs(th + gh) / tmax(`hip_${side}`), Math.abs(tk + gk) / tmax(`knee_${side}`), Math.abs(ta + ga) / tmax(`foot_${side}`));
  const fParallel = F.x * un.x + F.y * un.y;
  const fPerp = Math.hypot(F.x - fParallel * un.x, F.y - fParallel * un.y, F.z);
  return {
    F, cop, fParallel, fPerp,
    tau: { hip: th + gh, knee: tk + gk, ankle: ta + ga },
    contact: samples.length > 0,
    feasible: samples.length > 0 && copInside && frictionUtil <= 0.8 && tauUtil <= 1 && fParallel > 0,
    confidence: samples.length > 0 ? 1 : 0,
    copInside, frictionUtil, tauUtil,
  };
}
