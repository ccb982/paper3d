import type { World } from '../world';
import { computeSquat2Command, type Squat2Command } from './command';
import type { SquatFrame } from './frame';

export function shadowSquat2(w: World): Squat2Command {
  const n = w.body.dofs.length;
  const q = new Float64Array(n);
  const qd = new Float64Array(n);
  for (let i = 0; i < n; i++) { q[i] = w.body.dofs[i]!.angle; qd[i] = w.body.dofs[i]!.vel; }
  const com = new Float64Array(3);
  const comVel = new Float64Array(3);
  w.body.com(com);
  w.body.comVel(comVel);
  const foot = (side: 'l' | 'r') => {
    const bi = w.body.indexByKey.get(`foot_${side}`);
    const p = bi !== undefined ? w.body.bodies[bi]!.translation() : { x: 0, y: 0, z: 0 };
    const fz = w.body.footNormalForce(side, w.dt);
    return { side, contact: fz > 1, x: p.x, y: p.y, z: p.z, fz, copX: p.x, copZ: p.z };
  };
  const l = foot('l'), r = foot('r');
  const minX = Math.min(l.x, r.x) - 0.1, maxX = Math.max(l.x, r.x) + 0.1;
  const minZ = Math.min(l.z, r.z) - 0.1, maxZ = Math.max(l.z, r.z) + 0.1;
  const frame: SquatFrame = {
    q, qd,
    com: [com[0]!, com[1]!, com[2]!],
    comTarget: [0.5 * (l.x + r.x), 0.53, 0.5 * (l.z + r.z)],
    comVel: [comVel[0]!, comVel[1]!, comVel[2]!],
    contacts: [l, r],
    support: { minX, maxX, minZ, maxZ },
    upper: { mass: 0.5 * w.sk.massTotal, comX: com[0]!, comY: com[1]!, comZ: com[2]! },
  };
  return computeSquat2Command(w, frame);
}
