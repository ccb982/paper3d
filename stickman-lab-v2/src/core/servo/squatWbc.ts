export interface SquatWbcInput {
  tau: [number, number, number];
  tauDes: [number, number, number];
  tauMin: [number, number, number];
  tauMax: [number, number, number];
  com: [number, number, number];
  comTarget: [number, number, number];
  cop: [number, number];
  copTarget: [number, number];
  jCom: [number, number, number][];
  jComY?: [number, number, number];
  jCop: [number, number, number][];
  m?: [number, number, number];
  gTau?: [number, number, number];
  wB?: number;
  wCom?: number;
  wComY?: number;
  wCop?: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function solveSquatWbc(i: SquatWbcInput): [number, number, number] {
  const wB = Math.max(0, i.wB ?? 1);
  const wCom = Math.max(0, i.wCom ?? 1);
  const wComY = Math.max(0, i.wComY ?? 1);
  const wCop = Math.max(0, i.wCop ?? 1);
  const A = [
    [wB, 0, 0],
    [0, wB, 0],
    [0, 0, wB],
  ];
  const rhs = [
    wB * (i.tauDes[0] - i.tau[0]),
    wB * (i.tauDes[1] - i.tau[1]),
    wB * (i.tauDes[2] - i.tau[2]),
  ];
  const add = (j: [number, number, number], e: number, w: number): void => {
    for (let a = 0; a < 3; a++) {
      rhs[a] += w * j[a] * e;
      for (let c = 0; c < 3; c++) A[a][c] += w * j[a] * j[c];
    }
  };
  const m = i.m ?? [1, 1, 1];
  const g = i.gTau ?? [0, 0, 0];
  const addDyn = (j: [number, number, number], e: number, w: number): void => {
    const jd: [number, number, number] = [j[0] / Math.max(1e-6, m[0]), j[1] / Math.max(1e-6, m[1]), j[2] / Math.max(1e-6, m[2])];
    const cur = jd[0] * (i.tau[0] - g[0]) + jd[1] * (i.tau[1] - g[1]) + jd[2] * (i.tau[2] - g[2]);
    add(jd, e - cur, w);
  };
  const taskAdd = i.m && i.gTau ? addDyn : add;
  taskAdd(i.jCom[0], i.comTarget[0] - i.com[0], wCom);
  taskAdd(i.jCom[1], i.comTarget[1] - i.com[1], wCom);
  if (i.jComY) taskAdd(i.jComY, i.comTarget[2] - i.com[2], wComY);
  add(i.jCop[0], i.copTarget[0] - i.cop[0], wCop);
  add(i.jCop[1], i.copTarget[1] - i.cop[1], wCop);
  for (let k = 0; k < 3; k++) A[k][k] += 1e-6;
  for (let k = 0; k < 3; k++) {
    let p = k;
    for (let r = k + 1; r < 3; r++) if (Math.abs(A[r][k]) > Math.abs(A[p][k])) p = r;
    [A[k], A[p]] = [A[p], A[k]];
    [rhs[k], rhs[p]] = [rhs[p], rhs[k]];
    const d = A[k][k] || 1e-9;
    for (let c = k; c < 3; c++) A[k][c] /= d;
    rhs[k] /= d;
    for (let r = 0; r < 3; r++) {
      if (r === k) continue;
      const f = A[r][k];
      if (!f) continue;
      for (let c = k; c < 3; c++) A[r][c] -= f * A[k][c];
      rhs[r] -= f * rhs[k];
    }
  }
  return [
    clamp(i.tau[0] + rhs[0], i.tauMin[0], i.tauMax[0]),
    clamp(i.tau[1] + rhs[1], i.tauMin[1], i.tauMax[1]),
    clamp(i.tau[2] + rhs[2], i.tauMin[2], i.tauMax[2]),
  ];
}
