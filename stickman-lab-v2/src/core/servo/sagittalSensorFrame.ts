import type { World } from '../world';
import type { ControlModule } from '../control';
import type { FootSensorReading } from './footContact';
import type { ShankIKSolution, ShankLegRef } from './shankIK';
import { sensePelvis } from './pelvisSense';
import type {
  SagittalBaseReference,
  SagittalLegSensor,
  SagittalMode,
  SagittalForceMode,
  SagittalPelvisState,
  SagittalComState,
  SagittalBoundaryState,
  SagittalSensorFrame,
} from './sagittalIdTypes';

export interface SagittalChainInput {
  fParallel: number;
  fParallelSigned: number;
  fPerp: number;
  fPerpSag: number;
  fLat: number;
  feasible: boolean;
  copInside: boolean;
  tauUtil: number;
}

export interface SagittalSensorFrameBuildInput {
  world: World;
  control: ControlModule;
  now: number;
  dt: number;
  physicsStep: number;
  fc: Record<'l' | 'r', FootSensorReading>;
  leg: Record<'l' | 'r', ShankLegRef>;
  ik: Record<'l' | 'r', ShankIKSolution>;
  chain: Record<'l' | 'r', SagittalChainInput>;
  base: SagittalBaseReference;
  mode: SagittalMode;
  forceMode: SagittalForceMode;
}

const jointNames = [
  'hip_0', 'hip_1', 'hip_2',
  'knee_0', 'knee_1', 'knee_2',
  'foot_0', 'foot_1', 'foot_2',
] as const;

function dofIndex(w: World, side: 'l' | 'r', n: string): number {
  const [joint, axis] = n.split('_');
  return w.body.dofByName(`${joint}_${side}`, Number(axis));
}

function legSensor(w: World, side: 'l' | 'r', fc: FootSensorReading, leg: ShankLegRef, ik: ShankIKSolution, chain: SagittalChainInput): SagittalLegSensor {
  const q = new Array<number>(9).fill(0) as SagittalLegSensor['joints']['q'];
  const qd = new Array<number>(9).fill(0) as SagittalLegSensor['joints']['qd'];
  const tau = new Array<number>(9).fill(0) as SagittalLegSensor['joints']['tauApplied'];
  const min = new Array<number>(9).fill(0) as SagittalLegSensor['joints']['min'];
  const max = new Array<number>(9).fill(0) as SagittalLegSensor['joints']['max'];
  const tauMax = new Array<number>(9).fill(0) as SagittalLegSensor['joints']['tauMax'];
  const velMax = new Array<number>(9).fill(0) as SagittalLegSensor['joints']['velMax'];
  for (let k = 0; k < 9; k++) {
    const i = dofIndex(w, side, jointNames[k]!);
    if (i < 0) continue;
    const d = w.body.dofs[i]!;
    q[k] = d.angle;
    qd[k] = d.vel;
    tau[k] = w.executor.ledger[i]?.applied ?? 0;
    min[k] = d.min;
    max[k] = d.max;
    tauMax[k] = d.tauMax;
    velMax[k] = d.velMax;
  }
  const k = w.body.dofByName(`knee_${side}`, 2);
  const a = w.body.dofByName(`foot_${side}`, 2);
  const hip = w.body.dofByName(`hip_${side}`, 0);
  const kneeOut = k >= 0 && a >= 0
    ? (w.body.dofs[k]!.anchorWorld[2]! - w.body.dofs[a]!.anchorWorld[2]!) * (side === 'l' ? 1 : -1)
    : 0;
  const h0 = w.body.dofByName(`hip_${side}`, 0);
  const h1 = w.body.dofByName(`hip_${side}`, 1);
  let kneeOutJ0 = 0;
  let kneeOutJ1 = 0;
  if (h0 >= 0 && h1 >= 0 && k >= 0 && a >= 0) {
    const d0 = w.body.dofs[h0]!;
    const d1 = w.body.dofs[h1]!;
    const kd = w.body.dofs[k]!;
    const ad = w.body.dofs[a]!;
    const zx = (axis: Float64Array, p: Float64Array): number => axis[0]! * (p[1]! - d0.anchorWorld[1]!) - axis[1]! * (p[0]! - d0.anchorWorld[0]!);
    kneeOutJ0 = (zx(d0.axisWorld, kd.anchorWorld) - zx(d0.axisWorld, ad.anchorWorld)) * (side === 'l' ? 1 : -1);
    kneeOutJ1 = (zx(d1.axisWorld, kd.anchorWorld) - zx(d1.axisWorld, ad.anchorWorld)) * (side === 'l' ? 1 : -1);
  }
  return {
    valid: fc.valid,
    confidence: 1,
    timestamp: fc.time,
    side,
    joints: { q, qd, tauApplied: tau, min, max, tauMax, velMax },
    contact: {
      valid: fc.valid,
      confidence: fc.copValid ? 1 : 0,
      timestamp: fc.time,
      contact: fc.contact,
      fz: fc.fz,
      fzFiltered: fc.fzFiltered,
      copX: fc.copX,
      copZ: fc.copZ,
      copValid: fc.copValid,
      copInside: fc.copInside,
      frictionUse: 0,
      footX: fc.footX,
      footY: fc.footY,
      footZ: fc.footZ,
      footSpeed: fc.footSpeed,
    },
    chain: {
      valid: true,
      confidence: 1,
      timestamp: fc.time,
      fParallel: chain.fParallel,
      fParallelSigned: chain.fParallelSigned,
      fPerp: chain.fPerp,
      fPerpSag: chain.fPerpSag,
      fLat: chain.fLat,
      feasible: !!chain.feasible,
      copInside: !!chain.copInside,
      tauUtil: chain.tauUtil,
    },
    kneeOut,
    kneeOutJ0,
    kneeOutJ1,
    hipHeight: hip >= 0 ? w.body.dofs[hip]!.anchorWorld[1]! : 0,
    hipVelocity: hip >= 0 ? w.body.dofs[hip]!.vel : 0,
    ikHip0: ik.hip0,
    ikHip1: leg.qHip0,
    ikHip2: ik.hip2,
    ikKnee2: ik.knee2,
    ikFoot2: ik.foot2,
  };
}

