const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export interface SquatHipCommandInput {
  tau: [number, number];
  tauDes: [number, number];
  tauMin: [number, number];
  tauMax: [number, number];
  com: [number, number, number];
  comTarget: [number, number, number];
  jCom: [number, number][];
  wB?: number;
  wCom?: number;
}

export function solveSquatHipCommand(i: SquatHipCommandInput): [number, number] {
  const wB = Math.max(0, i.wB ?? 0.01);
  const wCom = Math.max(0, i.wCom ?? 1);
  const A = [
    [wB, 0],
    [0, wB],
  ];
  const rhs = [wB * (i.tauDes[0] - i.tau[0]), wB * (i.tauDes[1] - i.tau[1])];
  const add = (j: [number, number], e: number): void => {
    for (let a = 0; a < 2; a++) {
      rhs[a] += wCom * j[a] * e;
      for (let c = 0; c < 2; c++) A[a][c] += wCom * j[a] * j[c];
    }
  };
  add(i.jCom[0], i.comTarget[0] - i.com[0]);
  add(i.jCom[1], i.comTarget[1] - i.com[1]);
  add(i.jCom[2], i.comTarget[2] - i.com[2]);
  for (let k = 0; k < 2; k++) A[k][k] += 1e-6;
  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
  const d0 = det !== 0 ? (rhs[0] * A[1][1] - A[0][1] * rhs[1]) / det : 0;
  const d1 = det !== 0 ? (A[0][0] * rhs[1] - rhs[0] * A[1][0]) / det : 0;
  return [
    clamp(i.tau[0] + d0, i.tauMin[0], i.tauMax[0]),
    clamp(i.tau[1] + d1, i.tauMin[1], i.tauMax[1]),
  ];
}

export interface SquatShankCommandInput {
  tau: number;
  tauDes: number;
  tauMin: number;
  tauMax: number;
  cop: number;
  copTarget: number;
  jCop: number;
  wB?: number;
  wCop?: number;
}

export function solveSquatShankCommand(i: SquatShankCommandInput): number {
  const wB = Math.max(0, i.wB ?? 0.01);
  const wCop = Math.max(0, i.wCop ?? 1);
  const den = wB + wCop * i.jCop * i.jCop + 1e-6;
  const d = (wB * (i.tauDes - i.tau) + wCop * i.jCop * (i.copTarget - i.cop)) / den;
  return clamp(i.tau + d, i.tauMin, i.tauMax);
}
