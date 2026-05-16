import type {
  ExplosionParams,
  PhysicalState,
  ExplosionProfiles,
} from './types';
import { DEFAULT_EXPLOSION_PARAMS } from './types';

export class Explosion1DSolver {
  private static MAX_SUBSTEPS = 2000;
  private static GAS_CONSTANT = 287.058;

  private gamma: number = 1.4;
  private cfl: number = 0.4;
  private shockThreshold: number = 1.5;
  private N: number = 256;
  private r: Float64Array = new Float64Array(0);
  private rHalf: Float64Array = new Float64Array(0);
  private dr: Float64Array = new Float64Array(0);
  private volume: Float64Array = new Float64Array(0);
  private area: Float64Array = new Float64Array(0);
  private U: Float64Array[] = [];
  private Unew: Float64Array[] = [];
  private rho: Float64Array = new Float64Array(0);
  private u: Float64Array = new Float64Array(0);
  private p: Float64Array = new Float64Array(0);
  private T: Float64Array = new Float64Array(0);
  private t: number = 0;
  private active: boolean = true;
  private shockRadius: number = 0;
  private ambientRho: number = 1.225;
  private ambientP: number = 101325;
  private ambientT: number = 288.15;

  constructor(params: ExplosionParams) {
    const p = { ...DEFAULT_EXPLOSION_PARAMS, ...params };
    this.gamma = p.gamma;
    this.cfl = p.cfl;
    this.shockThreshold = p.shockThreshold;
    this.ambientRho = p.ambientDensity;
    this.ambientP = p.ambientPressure;
    this.ambientT = this.ambientP / (Explosion1DSolver.GAS_CONSTANT * this.ambientRho);
    this.N = p.N;
    this.buildGeometricGrid(p.rMin, p.rMax);
    this.allocateArrays();
    this.initialize(p.totalEnergy, p.initialRadius);
  }

  private buildGeometricGrid(rMin: number, rMax: number): void {
    const alpha = Math.pow(rMax / rMin, 1 / this.N);
    this.rHalf = new Float64Array(this.N + 1);
    this.rHalf[0] = rMin;
    for (let i = 1; i <= this.N; i++) {
      this.rHalf[i] = this.rHalf[i - 1] * alpha;
    }
    this.r = new Float64Array(this.N);
    this.dr = new Float64Array(this.N);
    this.volume = new Float64Array(this.N);
    this.area = new Float64Array(this.N + 1);
    for (let i = 0; i < this.N; i++) {
      const rL = this.rHalf[i];
      const rR = this.rHalf[i + 1];
      this.r[i] = (rL + rR) / 2;
      this.dr[i] = rR - rL;
      this.volume[i] = (4 / 3) * Math.PI * (rR ** 3 - rL ** 3);
      this.area[i] = 4 * Math.PI * rL * rL;
    }
    this.area[this.N] = 4 * Math.PI * this.rHalf[this.N] ** 2;
  }

  private allocateArrays(): void {
    this.U = [
      new Float64Array(this.N),
      new Float64Array(this.N),
      new Float64Array(this.N),
    ];
    this.Unew = [
      new Float64Array(this.N),
      new Float64Array(this.N),
      new Float64Array(this.N),
    ];
    this.rho = new Float64Array(this.N);
    this.u = new Float64Array(this.N);
    this.p = new Float64Array(this.N);
    this.T = new Float64Array(this.N);
  }

  private primToCons(i: number): void {
    const rho = this.rho[i];
    const u = this.u[i];
    const p = this.p[i];
    const e = p / (rho * (this.gamma - 1));
    this.U[0][i] = rho;
    this.U[1][i] = rho * u;
    this.U[2][i] = rho * (e + 0.5 * u * u);
  }

  private consToPrim(i: number): void {
    const rho = this.U[0][i];
    const mom = this.U[1][i];
    const E = this.U[2][i];
    const u = mom / rho;
    const e = E / rho - 0.5 * u * u;
    const p = Math.max(e * (this.gamma - 1) * rho, 1e-10);
    this.rho[i] = rho;
    this.u[i] = u;
    this.p[i] = p;
    this.T[i] = p / (Explosion1DSolver.GAS_CONSTANT * rho);
  }

