/** 髋回正输入层：CoM/XCoM、CoP、左右负载、H*。只做感知/误差，不做策略。 */
export interface HipRightingSensorInput {
  comX: number;
  comY: number;
  comZ: number;
  comVX: number;
  comVZ: number;
  comTargetX: number;
  comTargetZ: number;
  fzL: number;
  fzR: number;
  copZL: number;
  copZR: number;
  hipHeight: number;
  hipTargetY: number;
}

export interface HipRightingErrors {
  eSag: number;
  eLat: number;
  eLoad: number;
  eH: number;
  xcomZ: number;
  copZ: number;
}

export function computeHipRightingErrors(i: HipRightingSensorInput): HipRightingErrors {
  const comY = Math.max(0.3, i.comY);
  const xcomZ = i.comZ + i.comVZ * Math.sqrt(comY / 9.81);
  const fzSum = i.fzL + i.fzR;
  const copZ = fzSum > 1e-6 ? (i.fzL * i.copZL + i.fzR * i.copZR) / fzSum : i.comZ;
  return {
    eSag: i.comTargetX - i.comX,
    // XCoM/CoP 侧向误差；Kuo 1995 / Hof 2005
    eLat: xcomZ - copZ,
    // 左右负载偏差；Winter 1995 / MacKinnon & Winter 1993
    eLoad: fzSum > 1e-6 ? (i.fzL - i.fzR) / fzSum : 0,
    eH: i.hipTargetY - i.hipHeight,
    xcomZ,
    copZ,
  };
}
