/**
 * 全身扰动检测：实际接触力 + 重力 - M·a_com 的残差。
 * 只读，不修正。输出方向/置信度/CoP/接触支撑。
 */
import type { World } from '../world';
import type { ControlModule } from '../control';
import { detectDirection, type DirectionResult } from './disturbance';

export interface WholeBodySense {
  F: { x: number; y: number; z: number };
  cop: { x: number; z: number };
  comAccel: { x: number; y: number; z: number };
  residual: { x: number; y: number; z: number };
  external: { x: number; y: number; z: number };
  contact: number;
  loadRatio: number;
  valid: boolean;
  copInside: boolean;
  direction: DirectionResult;
}

const accPrev = new WeakMap<World, { vx: number; vy: number; vz: number }>();
const rzPrev = new WeakMap<World, number>();
const vzPrev = new WeakMap<World, number>();

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

export function senseWholeBody(w: World, ctl: ControlModule): WholeBodySense {
  const contacts = w.body.allContactSamples(w.dt);
  let fx = 0, fy = 0, fz = 0, jn = 0, cx = 0, cz = 0;
  const pts: Array<{ x: number; z: number }> = [];
  for (const c of contacts) {
    fx += c.fx; fy += c.fy; fz += c.fz; jn += c.jn;
    cx += c.x * c.jn; cz += c.z * c.jn; pts.push({ x: c.x, z: c.z });
  }
  const cop = jn > 1e-9 ? { x: cx / jn, z: cz / jn } : { x: ctl.sensors.com[0]!, z: ctl.sensors.com[2]! };
  const mass = w.body.bodies.reduce((a, rb) => a + rb.mass(), 0);
  let comX = 0, comY = 0, comZ = 0, vx = 0, vy = 0, vz = 0;
  for (const rb of w.body.bodies) {
    const m = rb.mass(); const p = rb.worldCom(); const lv = rb.linvel();
    comX += m * p.x; comY += m * p.y; comZ += m * p.z;
    vx += m * lv.x; vy += m * lv.y; vz += m * lv.z;
  }
  const M = Math.max(1e-9, mass); comX /= M; comY /= M; comZ /= M; vx /= M; vy /= M; vz /= M;
  let pv = accPrev.get(w);
  if (!pv) { pv = { vx, vy, vz }; accPrev.set(w, pv); }
  const dt = Math.max(w.dt, 1e-6);
  const ax = (vx - pv.vx) / dt, ay = (vy - pv.vy) / dt, az = (vz - pv.vz) / dt;
  pv.vx = vx; pv.vy = vy; pv.vz = vz;
  const residual = { x: fx - M * ax, y: fy - M * 9.81 - M * ay, z: fz - M * az };
  const loadRatio = fy / (M * 9.81);
  const external = { x: -residual.x, y: -residual.y, z: -residual.z };
  const rz = external.z;
  const rz0 = rzPrev.get(w) ?? rz;
  const rzLp = rz0 + (rz - rz0) * (1 - Math.exp(-dt / 0.1));
  rzPrev.set(w, rzLp);
  const vz0 = vzPrev.get(w) ?? vz;
  const vzLp = vz0 + (vz - vz0) * (1 - Math.exp(-dt / 0.08));
  vzPrev.set(w, vzLp);
  const valid = loadRatio > 0.5 && contacts.length > 0;
  const dir: -1 | 0 | 1 = valid && Math.abs(vzLp) > 0.03 ? (vzLp > 0 ? 1 : -1) : 0;
  const direction = { direction: dir, confidence: dir === 0 ? 0 : Math.min(1, Math.abs(vzLp) / 0.25), support: 'both' as const, comZ, velZ: vzLp, copZ: cop.z, comRel: comZ - cop.z, loadDiff: 0 };
  return {
    F: { x: fx, y: fy, z: fz }, cop, comAccel: { x: ax, y: ay, z: az },
    residual, external, contact: contacts.length, loadRatio, valid, copInside: inside(hull(pts), cop), direction,
  };
}
