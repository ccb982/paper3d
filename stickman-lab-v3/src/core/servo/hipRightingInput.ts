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
  contact?: boolean;
  friction?: number;
  copValid?: boolean;
  fParallel?: number;
  fPerp?: number;
  chainFeasible?: boolean;
  hipQ?: [number, number, number];
  hipV?: [number, number, number];
  disturbance?: number;
}

export interface HipRightingErrors {
  eSag: number;
  eSagV: number;
  eLat: number;
  eLoad: number;
  eFzL: number;
  eFzR: number;
  eH: number;
  xcomZ: number;
  copZ: number;
  loadValid: boolean;
  gripValid: boolean;
  disturbance: number;
  /** 膝侧向角（knee/0；外翻为正，左右镜像） */
  eValgus: number;
}

export function computeHipRightingErrors(i: HipRightingSensorInput): HipRightingErrors {
  const comY = Math.max(0.3, i.comY);
  const xcomZ = i.comZ + i.comVZ * Math.sqrt(comY / 9.81);
  const fzSum = i.fzL + i.fzR;
  const fzAvg = fzSum * 0.5;
  const copZ = fzSum > 1e-6 ? (i.fzL * i.copZL + i.fzR * i.copZR) / fzSum : i.comZ;
  const loadValid = !!i.contact && fzSum > 1e-6;
  const gripValid = loadValid && (i.friction ?? 0) > 0.05 && (i.copValid ?? false);
  const disturbance = Math.abs(i.comTargetX - i.comX) + Math.abs(xcomZ - copZ);
  return {
    eSag: i.comTargetX - i.comX,
    eSagV: -i.comVX,
    // XCoM/CoP 侧向误差；Kuo 1995 / Hof 2005
    eLat: xcomZ - copZ,
    // 左右负载偏差；Winter 1995 / MacKinnon & Winter 1993
    eLoad: loadValid ? (i.fzL - i.fzR) / fzSum : 0,
    eFzL: fzAvg - i.fzL,
    eFzR: fzAvg - i.fzR,
    eH: i.hipTargetY - i.hipHeight,
    xcomZ,
    copZ,
    loadValid,
    gripValid,
    disturbance,
    eValgus: 0,
  };
}

export interface HipRightingSideData {
  hipHeight: number;
  hipZErr: number;
  hipTargetY: number;
  hipQ: [number, number, number];
  hipV: [number, number, number];
  fParallel: number;
  fParallelSigned: number;
  fPerp: number;
  fPerpSag: number;
  /** 有符号侧向力链（膝力额状面分量） */
  fLat: number;
  /** 膝侧向角 knee/0 */
  knee0: number;
  chainFeasible: boolean;
}

export interface HipRightingFrame {
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
  copValidL: boolean;
  copValidR: boolean;
  contactL: boolean;
  contactR: boolean;
  frictionL: number;
  frictionR: number;
  roll: number;
  sagRel: number;
  left?: HipRightingSideData;
  right?: HipRightingSideData;
}

export function hipErrorsForSide(f: HipRightingFrame, side: 'l' | 'r'): HipRightingErrors {
  const sd = side === 'l' ? f.left : f.right;
  const isL = side === 'l';
  const e = computeHipRightingErrors({
    comX: f.comX, comY: f.comY, comZ: f.comZ, comVX: f.comVX, comVZ: f.comVZ,
    comTargetX: f.comTargetX, comTargetZ: f.comTargetZ,
    fzL: f.fzL, fzR: f.fzR, copZL: f.copZL, copZR: f.copZR,
    hipHeight: sd?.hipHeight ?? 0, hipTargetY: sd?.hipTargetY ?? 0,
    contact: isL ? f.contactL : f.contactR,
    friction: isL ? f.frictionL : f.frictionR,
    copValid: isL ? f.copValidL : f.copValidR,
    fParallel: sd?.fParallel ?? 0, fPerp: sd?.fPerp ?? 0, chainFeasible: sd?.chainFeasible ?? false,
    hipQ: sd?.hipQ, hipV: sd?.hipV,
  });
  return { ...e, eValgus: sd?.knee0 ?? 0 };
}

export function gripValidForSide(f: HipRightingFrame, side: 'l' | 'r', maxFrictionUse = 0.8): boolean {
  const isL = side === 'l';
  const fzL = f.fzL, fzR = f.fzR;
  const load = isL ? f.contactL : f.contactR;
  // frictionL/R 是 |Ft|/(mu*Fn) 的利用率：0=最好，1=到摩擦锥边界。
  const frictionUse = isL ? f.frictionL : f.frictionR;
  const cop = isL ? f.copValidL : f.copValidR;
  return load && fzL + fzR > 1e-6 && frictionUse <= maxFrictionUse && cop;
}
