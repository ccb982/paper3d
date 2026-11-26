export interface AnkleSupportCommandInput {
  fzDes: number;
  fzAct: number;
  copDes: number;
  copAct: number;
  copVel: number;
  ankleX: number;
  copMin: number;
  copMax: number;
  tauMax: number;
  kp: number;
  kd: number;
  sign: number;
}

export interface AnkleSupportCommandOutput {
  tau: number;
  copTarget: number;
  copError: number;
  feasible: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function ankleSupportCommand(i: AnkleSupportCommandInput): AnkleSupportCommandOutput {
  const fzDes = Math.max(0, Number.isFinite(i.fzDes) ? i.fzDes : 0);
  const fzAct = Math.max(0, Number.isFinite(i.fzAct) ? i.fzAct : 0);
  const fz = fzAct > 1e-6 ? fzAct : fzDes;
  const copTarget = clamp(
    Number.isFinite(i.copDes) ? i.copDes : i.copAct,
    Math.min(i.copMin, i.copMax),
    Math.max(i.copMin, i.copMax),
  );
  const copAct = Number.isFinite(i.copAct) ? i.copAct : copTarget;
  const copVel = Number.isFinite(i.copVel) ? i.copVel : 0;
  const err = copTarget - copAct;
  const ff = fzDes * (copTarget - i.ankleX);
  const fb = fz * (i.kp * err - i.kd * copVel);
  const tauRaw = i.sign * (ff + fb);
  const tauCap = Math.max(0, Math.abs(i.tauMax));
  return {
    tau: clamp(tauRaw, -tauCap, tauCap),
    copTarget,
    copError: err,
    feasible: fzDes > 1e-6 && Math.abs(tauRaw) <= tauCap + 1e-9,
  };
}
