export interface SupportQpFoot {
  active: boolean;
  x: number;
  y: number;
  halfX: number;
  fzRef: number;
  copXRef: number;
  fzMax: number;
  fzMin?: number;
  mu: number;
}

export interface SupportQpInput {
  mass: number;
  gravity: number;
  comX: number;
  comY: number;
  aX: number;
  aY: number;
  lDotZ: number;
  feet: [SupportQpFoot, SupportQpFoot];
  prevFz?: [number, number];
  weights?: { fz?: number; fx?: number; tau?: number; rate?: number };
}

export interface SupportQpOutput {
  feasible: boolean;
  fz: [number, number];
  fx: [number, number];
  tauZ: [number, number];
  copX: [number, number];
  totalFz: number;
  totalFx: number;
  totalMz: number;
  momentSlack: number;
  momentResidual: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function bounds(foot: SupportQpFoot): [number, number] {
  if (!foot.active) return [0, 0];
  const hi = Math.max(0, foot.fzMax);
  const lo = clamp(foot.fzMin ?? 0, 0, hi);
  return [lo, hi];
}

export function solveSupportQp(input: SupportQpInput): SupportQpOutput {
  const total = Math.max(0, input.mass * (input.gravity + input.aY));
  const ref: [number, number] = [Math.max(0, input.feet[0].fzRef), Math.max(0, input.feet[1].fzRef)];
  const active: [boolean, boolean] = [input.feet[0].active, input.feet[1].active];
  const [loL, hiL] = bounds(input.feet[0]);
  const [loR, hiR] = bounds(input.feet[1]);
  let fz: [number, number] = [0, 0];
  let feasible = true;

  if (!active[0] && !active[1]) {
    feasible = total <= 1e-6;
  } else if (active[0] && active[1]) {
    if (total < loL + loR || total > hiL + hiR) feasible = false;
    const refSum = ref[0] + ref[1];
    const targetL = refSum > 1e-9 ? total * (ref[0] / refSum) : total * 0.5;
    const minL = Math.max(loL, total - hiR);
    const maxL = Math.min(hiL, total - loR);
    if (minL <= maxL) {
      fz[0] = clamp(targetL, minL, maxL);
    } else {
      fz[0] = clamp(targetL, loL, hiL);
      feasible = false;
    }
    fz[1] = clamp(total - fz[0], loR, hiR);
    fz[0] = clamp(total - fz[1], loL, hiL);
  } else if (active[0]) {
    fz[0] = clamp(total, loL, hiL);
    feasible = total >= loL - 1e-6 && total <= hiL + 1e-6;
  } else {
    fz[1] = clamp(total, loR, hiR);
    feasible = total >= loR - 1e-6 && total <= hiR + 1e-6;
  }

  if (!Number.isFinite(fz[0]) || !Number.isFinite(fz[1])) {
    fz = [0, 0];
    feasible = false;
  }
  const copX: [number, number] = [input.feet[0].x, input.feet[1].x];
  return {
    feasible,
    fz,
    fx: [0, 0],
    tauZ: [0, 0],
    copX,
    totalFz: fz[0] + fz[1],
    totalFx: 0,
    totalMz: 0,
    momentSlack: 0,
    momentResidual: 0,
  };
}
