import type {
  CommandFrame,
  SagittalIdSolverInput,
  SagittalIdSolverOutput,
  SagittalLegSensor,
  SagittalQpResult,
} from './sagittalIdTypes';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function fallbackCommand(i: SagittalIdSolverInput, reason: string): SagittalIdSolverOutput {
  const b = i.sensor.base;
  return {
    command: {
      solveId: (i.previous?.solveId ?? 0) + 1,
      solvedAt: i.now,
      validUntil: i.now + Math.max(i.solveDt * 1.5, 0.05),
      holdUntil: i.now + Math.max(i.solveDt * 2, 0.1),
      feasible: false,
      mode: i.sensor.mode,
      forceMode: 'FORCE',
      deltaFzL: 0,
      deltaFzR: 0,
      deltaHip0L: 0,
      deltaHip0R: 0,
      deltaHip1L: 0,
      deltaHip1R: 0,
      deltaHip2L: 0,
      deltaHip2R: 0,
      deltaKnee2L: 0,
      deltaKnee2R: 0,
      deltaHip2FfL: 0,
      deltaHip2FfR: 0,
      deltaKnee2FfL: 0,
      deltaKnee2FfR: 0,
      kneeOutL: i.sensor.legs.l.kneeOut,
      kneeOutR: i.sensor.legs.r.kneeOut,
      hipResidual: i.sensor.pelvis.hL - i.sensor.pelvis.hR,
      torqueResidual: 0,
      contactResidual: 0,
      kneeOutResidual: 0,
    },
    qp: { feasible: false, residual: Number.POSITIVE_INFINITY, iterations: 0, activeConstraints: [reason] },
  };
}

function predictKneeOut(leg: SagittalLegSensor, u0: number, u1: number): number {
  return leg.kneeOut + leg.kneeOutJ0 * u0 + leg.kneeOutJ1 * u1;
}

function projectKneeOut(leg: SagittalLegSensor, target: number, cap: number, u0: number, u1: number): { u0: number; u1: number } {
  const pred = predictKneeOut(leg, u0, u1);
  const err = target - pred;
  if (err <= 0) return { u0, u1 };
  const w1 = 0.2;
  const den = leg.kneeOutJ0 * leg.kneeOutJ0 + w1 * leg.kneeOutJ1 * leg.kneeOutJ1;
  if (den <= 1e-9) return { u0, u1 };
  return {
    u0: clamp(u0 + leg.kneeOutJ0 * err / den, -cap, cap),
    u1: clamp(u1 + w1 * leg.kneeOutJ1 * err / den, -cap, cap),
  };
}

function applyLowHigh(fzL: number, fzR: number, eH: number, margin: number, W: number): { fzL: number; fzR: number } {
  if (eH > 0 && fzR - fzL < margin) {
    const r = W * 0.5 + margin * 0.5;
    return { fzL: W - r, fzR: r };
  }
  if (eH < 0 && fzL - fzR < margin) {
    const l = W * 0.5 + margin * 0.5;
    return { fzL: l, fzR: W - l };
  }
  return { fzL, fzR };
}

