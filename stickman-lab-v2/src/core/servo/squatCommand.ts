import { solveSquatHipDynamics, solveSquatShankDynamics } from './squatWbc';

export interface SquatCommandInput {
  com: [number, number, number];
  comTarget: [number, number, number];
  comVel: [number, number, number];
  jCom: [number, number][];
  mHip: number;
  mKnee: number;
  mAnkle: number;
  hHip: number;
  hKnee: number;
  hAnkle: number;
  cop: number;
  copTarget: number;
  copMin: number;
  copMax: number;
  fz: number;
  fzMin: number;
  fzMax: number;
  mass: number;
  kpY: number;
  kdY: number;
  tauHipMin: number;
  tauHipMax: number;
  tauKneeMin: number;
  tauKneeMax: number;
  tauAnkleMin: number;
  tauAnkleMax: number;
}

export interface SquatCommandOutput {
  hip: [number, number];
  shank: number;
  fzTarget: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function computeSquatCommand(i: SquatCommandInput): SquatCommandOutput {
  const fzTarget = clamp(
    i.mass * (9.81 + i.kpY * (i.comTarget[1] - i.com[1]) - i.kdY * i.comVel[1]),
    Math.max(0, i.fzMin),
    Math.max(i.fzMin, i.fzMax),
  );
  const hip = solveSquatHipDynamics({
    com: i.com,
    comTarget: i.comTarget,
    comVel: i.comVel,
    jCom: i.jCom,
    m: [i.mHip, i.mKnee],
    h: [i.hHip, i.hKnee],
    tauMin: [i.tauHipMin, i.tauKneeMin],
    tauMax: [i.tauHipMax, i.tauKneeMax],
  });
  const shank = solveSquatShankDynamics({
    cop: i.cop,
    copTarget: i.copTarget,
    copMin: i.copMin,
    copMax: i.copMax,
    fz: fzTarget,
    m: i.mAnkle,
    h: i.hAnkle,
    tauMin: i.tauAnkleMin,
    tauMax: i.tauAnkleMax,
  });
  return { hip, shank, fzTarget };
}
