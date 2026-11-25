export interface SupportQpFoot {
  active: boolean;
  x: number;
  halfX: number;
  fzRef: number;
  copXRef: number;
  fzMax: number;
  fzMin?: number;
}

export interface SupportQpInput {
  mass: number;
  gravity: number;
  aY: number;
  feet: [SupportQpFoot, SupportQpFoot];
}

export interface SupportQpOutput {
  feasible: boolean;
  fz: [number, number];
  copX: [number, number];
  totalFz: number;
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
  const copX: [number, number] = [
    clamp(input.feet[0].copXRef, input.feet[0].x - input.feet[0].halfX, input.feet[0].x + input.feet[0].halfX),
    clamp(input.feet[1].copXRef, input.feet[1].x - input.feet[1].halfX, input.feet[1].x + input.feet[1].halfX),
  ];
  return {
    feasible,
    fz,
    copX,
    totalFz: fz[0] + fz[1],
  };
}