  private initialize(totalEnergy: number, r0: number): void {
    const P_inside = (this.gamma - 1) * totalEnergy / ((4 / 3) * Math.PI * r0 ** 3);
    const smoothWidth = r0 * 0.3;
    for (let i = 0; i < this.N; i++) {
      const rVal = this.r[i];
      const diff = (rVal - r0) / smoothWidth;
      const coeff = rVal <= r0 ? 1.0 : Math.exp(-(diff ** 2));
      this.p[i] = P_inside * coeff + this.ambientP * (1 - coeff);
      this.rho[i] = this.ambientRho * (1.0 + 0.5 * coeff);
      this.u[i] = 0;
      this.primToCons(i);
      this.T[i] = this.p[i] / (Explosion1DSolver.GAS_CONSTANT * this.rho[i]);
    }
    this.updateShockRadius();
  }

  private updateShockRadius(): void {
    let maxGrad = 0;
    let idx = 0;
    for (let i = 1; i < this.N; i++) {
      const dp = this.p[i] - this.p[i - 1];
      const dr = this.r[i] - this.r[i - 1];
      const grad = Math.abs(dp / dr);
      if (grad > maxGrad) {
        maxGrad = grad;
        idx = i;
      }
    }
    this.shockRadius = this.r[idx];
    if (this.p[0] < this.ambientP * this.shockThreshold) {
      this.active = false;
    }
  }

  private soundSpeed(rho: number, p: number): number {
    return Math.sqrt((this.gamma * p) / rho);
  }

  private minmod(a: number, b: number): number {
    if (a * b <= 0) return 0;
    return Math.abs(a) < Math.abs(b) ? a : b;
  }

  private extrapolateToRight(cell: number): { rho: number; u: number; p: number } {
    if (cell >= this.N - 1) {
      return { rho: this.rho[this.N - 1], u: this.u[this.N - 1], p: this.p[this.N - 1] };
    }
    const iC = cell;
    const iR = cell + 1;
    const slopeRho = this.minmod(
      this.rho[iR] - this.rho[iC],
      this.rho[iC] - (cell > 0 ? this.rho[cell - 1] : this.rho[iC])
    );
    const slopeU = this.minmod(
      this.u[iR] - this.u[iC],
      this.u[iC] - (cell > 0 ? this.u[cell - 1] : this.u[iC])
    );
    const slopeP = this.minmod(
      this.p[iR] - this.p[iC],
      this.p[iC] - (cell > 0 ? this.p[cell - 1] : this.p[iC])
    );
    return {
      rho: this.rho[iC] + 0.5 * slopeRho,
      u: this.u[iC] + 0.5 * slopeU,
      p: this.p[iC] + 0.5 * slopeP,
    };
  }

  private extrapolateToLeft(cell: number): { rho: number; u: number; p: number } {
    if (cell <= 0) {
      return { rho: this.rho[0], u: this.u[0], p: this.p[0] };
    }
    const iC = cell;
    const iL = cell - 1;
    const slopeRho = this.minmod(
      this.rho[iC] - this.rho[iL],
      cell < this.N - 1 ? this.rho[cell + 1] - this.rho[iC] : 0
    );
    const slopeU = this.minmod(
      this.u[iC] - this.u[iL],
      cell < this.N - 1 ? this.u[cell + 1] - this.u[iC] : 0
    );
    const slopeP = this.minmod(
      this.p[iC] - this.p[iL],
      cell < this.N - 1 ? this.p[cell + 1] - this.p[iC] : 0
    );
    return {
      rho: this.rho[iC] - 0.5 * slopeRho,
      u: this.u[iC] - 0.5 * slopeU,
      p: this.p[iC] - 0.5 * slopeP,
    };
  }

