export interface SupportWrenchInput {
  fz: number;
  copX: number;
  copZ: number;
  footX: number;
  footZ: number;
  halfX: number;
  halfZ: number;
  fzMax: number;
  mu: number;
}

export interface SupportWrench {
  fz: number;
  copX: number;
  copZ: number;
  ftx: number;
  ftz: number;
  frictionMax: number;
  feasible: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function projectSupportWrench(i: SupportWrenchInput): SupportWrench {
  const fz = clamp(Number.isFinite(i.fz) ? i.fz : 0, 0, Math.max(0, i.fzMax));
  const halfX = Math.max(0, i.halfX);
  const halfZ = Math.max(0, i.halfZ);
  const copX = clamp(Number.isFinite(i.copX) ? i.copX : i.footX, i.footX - halfX, i.footX + halfX);
  const copZ = clamp(Number.isFinite(i.copZ) ? i.copZ : i.footZ, i.footZ - halfZ, i.footZ + halfZ);
  const frictionMax = Math.max(0, i.mu) * fz;
  return {
    fz,
    copX,
    copZ,
    ftx: 0,
    ftz: 0,
    frictionMax,
    feasible: fz > 0 && copX >= i.footX - halfX && copX <= i.footX + halfX && copZ >= i.footZ - halfZ && copZ <= i.footZ + halfZ,
  };
}
