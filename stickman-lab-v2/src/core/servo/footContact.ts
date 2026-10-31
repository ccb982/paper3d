import type { World } from '../world';

export interface FootContactSample {
  side: 'l' | 'r';
  contact: boolean;
  fz: number;
  fzTarget: number;
  normalError: number;
  copValid: boolean;
  copX: number;
  copZ: number;
  copTargetX: number;
  copTargetZ: number;
  copErrorX: number;
  copErrorZ: number;
  footY: number;
  targetFootY: number;
  footHeightError: number;
  legExtend: number;
  footPositionEnabled: boolean;
}

/** 贴地模块：只给膝/踝 PD 提供目标修正，不直接写关节。 */
export function sampleFootContact(w: World, side: 'l' | 'r', targetCopZ: number, targetFootY?: number, minFz = 20): FootContactSample {
  const fz = w.body.footNormalForce(side, w.dt);
  const cop = new Float64Array(3);
  const copValid = w.body.footCoP(side, w.dt, cop);
  const bi = w.body.indexByKey.get(`foot_${side}`);
  const footY = bi !== undefined ? w.body.bodies[bi]!.translation().y : 0;
  const fzTarget = 0.5 * w.sk.massTotal * 9.81;
  const normalError = fzTarget - fz;
  const copX = copValid ? cop[0]! : 0;
  const copZ = copValid ? cop[1]! : targetCopZ;
  const contact = fz > minFz && copValid;
  return {
    side,
    contact,
    fz,
    fzTarget,
    normalError,
    copValid,
    copX,
    copZ,
    copTargetX: copX,
    copTargetZ: targetCopZ,
    copErrorX: copX - copX,
    copErrorZ: copValid ? copZ - targetCopZ : 0,
    footY,
    targetFootY: targetFootY ?? footY,
    footHeightError: (targetFootY ?? footY) - footY,
    legExtend: Math.max(-0.30, Math.min(0.30,
      normalError * 0.0004 + ((targetFootY ?? footY) - footY) * 4)),

    footPositionEnabled: contact,
  };
}
