import type { World } from '../world';

export interface SquatModelValidation {
  axes: number[];
  symmetry: number;
  diagError: number;
  minPivot: number;
  finite: boolean;
  biasNorm: number;
  jacNorm: number;
}

export function validateSquatModel(w: World): SquatModelValidation {
  const axes = [
    w.body.dofByName('hip_l', 2), w.body.dofByName('knee_l', 2), w.body.dofByName('foot_l', 2),
    w.body.dofByName('hip_r', 2), w.body.dofByName('knee_r', 2), w.body.dofByName('foot_r', 2),
  ];
  const n = axes.length;
  const M = new Float64Array(n * n);
  w.body.massMatrixBlock(axes, M);
  let symmetry = 0;
  let diagError = 0;
  for (let r = 0; r < n; r++) {
    const d = w.body.jointInertia(axes[r]!);
    diagError = Math.max(diagError, Math.abs(M[r * n + r]! - d) / Math.max(1e-6, Math.abs(d)));
    for (let c = 0; c < n; c++) symmetry = Math.max(symmetry, Math.abs(M[r * n + c]! - M[c * n + r]!));
  }
  const A = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => M[r * n + c]!));
  let minPivot = Number.POSITIVE_INFINITY;
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let r = k + 1; r < n; r++) if (Math.abs(A[r]![k]!) > Math.abs(A[p]![k]!)) p = r;
    [A[k], A[p]] = [A[p]!, A[k]!];
    const piv = A[k]![k]!;
    minPivot = Math.min(minPivot, piv);
    if (Math.abs(piv) < 1e-12) continue;
    for (let r = k + 1; r < n; r++) {
      const f = A[r]![k]! / piv;
      for (let c = k; c < n; c++) A[r]![c] = A[r]![c]! - f * A[k]![c]!;
    }
  }
  const J = new Float64Array(w.body.dofs.length * 3);
  const foot = w.body.bodies[w.body.indexByKey.get('foot_l') ?? 0]!;
  const p = foot.translation();
  w.body.pointJacobian(p.x, p.y, p.z, J);
  let jacNorm = 0;
  for (const v of J) jacNorm = Math.max(jacNorm, Math.abs(v));
  const h = new Float64Array(w.body.dofs.length);
  w.body.biasForce(h);
  let biasNorm = 0;
  for (const v of h) biasNorm = Math.max(biasNorm, Math.abs(v));
  const finite = [...M, ...J, ...h].every((v) => Number.isFinite(v));
  return { axes, symmetry, diagError, minPivot, finite, biasNorm, jacNorm };
}