  private hllcFlux(
    left: { rho: number; u: number; p: number },
    right: { rho: number; u: number; p: number }
  ): number[] {
    const gamma = this.gamma;
    const eL = left.p / (left.rho * (gamma - 1));
    const eR = right.p / (right.rho * (gamma - 1));
    const EL = left.rho * (eL + 0.5 * left.u * left.u);
    const ER = right.rho * (eR + 0.5 * right.u * right.u);
    const cL = Math.sqrt(gamma * left.p / left.rho);
    const cR = Math.sqrt(gamma * right.p / right.rho);
    const SL = Math.min(left.u - cL, right.u - cR);
    const SR = Math.max(left.u + cL, right.u + cR);
    const denom = left.rho * (SL - left.u) - right.rho * (SR - right.u);
    const Sstar =
      Math.abs(denom) > 1e-12
        ? (right.p - left.p +
            left.rho * left.u * (SL - left.u) -
            right.rho * right.u * (SR - right.u)) /
          denom
        : 0.5 * (left.u + right.u);
    const fluxL = [
      left.rho * left.u,
      left.rho * left.u * left.u + left.p,
      left.u * (EL + left.p),
    ];
    const fluxR = [
      right.rho * right.u,
      right.rho * right.u * right.u + right.p,
      right.u * (ER + right.p),
    ];
    if (SL >= 0) return fluxL;
    if (SR <= 0) return fluxR;
    if (Sstar >= 0) {
      const f = fluxL;
      const rhoStar = (left.rho * (SL - left.u)) / (SL - Sstar);
      f[0] += SL * (rhoStar - left.rho);
      f[1] += SL * (rhoStar * Sstar - left.rho * left.u);
      f[2] +=
        SL *
        (rhoStar *
          (EL / left.rho +
            (Sstar - left.u) *
              (Sstar + left.p / (left.rho * (SL - left.u)))) -
          EL);
      return f;
    } else {
      const f = fluxR;
      const rhoStar = (right.rho * (SR - right.u)) / (SR - Sstar);
      f[0] += SR * (rhoStar - right.rho);
      f[1] += SR * (rhoStar * Sstar - right.rho * right.u);
      f[2] +=
        SR *
        (rhoStar *
          (ER / right.rho +
            (Sstar - right.u) *
              (Sstar + right.p / (right.rho * (SR - right.u)))) -
          ER);
      return f;
    }
  }

  private substep(dt: number): void {
    for (let i = 0; i < this.N; i++) this.consToPrim(i);

    for (let i = 0; i < this.N; i++) {
      const rho = this.rho[i];
      const u = this.u[i];
      const p = this.p[i];
      const E = this.U[2][i];
      const rInv = this.r[i] > 1e-4 ? 2.0 / this.r[i] : 0.0;
      const source0 = -rInv * rho * u;
      const source1 = -rInv * rho * u * u;
      const source2 = -rInv * u * (E + p);
      this.Unew[0][i] = this.U[0][i] + 0.5 * dt * source0;
      this.Unew[1][i] = this.U[1][i] + 0.5 * dt * source1;
      this.Unew[2][i] = this.U[2][i] + 0.5 * dt * source2;
    }
    [this.U, this.Unew] = [this.Unew, this.U];
    for (let i = 0; i < this.N; i++) this.consToPrim(i);

    const F = new Float64Array(3 * (this.N + 1));

    {
      const stateR = this.extrapolateToLeft(0);
      const stateL = { rho: stateR.rho, u: -stateR.u, p: stateR.p };
      const flux = this.hllcFlux(stateL, stateR);
      F[0] = flux[0];
      F[1] = flux[1];
      F[2] = flux[2];
    }

    for (let i = 1; i < this.N; i++) {
      const stateL = this.extrapolateToRight(i - 1);
      const stateR = this.extrapolateToLeft(i);
      const flux = this.hllcFlux(stateL, stateR);
      const base = 3 * i;
      F[base] = flux[0];
      F[base + 1] = flux[1];
      F[base + 2] = flux[2];
    }

    {
      const stateL = this.extrapolateToRight(this.N - 1);
      const stateR = stateL;
      const flux = this.hllcFlux(stateL, stateR);
      const base = 3 * this.N;
      F[base] = flux[0];
      F[base + 1] = flux[1];
      F[base + 2] = flux[2];
    }

    for (let i = 0; i < this.N; i++) {
      const idxL = 3 * i;
      const idxR = 3 * (i + 1);
      const AiL = this.area[i];
      const AiR = this.area[i + 1];
      const vol = this.volume[i];
      for (let k = 0; k < 3; k++) {
        this.Unew[k][i] =
          this.U[k][i] - (dt / vol) * (AiR * F[idxR + k] - AiL * F[idxL + k]);
      }
    }
    [this.U, this.Unew] = [this.Unew, this.U];
    for (let i = 0; i < this.N; i++) this.consToPrim(i);

    for (let i = 0; i < this.N; i++) {
      const rho = this.rho[i];
      const u = this.u[i];
      const p = this.p[i];
      const E = this.U[2][i];
      const rInv = this.r[i] > 1e-4 ? 2.0 / this.r[i] : 0.0;
      const source0 = -rInv * rho * u;
      const source1 = -rInv * rho * u * u;
      const source2 = -rInv * u * (E + p);
      this.Unew[0][i] = this.U[0][i] + 0.5 * dt * source0;
      this.Unew[1][i] = this.U[1][i] + 0.5 * dt * source1;
      this.Unew[2][i] = this.U[2][i] + 0.5 * dt * source2;
    }
    [this.U, this.Unew] = [this.Unew, this.U];
    this.applyBC();
    for (let i = 0; i < this.N; i++) this.consToPrim(i);
  }

