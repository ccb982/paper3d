import type { World } from '../world';
import type { LowerBodyOutput } from './lowerBody';
import { baseState } from '../servo/baseTable';

const isLower = (name: string): boolean => /^(hip|knee|foot|ankle)_/.test(name);

export function computeLowerBodyPDTorques(w: World, out: LowerBodyOutput): Float64Array {
  const result = new Float64Array(w.body.dofs.length);
  for (let i = 0; i < w.body.dofs.length; i++) {
    const d = w.body.dofs[i]!;
    if (!isLower(d.name) && !/^(spine|neck|shoulder)_/.test(d.name) || d.engineMotor) continue;
    const worldFoot = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_ANKLE_WORLD ?? '1') === '1'
      && baseState() === 'stand' && (globalThis as { __SQC_SQUAT_DOWN?: boolean }).__SQC_SQUAT_DOWN !== true && /^foot_/.test(d.name);
    if (worldFoot) continue;
    if (out.noPd?.has(i)) continue;
    const lim = Math.max(Math.abs(d.min), Math.abs(d.max), 0.3);
    const kpDef = out.kp?.[i];
    const kdDef = out.kd?.[i];
    const kp = kpDef !== undefined && Number.isFinite(kpDef) ? kpDef : (0.5 * d.tauMax) / lim;
    const kd = kdDef !== undefined && Number.isFinite(kdDef) ? kdDef : Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.V3_LOWER_PD_KD ?? 0.05) * d.tauMax;
    const gs = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.V3_LOWER_GRAV ?? 1);
    let tau = kp * (out.qRef[i]! - d.angle) - kd * d.vel + (out.tauGravity[i] ?? 0) * (Number.isFinite(gs) ? gs : 1) + (out.ff[i] ?? 0);
    const cap = 0.8 * Math.max(1, d.tauMax);
    tau = Math.max(-cap, Math.min(cap, tau));
    result[i] = tau;
  }
  return result;
}

export function applyLowerBodyPDDirect(w: World, out: LowerBodyOutput): void {
  const tau = computeLowerBodyPDTorques(w, out);
  for (let i = 0; i < tau.length; i++) {
    if (tau[i] !== 0) w.executor.addTorque(i, tau[i]!);
  }
}
