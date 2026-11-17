import type { LowerBodyContext } from './lowerBody';

export interface StandBalance {
  pRefX: number;
  pRefZ: number;
  fzLRef: number;
  fzRRef: number;
  support: 'both' | 'l' | 'r' | 'none';
  xiX: number;
  xiZ: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function planStandBalance(ctx: LowerBodyContext, refX: number, refZ: number): StandBalance {
  const body = ctx.world.body;
  const feet = ctx.world.perception.feet;
  const comX = ctx.sensors.com[0] ?? 0;
  const comZ = ctx.sensors.com[2] ?? 0;
  const vX = ctx.sensors.comVel[0] ?? 0;
  const vZ = ctx.sensors.comVel[2] ?? 0;
  const comY = Math.max(0.3, ctx.sensors.com[1] ?? 0.8);
  const omega = Math.sqrt(9.81 / comY);
  const xiX = (comX - refX) + vX / omega;
  const xiZ = (comZ - refZ) + vZ / omega;
  const li = body.indexByKey.get('foot_l') ?? -1;
  const ri = body.indexByKey.get('foot_r') ?? -1;
  const lp = li >= 0 ? body.bodies[li]!.translation() : { x: refX, y: 0, z: refZ };
  const rp = ri >= 0 ? body.bodies[ri]!.translation() : { x: refX, y: 0, z: refZ };
  const xMin = Math.min(lp.x, rp.x);
  const xMax = Math.max(lp.x, rp.x);
  const zMin = Math.min(lp.z, rp.z);
  const zMax = Math.max(lp.z, rp.z);
  const pRefX = clamp(refX + xiX, xMin, xMax);
  const pRefZ = clamp(refZ + xiZ, zMin, zMax);
  const W = Math.max(1, ctx.world.sk.massTotal * 9.81);
  const dz = rp.z - lp.z;
  const fzLRef = Math.abs(dz) < 1e-4 ? W * 0.5 : W * (rp.z - pRefZ) / dz;
  const minLoad = W * 0.1;
  const fzL = clamp(fzLRef, minLoad, W - minLoad);
  const support = feet[0]!.contact && feet[1]!.contact ? 'both' : feet[0]!.contact ? 'l' : feet[1]!.contact ? 'r' : 'none';
  return { pRefX, pRefZ, fzLRef: fzL, fzRRef: W - fzL, support, xiX, xiZ };
}
