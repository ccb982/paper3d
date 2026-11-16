/** 矢状扰动：CoM 前后偏移（相对释放基准）+ 速度 + 上身相对骨盆前倾。只读。 */
import type { World } from '../world';

export interface SagittalSense {
  comX: number;
  velX: number;
  supportX: number;
  offsetX: number;
  eX: number;
  upperLean: number;
  direction: -1 | 0 | 1;
  confidence: number;
}

const baseX = new WeakMap<World, number>();

export function senseSagittal(w: World): SagittalSense {
  const ctl = (w as unknown as { controller?: { sensors?: { com: Float64Array; comVel: Float64Array } } }).controller;
  const com = ctl?.sensors?.com[0] ?? 0;
  const vx = ctl?.sensors?.comVel[0] ?? 0;
  const al = w.body.dofs[w.body.dofByName('foot_l', 2)];
  const ar = w.body.dofs[w.body.dofByName('foot_r', 2)];
  const supportX = al && ar ? (al.anchorWorld[0]! + ar.anchorWorld[0]!) / 2 : 0;
  const offsetX = com - supportX;
  if (!baseX.has(w)) baseX.set(w, offsetX);
  const eX = offsetX - (baseX.get(w) ?? offsetX);
  const ti = w.body.indexByKey.get('torso');
  const si = w.body.indexByKey.get('spine4');
  const tors = ti !== undefined ? w.body.bodies[ti]!.translation().x : 0;
  const upper = si !== undefined ? w.body.bodies[si]!.translation().x : 0;
  const upperLean = upper - tors;
  const dir: -1 | 0 | 1 = Math.abs(eX) > 0.012 || Math.abs(vx) > 0.04 ? ((eX + 0.2 * vx) > 0 ? 1 : -1) : 0;
  return {
    comX: com, velX: vx, supportX, offsetX, eX, upperLean,
    direction: dir,
    confidence: dir === 0 ? 0 : Math.min(1, Math.abs(eX) / 0.05 + Math.abs(vx) / 0.2),
  };
}
