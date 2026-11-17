import type { World } from '../world';
import type { LowerBodyOutput } from './lowerBody';

const isLower = (name: string): boolean => /^(hip|knee|foot|ankle)_/.test(name);

export function applyLowerBodyPDDirect(w: World, out: LowerBodyOutput): void {
  for (let i = 0; i < w.body.dofs.length; i++) {
    const d = w.body.dofs[i]!;
    if (!isLower(d.name) && !/^(spine|neck|shoulder)_/.test(d.name) || d.engineMotor) continue;
    const lim = Math.max(Math.abs(d.min), Math.abs(d.max), 0.3);
    const kp = out.kp?.[i] || (0.5 * d.tauMax) / lim;
    const kd = out.kd?.[i] || Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.V3_LOWER_PD_KD ?? 0.05) * d.tauMax;
    const gs = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.V3_LOWER_GRAV ?? 1);
    let tau = kp * (out.qRef[i]! - d.angle) - kd * d.vel + (out.tauGravity[i] ?? 0) * (Number.isFinite(gs) ? gs : 1) + (out.ff[i] ?? 0);
    const cap = 0.8 * Math.max(1, d.tauMax);
    tau = Math.max(-cap, Math.min(cap, tau));
    w.executor.addTorque(i, tau);
  }
}
