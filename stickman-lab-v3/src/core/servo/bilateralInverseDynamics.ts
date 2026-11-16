/**
 * 双大腿三节棍静态逆动力学（只读第一版）。
 *
 * 左右腿同时求解：
 *   - 低侧顶、高侧落由 hL−hR 确定
 *   - FzL + FzR = W
 *   - 每条腿用实际 thigh/shin/foot 几何/质量算 hip/knee/ankle 静态力矩
 * 不写执行器。
 */
import type { World } from '../world';
import type { FootSensorReading } from './footContact';
import { solveStaticLegTorques, type LegIdBoundary } from './legInverseDynamics';
import type { JointLoad } from './fullInverseDynamics';

export interface BilateralIdInput {
  fcL: FootSensorReading;
  fcR: FootSensorReading;
  boundaryL?: LegIdBoundary;
  boundaryR?: LegIdBoundary;
  kHeight: number;
  kHeightV: number;
  deltaCap: number;
  jointLoads?: JointLoad[];
  fLatL?: number;
  fLatR?: number;
  fPerpSagL?: number;
  fPerpSagR?: number;
  pParallelL?: number;
  pParallelR?: number;
  pelvisRoll?: number;
  kneeOutL?: number;
  kneeOutR?: number;
  kneeOutTarget?: number;
  kneeOutK?: number;
  kneeOutCap?: number;
}

export interface BilateralIdOutput {
  fzL: number;
  fzR: number;
  delta: number;
  hL: number;
  hR: number;
  eH: number;
  hipResidual: number;
  hipStable: boolean;
  fLatL: number;
  fLatR: number;
  fPerpSagL: number;
  fPerpSagR: number;
  pParallelL: number;
  pParallelR: number;
  pelvisRoll: number;
  dynHipL: number;
  dynKneeL: number;
  dynHipR: number;
  dynKneeR: number;
  kneeOutL: number;
  kneeOutR: number;
  kneeOutErrL: number;
  kneeOutErrR: number;
  kneeOutOk: boolean;
  kneeOutFfL: number;
  kneeOutFfR: number;
  hip: number;
  knee: number;
  hipL: number;
  kneeL: number;
  hipR: number;
  kneeR: number;
  feasible: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function hipAnchor(w: World, side: 'l' | 'r'): { y: number; vy: number } {
  const i0 = w.body.dofByName(`hip_${side}`, 0);
  const i2 = w.body.dofByName(`hip_${side}`, 2);
  const d = i0 >= 0 ? w.body.dofs[i0]! : i2 >= 0 ? w.body.dofs[i2]! : null;
  return { y: d?.anchorWorld[1] ?? 0, vy: d?.vel ?? 0 };
}

export function solveBilateralStatic(w: World, i: BilateralIdInput): BilateralIdOutput {
  const aL = hipAnchor(w, 'l');
  const aR = hipAnchor(w, 'r');
  const hL = aL.y;
  const hR = aR.y;
  const eH = hL - hR;
  const W = w.sk.massTotal * 9.81;

  // 低侧顶、高侧落：eH<0 左低，左边加 Fz；eH>0 右低。
  const deltaRaw = -i.kHeight * eH - i.kHeightV * (aL.vy - aR.vy);
  let delta = clamp(deltaRaw, -Math.abs(i.deltaCap), Math.abs(i.deltaCap));
  let fzL = Math.max(0, W * 0.5 + delta);
  let fzR = Math.max(0, W * 0.5 - delta);
  if (!i.fcL.contact && i.fcR.contact) { fzL = 0; fzR = W; }
  else if (i.fcL.contact && !i.fcR.contact) { fzL = W; fzR = 0; }
  else if (!i.fcL.contact && !i.fcR.contact) { fzL = W * 0.5; fzR = W * 0.5; }
  delta = fzL - fzR;

  const l = solveStaticLegTorques(w, 'l', i.fcL, fzL, i.boundaryL);
  const r = solveStaticLegTorques(w, 'r', i.fcR, fzR, i.boundaryR);
  // 动态修正：保留实际关节载荷的动态项，只替换“目标静态项 - 实际静态项”。
  // 这样不假装 qdd=0，也不重复加内部关节力。
  const actualL = solveStaticLegTorques(w, 'l', i.fcL, i.fcL.fz, i.boundaryL);
  const actualR = solveStaticLegTorques(w, 'r', i.fcR, i.fcR.fz, i.boundaryR);
  const load = (side: 'l' | 'r', joint: 'hip' | 'knee') => i.jointLoads?.find((j) => j.name === `${joint}_${side}`)?.torque ?? 0;
  const dynHipL = load('l', 'hip') + l.hip - actualL.hip;
  const dynKneeL = load('l', 'knee') + l.knee - actualL.knee;
  const dynHipR = load('r', 'hip') + r.hip - actualR.hip;
  const dynKneeR = load('r', 'knee') + r.knee - actualR.knee;
  // 髋稳定误差：低/高髋高度差；ΣFz-W 由构造恒为 0，不能当 hip residual。
  const hipResidual = eH;
  const hipStable = Math.abs(hipResidual) <= Math.abs(Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_BID_HIP_STABLE ?? 0.01));
  // 膝盖向外：kneeOut 为局部外偏；低于目标就产出 hip0 外展前馈，禁止内收。
  const outTarget = i.kneeOutTarget ?? 0.005;
  const outL = i.kneeOutL ?? 0;
  const outR = i.kneeOutR ?? 0;
  const outErrL = outTarget - outL;
  const outErrR = outTarget - outR;
  const kOut = Math.abs(i.kneeOutK ?? 1200);
  const capOut = Math.abs(i.kneeOutCap ?? 60);
  const kneeOutFfL = clamp(kOut * outErrL, -capOut, capOut);
  const kneeOutFfR = clamp(kOut * outErrR, -capOut, capOut);
  const kneeOutOk = outL >= -0.005 && outR >= -0.005;
  return {
    fzL, fzR, delta, hL, hR, eH, hipResidual, hipStable,
    fLatL: i.fLatL ?? 0, fLatR: i.fLatR ?? 0,
    fPerpSagL: i.fPerpSagL ?? 0, fPerpSagR: i.fPerpSagR ?? 0,
    pParallelL: i.pParallelL ?? 0, pParallelR: i.pParallelR ?? 0,
    pelvisRoll: i.pelvisRoll ?? 0,
    dynHipL, dynKneeL, dynHipR, dynKneeR,
    kneeOutL: outL, kneeOutR: outR, kneeOutErrL: outErrL, kneeOutErrR: outErrR,
    kneeOutOk, kneeOutFfL, kneeOutFfR,
    hip: 0.5 * (dynHipL + dynHipR),
    knee: 0.5 * (dynKneeL + dynKneeR),
    hipL: dynHipL, kneeL: dynKneeL,
    hipR: dynHipR, kneeR: dynKneeR,
    feasible: l.feasible && r.feasible && hipStable && kneeOutOk,
  };
}
