import { Explosion1DSolver } from '../Explosion1DSolver';
import { FluidSimulator } from '../../fluid-simulator/fluid-simulator/FluidSimulator';
import { InjectionParams, DEFAULT_INJECTION_PARAMS } from '../types';

export class FluidIntegrator {
  private simulator: FluidSimulator;
  private injectionParams: InjectionParams;
  private worldToUVScale: number = 1.0;

  constructor(simulator: FluidSimulator, injectionParams?: Partial<InjectionParams>) {
    this.simulator = simulator;
    this.injectionParams = { ...DEFAULT_INJECTION_PARAMS, ...injectionParams };
  }

  public setInjectionParams(params: Partial<InjectionParams>): void {
    this.injectionParams = { ...this.injectionParams, ...params };
  }

  public setWorldToUVScale(scale: number): void {
    this.worldToUVScale = scale;
  }

  public inject(
    explosion: Explosion1DSolver,
    worldCenterX: number,
    worldCenterY: number
  ): void {
    if (!explosion.isActive()) return;

    const shockRadius = explosion.getShockRadius();
    const fireballRadius = shockRadius * this.injectionParams.fireballRadiusRatio;

    const centerX = worldCenterX * this.worldToUVScale;
    const centerY = worldCenterY * this.worldToUVScale;
    const fireballRadiusUV = fireballRadius * this.worldToUVScale;
    const shockRadiusUV = shockRadius * this.worldToUVScale;

    this.injectDivergence(explosion, centerX, centerY, fireballRadiusUV, shockRadius);
    this.injectVelocity(explosion, centerX, centerY, shockRadiusUV);

    if (this.injectionParams.waterStrength > 0) {
      this.injectWater(explosion, centerX, centerY, fireballRadiusUV);
    }
  }

  private injectDivergence(
    explosion: Explosion1DSolver,
    cx: number,
    cy: number,
    fireballRadiusUV: number,
    shockRadius: number
  ): void {
    if (shockRadius <= 0) return;

    const gradient = explosion.getPressureGradient(0.01, shockRadius * 0.8);
    const divergence = -Math.min(
      gradient * this.injectionParams.divergenceStrength,
      10.0
    );

    this.simulator.addDivergenceImpulse(divergence, fireballRadiusUV, cx, cy);
  }

  private injectVelocity(
    explosion: Explosion1DSolver,
    cx: number,
    cy: number,
    shockRadiusUV: number
  ): void {
    const vel = explosion.getShockSpeed();
    if (vel <= 0) return;

    const dv = vel * this.injectionParams.velocityStrength;
    this.simulator.addLocalVelocityImpulse(dv, dv, shockRadiusUV, cx, cy, 5.0);
  }

  private injectWater(
    explosion: Explosion1DSolver,
    cx: number,
    cy: number,
    fireballRadiusUV: number
  ): void {
    const coreTemp = explosion.getCoreTemperature();
    const ambientTemp = 288.15;
    const tempRatio = coreTemp / ambientTemp;

    const waterAmount = this.injectionParams.waterStrength * (tempRatio - 1);
    if (waterAmount > 0) {
      this.simulator.addWaterImpulse(waterAmount, fireballRadiusUV, cx, cy);
    }
  }
}