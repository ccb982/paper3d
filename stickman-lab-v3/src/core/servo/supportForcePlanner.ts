export interface SupportForcePlannerInput {
  mass: number;
  az: number;
  comX: number;
  comVX: number;
  comY: number;
  footXL: number;
  footXR: number;
  halfXL: number;
  halfXR: number;
  contactL: boolean;
  contactR: boolean;
  gripL: boolean;
  gripR: boolean;
  copInsideL: boolean;
  copInsideR: boolean;
  fzMin: number;
  tauAnkleMax: number;
  margin: number;
}

export interface SupportForcePlannerOutput {
  fzTotal: number;
  fzL: number;
  fzR: number;
  copDes: number;
  copL: number;
  copR: number;
  tauAnkleL: number;
  tauAnkleR: number;
  feasible: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function planSupportForce(i: SupportForcePlannerInput): SupportForcePlannerOutput {
  const mass = Math.max(1e-6, Number.isFinite(i.mass) ? i.mass : 0);
  const az = Number.isFinite(i.az) ? i.az : 0;
  const fzTotal = Math.max(0, mass * (9.81 + az));
  const both = i.contactL && i.contactR && i.gripL && i.gripR && i.copInsideL && i.copInsideR;
  const oneL = i.contactL && i.gripL && i.copInsideL;
  const oneR = i.contactR && i.gripR && i.copInsideR;
  if (!oneL && !oneR) {
    return { fzTotal, fzL: 0, fzR: 0, copDes: i.comX, copL: i.comX, copR: i.comX, tauAnkleL: 0, tauAnkleR: 0, feasible: false };
  }
  const xL = Number.isFinite(i.footXL) ? i.footXL : i.comX;
  const xR = Number.isFinite(i.footXR) ? i.footXR : i.comX;
  const omega = Math.sqrt(9.81 / Math.max(0.3, Number.isFinite(i.comY) ? i.comY : 0.9));
  const copRaw = i.comX + (Number.isFinite(i.comVX) ? i.comVX : 0) / omega;
  const lo = Math.min(xL - Math.abs(i.halfXL), xR - Math.abs(i.halfXR)) + Math.abs(i.margin);
  const hi = Math.max(xL + Math.abs(i.halfXL), xR + Math.abs(i.halfXR)) - Math.abs(i.margin);
  const copDes = clamp(copRaw, Math.min(lo, hi), Math.max(lo, hi));
  let fzL = 0;
  let fzR = 0;
  if (both && Math.abs(xR - xL) > 1e-4) {
    const minSide = Math.min(Math.max(0, i.fzMin), fzTotal * 0.5);
    fzL = clamp(fzTotal * (xR - copDes) / (xR - xL), minSide, fzTotal - minSide);
    fzR = fzTotal - fzL;
  } else if (oneL) {
    fzL = fzTotal;
  } else if (oneR) {
    fzR = fzTotal;
  } else {
    fzL = fzTotal * 0.5;
    fzR = fzTotal * 0.5;
  }
  const copL = clamp(copDes, xL - Math.abs(i.halfXL), xL + Math.abs(i.halfXL));
  const copR = clamp(copDes, xR - Math.abs(i.halfXR), xR + Math.abs(i.halfXR));
  const cap = Math.max(0, Math.abs(i.tauAnkleMax));
  const tauAnkleL = clamp((copL - xL) * fzL, -cap, cap);
  const tauAnkleR = clamp((copR - xR) * fzR, -cap, cap);
  return { fzTotal, fzL, fzR, copDes, copL, copR, tauAnkleL, tauAnkleR, feasible: fzTotal > 0 };
}