export function solveSagittalId(i: SagittalIdSolverInput): SagittalIdSolverOutput {
  if (!i.sensor.valid || !i.sensor.base.valid) return fallbackCommand(i, 'SENSOR_INVALID');
  const b = i.sensor.base;
  const W = b.fzL + b.fzR;
  if (!(W > 1e-6) || !b.valid) return fallbackCommand(i, 'BASE_INVALID');
  const l = i.sensor.legs.l;
  const r = i.sensor.legs.r;
  const cap = Math.max(0, i.targets.kneeOutAngleCap);
  const eH = i.sensor.pelvis.hL - i.sensor.pelvis.hR;
  const db = Math.abs(i.targets.fzDeadband);
  let dTarget = 0;
  if (Math.abs(eH) > db) {
    dTarget = clamp(-i.targets.fzDiffGain * eH, -Math.abs(i.targets.fzDiffCap), Math.abs(i.targets.fzDiffCap));
  }
  const wF = 1 / Math.max(1, i.targets.fzDiffCap * i.targets.fzDiffCap);
  const wU = 1;
  const wC = Math.max(0, i.targets.hipCommonWeight);
  const wR = Math.max(0, i.targets.pelvisRollWeight);
  let d = dTarget;
  let u0L = 0;
  let u1L = 0;
  let u0R = 0;
  let u1R = 0;
  let iterations = 0;
  for (; iterations < 24; iterations++) {
    const common0 = u0L + u0R;
    const common1 = u1L + u1R;
    const roll0 = u0L - u0R;
    const gD = 2 * wF * (d - dTarget);
    const g0L = 2 * wU * u0L + 2 * wC * common0 + 2 * wR * roll0;
    const g1L = 2 * wU * u1L + 2 * wC * common1;
    const g0R = 2 * wU * u0R + 2 * wC * common0 - 2 * wR * roll0;
    const g1R = 2 * wU * u1R + 2 * wC * common1;
    d = clamp(d - 0.25 * gD, -Math.abs(i.targets.fzDiffCap), Math.abs(i.targets.fzDiffCap));
    u0L = clamp(u0L - 0.08 * g0L, -cap, cap);
    u1L = clamp(u1L - 0.08 * g1L, -cap, cap);
    u0R = clamp(u0R - 0.08 * g0R, -cap, cap);
    u1R = clamp(u1R - 0.08 * g1R, -cap, cap);
    const pl = projectKneeOut(l, i.targets.kneeOutMinL, cap, u0L, u1L);
    u0L = pl.u0;
    u1L = pl.u1;
    const pr = projectKneeOut(r, i.targets.kneeOutMinR, cap, u0R, u1R);
    u0R = pr.u0;
    u1R = pr.u1;
    if (Math.abs(d - dTarget) < 1e-5 && Math.abs(u0L) + Math.abs(u0R) + Math.abs(u1L) + Math.abs(u1R) < 1e-5) break;
  }
  let fzL = W * 0.5 + d;
  let fzR = W * 0.5 - d;
  if (l.contact.contact && !r.contact.contact) {
    fzL = W;
    fzR = 0;
  } else if (!l.contact.contact && r.contact.contact) {
    fzL = 0;
    fzR = W;
  } else if (Math.abs(eH) > db) {
    const fz = applyLowHigh(fzL, fzR, eH, Math.abs(i.targets.fzLowMargin), W);
    fzL = fz.fzL;
    fzR = fz.fzR;
  }
  fzL = clamp(fzL, 0, W);
  fzR = clamp(fzR, 0, W);
  const predL = predictKneeOut(l, u0L, u1L);
  const predR = predictKneeOut(r, u0R, u1R);
  const kneeOutOkL = predL >= i.targets.kneeOutMinL - 1e-6;
  const kneeOutOkR = predR >= i.targets.kneeOutMinR - 1e-6;
  const contactOk = l.contact.contact || r.contact.contact;
  const fzOk = Math.abs(fzL + fzR - W) < 1e-6;
  const feasible = contactOk && fzOk && kneeOutOkL && kneeOutOkR;
  const active: string[] = [];
  if (!contactOk) active.push('CONTACT');
  if (!fzOk) active.push('FZ');
  if (!kneeOutOkL) active.push('KNEE_OUT_L');
  if (!kneeOutOkR) active.push('KNEE_OUT_R');
  const qL = i.sensor.mode === 'RECOVER' ? i.targets.qIkL : i.targets.qStableL;
  const qR = i.sensor.mode === 'RECOVER' ? i.targets.qIkR : i.targets.qStableR;
  const command: CommandFrame = {
    solveId: (i.previous?.solveId ?? 0) + 1,
    solvedAt: i.now,
    validUntil: i.now + Math.max(i.solveDt * 1.5, 0.05),
    holdUntil: i.now + Math.max(i.solveDt * 2, 0.1),
    feasible,
    mode: i.sensor.mode,
    forceMode: feasible ? i.sensor.forceMode : 'HIP',
    deltaFzL: fzL - b.fzL,
    deltaFzR: fzR - b.fzR,
    deltaHip0L: qL[0] + u0L - b.hip0TargetL,
    deltaHip0R: qR[0] + u0R - b.hip0TargetR,
    deltaHip1L: qL[1] + u1L - b.hip1TargetL,
    deltaHip1R: qR[1] + u1R - b.hip1TargetR,
    deltaHip2L: qL[2] - b.hip2TargetL,
    deltaHip2R: qR[2] - b.hip2TargetR,
    deltaKnee2L: qL[3] - b.knee2TargetL,
    deltaKnee2R: qR[3] - b.knee2TargetR,
    deltaHip2FfL: 0,
    deltaHip2FfR: 0,
    deltaKnee2FfL: 0,
    deltaKnee2FfR: 0,
    kneeOutL: predL,
    kneeOutR: predR,
    hipResidual: eH,
    torqueResidual: 0,
    contactResidual: contactOk ? 0 : 1,
    kneeOutResidual: Math.max(0, i.targets.kneeOutMinL - predL, i.targets.kneeOutMinR - predR),
  };
  const qp: SagittalQpResult = {
    feasible,
    residual: Math.abs(eH) + command.kneeOutResidual + command.contactResidual,
    iterations,
    activeConstraints: active,
  };
  return { command, qp };
}
