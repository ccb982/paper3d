export interface PressureCorrectionInput {
  fzDes: number;
  fzAct: number;
  copDes: number;
  copAct: number;
  footX: number;
  halfX: number;
  margin: number;
  tauMax: number;
  kf?: number;
  kp?: number;
  sign?: number;
}

export interface PressureCorrectionOutput {
  fz: number;
  cop: number;
  tau: number;
  fzErr: number;
  copErr: number;
  feasible: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function correctPressure(i: PressureCorrectionInput): PressureCorrectionOutput {
  const fzDes = Math.max(0, Number.isFinite(i.fzDes) ? i.fzDes : 0);
  const fzAct = Math.max(0, Number.isFinite(i.fzAct) ? i.fzAct : 0);
  const fzErr = fzDes - fzAct;
  const fz = Math.max(0, fzDes + Math.max(0, i.kf ?? 0.2) * fzErr);
  const lo = Math.min(i.footX - Math.abs(i.halfX), i.footX + Math.abs(i.halfX)) + Math.abs(i.margin);
  const hi = Math.max(i.footX - Math.abs(i.halfX), i.footX + Math.abs(i.halfX)) - Math.abs(i.margin);
  const copDes = Number.isFinite(i.copDes) ? i.copDes : i.copAct;
  const copAct = Number.isFinite(i.copAct) ? i.copAct : copDes;
  const copErr = copDes - copAct;
  const cop = clamp(copDes + Math.max(0, i.kp ?? 0.5) * copErr, Math.min(lo, hi), Math.max(lo, hi));
  const tauRaw = (i.sign ?? -1) * fz * (cop - i.footX);
  const cap = Math.max(0, Math.abs(i.tauMax));
  const tau = clamp(tauRaw, -cap, cap);
  return { fz, cop, tau, fzErr, copErr, feasible: fz > 0 && Math.abs(tauRaw) <= cap + 1e-9 };
}