  private applyBC(): void {
    this.U[0][0] = this.U[0][1];
    this.U[1][0] = -this.U[1][1];
    this.U[2][0] = this.U[2][1];
    const iE = this.N - 1;
    this.U[0][iE] = this.U[0][iE - 1];
    this.U[1][iE] = this.U[1][iE - 1];
    this.U[2][iE] = this.U[2][iE - 1];
  }

  private maxDt(): number {
    let dtMax = Infinity;
    for (let i = 0; i < this.N; i++) {
      const c = this.soundSpeed(this.rho[i], this.p[i]);
      const localDt = this.cfl * this.dr[i] / (Math.abs(this.u[i]) + c);
      if (localDt < dtMax) dtMax = localDt;
    }
    return dtMax;
  }

  public advanceTo(targetTime: number): void {
    if (!this.active) return;
    let steps = 0;
    while (
      this.t < targetTime - 1e-9 &&
      steps++ < Explosion1DSolver.MAX_SUBSTEPS
    ) {
      const dtRemaining = targetTime - this.t;
      const maxDt = this.maxDt();
      const dt = Math.min(maxDt, dtRemaining);
      if (dt <= 1e-12) break;
      this.substep(dt);
      this.t += dt;
      this.updateShockRadius();
      if (!this.active) break;
    }
    if (Math.abs(this.t - targetTime) < 1e-9) this.t = targetTime;
  }

  public getTime(): number {
    return this.t;
  }

  public isActive(): boolean {
    return this.active;
  }

  public sample(r: number): PhysicalState {
    if (r <= this.r[0])
      return { rho: this.rho[0], u: this.u[0], p: this.p[0], T: this.T[0] };
    if (r >= this.r[this.N - 1])
      return {
        rho: this.rho[this.N - 1],
        u: this.u[this.N - 1],
        p: this.p[this.N - 1],
        T: this.T[this.N - 1],
      };
    let lo = 0,
      hi = this.N - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.r[mid] < r) lo = mid;
      else hi = mid;
    }
    const t = (r - this.r[lo]) / (this.r[hi] - this.r[lo]);
    return {
      rho: this.rho[lo] * (1 - t) + this.rho[hi] * t,
      u: this.u[lo] * (1 - t) + this.u[hi] * t,
      p: this.p[lo] * (1 - t) + this.p[hi] * t,
      T: this.T[lo] * (1 - t) + this.T[hi] * t,
    };
  }

  public getShockRadius(): number {
    return this.shockRadius;
  }

  public getShockSpeed(): number {
    return this.sample(this.shockRadius).u;
  }

  public getProfiles(): ExplosionProfiles {
    return {
      r: new Float64Array(this.r),
      rho: new Float64Array(this.rho),
      u: new Float64Array(this.u),
      p: new Float64Array(this.p),
      T: new Float64Array(this.T),
    };
  }

  public getCoreTemperature(): number {
    return this.T[0];
  }

  public getCorePressure(): number {
    return this.p[0];
  }

  public getAmbientPressure(): number {
    return this.ambientP;
  }

  public getPressureGradient(r1: number, r2: number): number {
    if (r2 <= r1) return 0;
    const s1 = this.sample(Math.max(r1, this.r[0]));
    const s2 = this.sample(Math.min(r2, this.r[this.N - 1]));
    const dr = r2 - r1;
    return (s2.p - s1.p) / dr;
  }

  public destroy(): void {
    this.active = false;
    this.U = [];
    this.Unew = [];
    this.rho = undefined as any;
    this.u = undefined as any;
    this.p = undefined as any;
    this.T = undefined as any;
    this.r = undefined as any;
    this.rHalf = undefined as any;
    this.dr = undefined as any;
    this.volume = undefined as any;
    this.area = undefined as any;
  }
}