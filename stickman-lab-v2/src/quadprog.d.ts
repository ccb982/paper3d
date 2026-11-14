declare module 'quadprog' {
  export interface QpResult {
    solution?: number[];
    Lagrangian?: number[];
    value?: number[];
    unconstrained_solution?: number[];
    iterations?: number[];
    iact?: number[];
    message?: string;
  }
  export function solveQP(Dmat: number[][], dvec: number[], Amat: number[][], bvec?: number[], meq?: number, factorized?: [number, number]): QpResult;
}