export function buildSagittalSensorFrame(i: SagittalSensorFrameBuildInput): SagittalSensorFrame {
  const p = sensePelvis(i.world);
  const ctl = i.control;
  const com = ctl.sensors.com;
  const vel = ctl.sensors.comVel;
  const target = ctl.warner.getComTarget();
  const omega0 = Math.sqrt(9.81 / Math.max(0.3, com[1]!));
  const xcomZ = com[2]! + vel[2]! / omega0;
  const zL = i.fc.l.footZ;
  const zR = i.fc.r.footZ;
  const mid = (zL + zR) / 2;
  const half = Math.abs(zL - zR) / 2 + 0.04;
  const pelvis: SagittalPelvisState = {
    valid: true, confidence: 1, timestamp: i.now,
    position: { x: p.x, y: p.y, z: p.z },
    velocity: { x: p.vx, y: p.vy, z: p.vz },
    rotation: { x: 0, y: 0, z: Math.sin(p.roll / 2), w: Math.cos(p.roll / 2) },
    angularVelocity: { x: 0, y: 0, z: 0 },
    roll: p.roll, pitch: 0, yaw: 0,
    hL: i.world.body.dofs[i.world.body.dofByName('hip_l', 0)]?.anchorWorld[1] ?? i.leg.l.hip.y,
    hR: i.world.body.dofs[i.world.body.dofByName('hip_r', 0)]?.anchorWorld[1] ?? i.leg.r.hip.y,
    rollVelocity: 0, pitchVelocity: 0,
  };
  const comState: SagittalComState = {
    valid: true, confidence: 1, timestamp: i.now,
    position: { x: com[0]!, y: com[1]!, z: com[2]! },
    velocity: { x: vel[0]!, y: vel[1]!, z: vel[2]! },
    acceleration: { x: 0, y: 0, z: 0 },
    targetX: target.x, targetZ: target.z,
    xcomZ, supportMidZ: mid, effectiveHalf: half,
    margin: half - Math.abs(xcomZ - mid),
  };
  const boundary: SagittalBoundaryState = {
    valid: false, confidence: 0, timestamp: i.now,
    pHipForce: { x: 0, y: 0, z: 0 }, pHipMoment: { x: 0, y: 0, z: 0 },
    pKneeForce: { x: 0, y: 0, z: 0 }, pKneeMoment: { x: 0, y: 0, z: 0 },
  };
  return {
    valid: true, confidence: 1, timestamp: i.now,
    t: i.now, dt: i.dt, physicsStep: i.physicsStep,
    legs: {
      l: legSensor(i.world, 'l', i.fc.l, i.leg.l, i.ik.l, i.chain.l),
      r: legSensor(i.world, 'r', i.fc.r, i.leg.r, i.ik.r, i.chain.r),
    },
    pelvis,
    com: comState,
    boundary,
    base: i.base,
    mode: i.mode,
    forceMode: i.forceMode,
    solverReady: true,
  };
}
