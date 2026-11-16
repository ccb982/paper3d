/**
 * 双大腿联合逆动力学求解器（只读第一版）。
 *
 * 目标：把低侧顶/高侧落、kneeOut、Fz 预算、髋高差放进同一个 solve，
 * 不再在 solver 外单独加 kneeOutFf。
 * 本轮只输出 __BS，不写执行。
 */
import type { World } from '../world';
import type { FootSensorReading } from './footContact';
import { solveStaticLegTorques } from './legInverseDynamics';
import { captureShankLeg, solveShankIKTarget } from './shankIK';

export interface BilateralSolveInput {
  fcL: FootSensorReading;
  fcR: FootSensorReading;
  hL: number;
  hR: number;
  vL: number;
  vR: number;
  kneeOutL: number;
  kneeOutR: number;
  kneeOutTarget: number;
  fLatL: number;
  fLatR: number;
  fPerpSagL: number;
  fPerpSagR: number;
  pParallelL: number;
  pParallelR: number;
  pelvisRoll: number;
  kHeight: number;
  kHeightV: number;
  deltaCap: number;
  kKneeOut: number;
  kneeOutCap: number;
  kneeOutAngleCap: number;
  hipStableEps: number;
  hipMoveCap: number;
}

export interface BilateralSolveOutput {
  fzL: number;
  fzR: number;
  delta: number;
  eH: number;
  hipResidual: number;
  hipStable: boolean;
  kneeOutL: number;
  kneeOutR: number;
  kneeOutErrL: number;
  kneeOutErrR: number;
  kneeOutFfL: number;
  kneeOutFfR: number;
  hip0CorrL: number;
  hip1CorrL: number;
  hip0CorrR: number;
  hip1CorrR: number;
  kneeOutPredL: number;
  kneeOutPredR: number;
  kneeOutAngleCap: number;
  kneeOutOk: boolean;
  mode: 'FORCE' | 'HIP';
  pelvisTargetY: number;
  pelvisMidY: number;
  ikHip2L: number;
  ikKnee2L: number;
  ikHip2R: number;
  ikKnee2R: number;
  ikFeasible: boolean;
  hipL: number;
  kneeL: number;
  hipR: number;
  kneeR: number;
  hipCommon: number;
  kneeCommon: number;
  feasible: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function solveBilateral(w: World, i: BilateralSolveInput): BilateralSolveOutput {
  const W = w.sk.massTotal * 9.81;
  const eH = i.hL - i.hR;

  // 低侧顶、高侧落：确定性差分 + 可选速度阻尼。
  const dRaw = -i.kHeight * eH - i.kHeightV * (i.vL - i.vR);
  let delta = clamp(dRaw, -Math.abs(i.deltaCap), Math.abs(i.deltaCap));
  let fzL = Math.max(0, W * 0.5 + delta);
  let fzR = Math.max(0, W * 0.5 - delta);
  // 约束：FzL + FzR = W；gross 不可能时退化为均分/全支撑。
  if (!i.fcL.contact && i.fcR.contact) { fzL = 0; fzR = W; }
  else if (i.fcL.contact && !i.fcR.contact) { fzL = W; fzR = 0; }
  else if (!i.fcL.contact && !i.fcR.contact) { fzL = W * 0.5; fzR = W * 0.5; }
  delta = fzL - fzR;

  // kneeOut 走进同一个 solve：先求需要的向外修正，再在 solve 内限幅。
  // 方向：kneeOut 低于目标 -> 需要向外；输出 hip0 额矩候选，不在此处执行。
  const outErrL = i.kneeOutTarget - i.kneeOutL;
  const outErrR = i.kneeOutTarget - i.kneeOutR;
  const outFfL = clamp(i.kKneeOut * outErrL, -Math.abs(i.kneeOutCap), Math.abs(i.kneeOutCap));
  const outFfR = clamp(i.kKneeOut * outErrR, -Math.abs(i.kneeOutCap), Math.abs(i.kneeOutCap));

  // kneeOut 联合解：用实际几何的 hip0/hip1 雅可比，不再直接给固定 hip0 前馈。
  const legJac = (side: 'l' | 'r', target: number, current: number): { u0: number; u1: number; pred: number } => {
    const h0 = w.body.dofs[w.body.dofByName(`hip_${side}`, 0)];
    const h1 = w.body.dofs[w.body.dofByName(`hip_${side}`, 1)];
    const k = w.body.dofs[w.body.dofByName(`knee_${side}`, 2)];
    const a = w.body.dofs[w.body.dofByName(`foot_${side}`, 2)];
    if (!h0 || !h1 || !k || !a) return { u0: 0, u1: 0, pred: current };
    const zx = (axis: Float64Array, p: Float64Array): number => axis[0]! * (p[1]! - h0.anchorWorld[1]!) - axis[1]! * (p[0]! - h0.anchorWorld[0]!);
    // d(kneeOut)/d(hip0) ≈ 侧向相对位移对关节转动的变化；hip1 为次级权重。
    const j0 = (zx(h0.axisWorld, k.anchorWorld) - zx(h0.axisWorld, a.anchorWorld)) * (side === 'l' ? 1 : -1);
    const j1 = (zx(h1.axisWorld, k.anchorWorld) - zx(h1.axisWorld, a.anchorWorld)) * (side === 'l' ? 1 : -1);
    const err = target - current;
    const w1 = 0.2;
    const den = j0 * j0 + w1 * j1 * j1;
    const capA = Math.abs(i.kneeOutAngleCap);
    const u0 = clamp(den > 1e-9 ? j0 * err / den : 0, -capA, capA);
    const u1 = clamp(den > 1e-9 ? w1 * j1 * err / den : 0, -capA, capA);
    return { u0, u1, pred: current + j0 * u0 + j1 * u1 };
  };
  const jl = legJac('l', i.kneeOutTarget, i.kneeOutL);
  const jr = legJac('r', i.kneeOutTarget, i.kneeOutR);

  // 低侧顶/高侧落与 kneeOut 同解约束：
  // 不允许 kneeOut 修正逆转 Fz 差分方向；超过 cap 直接判不可行。
  const lowIsR = eH > 0;    // hL 高 → 右低 → 右顶
  const fzSideOk = lowIsR ? fzR >= fzL : fzL >= fzR;
  const kneeOutOk = jl.pred >= -0.005 && jr.pred >= -0.005;

  const l = solveStaticLegTorques(w, 'l', i.fcL, fzL);
  const r = solveStaticLegTorques(w, 'r', i.fcR, fzR);
  const hipResidual = eH;
  const hipStable = Math.abs(hipResidual) <= Math.abs(i.hipStableEps);

  // 先 FORCE：固定 pelvis/IK，只改力。
  // 只有 kneeOut 不可达或 hL−hR 超差时，才进入 HIP：骨盆目标移到 mid，重解双腿 IK。
  const needHip = !kneeOutOk || Math.abs(eH) > Math.abs(i.hipStableEps);
  const mode: 'FORCE' | 'HIP' = needHip ? 'HIP' : 'FORCE';
  const midY = 0.5 * (i.hL + i.hR);
  const moveCap = Math.abs(i.hipMoveCap);
  // FORCE: 髋保持当前；HIP: 每个 hip 朝 mid 移动，单帧不超过 hipMoveCap，再重解 IK。
  const dyL = mode === 'FORCE' ? 0 : clamp(midY - i.hL, -moveCap, moveCap);
  const dyR = mode === 'FORCE' ? 0 : clamp(midY - i.hR, -moveCap, moveCap);
  const legL = captureShankLeg(w, 'l');
  const legR = captureShankLeg(w, 'r');
  const H = (ref: typeof legL, dy: number) => ({ x: ref.hip.x, y: ref.hip.y + dy, z: ref.hip.z });
  const ikL = solveShankIKTarget(w, legL, H(legL, dyL));
  const ikR = solveShankIKTarget(w, legR, H(legR, dyR));

  return {
    fzL, fzR, delta, eH, hipResidual, hipStable,
    kneeOutL: i.kneeOutL, kneeOutR: i.kneeOutR,
    kneeOutErrL: outErrL, kneeOutErrR: outErrR,
    kneeOutFfL: outFfL, kneeOutFfR: outFfR,
    hip0CorrL: jl.u0, hip1CorrL: jl.u1, hip0CorrR: jr.u0, hip1CorrR: jr.u1,
    kneeOutPredL: jl.pred, kneeOutPredR: jr.pred, kneeOutAngleCap: Math.abs(i.kneeOutAngleCap),
    mode, pelvisTargetY: midY, pelvisMidY: midY,
    ikHip2L: ikL.hip2, ikKnee2L: ikL.knee2, ikHip2R: ikR.hip2, ikKnee2R: ikR.knee2,
    ikFeasible: Math.abs(ikL.hip2 - legL.qHip2) < 0.35 && Math.abs(ikR.hip2 - legR.qHip2) < 0.35,
    kneeOutOk,
    hipL: l.hip, kneeL: l.knee, hipR: r.hip, kneeR: r.knee,
    hipCommon: 0.5 * (l.hip + r.hip),
    kneeCommon: 0.5 * (l.knee + r.knee),
    feasible: l.feasible && r.feasible && hipStable && fzSideOk && (mode === 'FORCE' ? kneeOutOk : Math.abs(ikL.hip2 - legL.qHip2) < 0.35 && Math.abs(ikR.hip2 - legR.qHip2) < 0.35),
  };
}
