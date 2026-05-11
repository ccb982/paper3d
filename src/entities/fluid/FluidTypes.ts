import * as THREE from 'three';

export enum FluidLOD {
  HIGH   = 0,
  MEDIUM = 1,
  LOW    = 2,
  OFF    = 3
}

export interface IFluidForceTarget {
  isMovable(): boolean;
  applyFluidForce(force: import('./FluidExternalForce').FluidExternalForce): void;
}