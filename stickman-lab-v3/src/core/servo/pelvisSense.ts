/** 骨盆/髋点检测：位置、速度、roll、相对脚中心偏移。只读。 */
import type { World } from '../world';

export interface PelvisSense {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  roll: number;
  offsetZ: number;
  supportZ: number;
  direction: -1 | 0 | 1;
  confidence: number;
}

export function sensePelvis(w: World): PelvisSense {
  const hl = w.body.dofs[w.body.dofByName('hip_l', 0)];
  const hr = w.body.dofs[w.body.dofByName('hip_r', 0)];
  const al = w.body.dofs[w.body.dofByName('foot_l', 2)];
  const ar = w.body.dofs[w.body.dofByName('foot_r', 2)];
  const p = { x: 0, y: 0, z: 0 };
  if (hl && hr) { p.x = (hl.anchorWorld[0]! + hr.anchorWorld[0]!) / 2; p.y = (hl.anchorWorld[1]! + hr.anchorWorld[1]!) / 2; p.z = (hl.anchorWorld[2]! + hr.anchorWorld[2]!) / 2; }
  const ti = w.body.indexByKey.get('torso');
  const rb = ti !== undefined ? w.body.bodies[ti]! : null;
  const v = rb?.linvel() ?? { x: 0, y: 0, z: 0 };
  const q = rb?.rotation() ?? { x: 0, y: 0, z: 0, w: 1 };
  const ux = 2 * (q.x * q.y - q.w * q.z);
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const uz = 2 * (q.w * q.x + q.y * q.z);
  const roll = Math.atan2(uz, Math.hypot(ux, uy));
  const supportZ = al && ar ? (al.anchorWorld[2]! + ar.anchorWorld[2]!) / 2 : 0;
  const offsetZ = p.z - supportZ;
  const dir: -1 | 0 | 1 = Math.abs(offsetZ) > 0.012 || Math.abs(roll) > (2 * Math.PI) / 180 ? (offsetZ + 0.15 * v.z > 0 ? 1 : -1) : 0;
  return {
    x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z, roll,
    offsetZ, supportZ, direction: dir,
    confidence: dir === 0 ? 0 : Math.min(1, Math.abs(offsetZ) / 0.05 + Math.abs(roll) / 0.3),
  };
}
