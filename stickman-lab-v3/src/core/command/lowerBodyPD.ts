import type { World } from '../world';
import { propose, PRI } from '../proposalBus';
import type { LowerBodyOutput } from './lowerBody';

const isLower = (name: string): boolean => /^(hip|knee|foot|ankle)_/.test(name);

export function applyLowerBodyPD(w: World, out: LowerBodyOutput, pri: number = PRI.servo): void {
  for (let i = 0; i < w.body.dofs.length; i++) {
    const d = w.body.dofs[i]!;
    if (!isLower(d.name) && !/^(spine|neck)_/.test(d.name) || d.engineMotor) continue;
    const lim = Math.max(Math.abs(d.min), Math.abs(d.max), 0.3);
    const kp = (0.5 * d.tauMax) / lim;
    const kd = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.V3_LOWER_PD_KD ?? 0.05) * d.tauMax;
    propose({ dof: i, kind: 'angle', pri, rad: out.qRef[i]!, kp, kd, src: 'lowerCommand.pd' });
    const ff = (out.tauGravity[i] ?? 0) + (out.ff[i] ?? 0);
    if (Math.abs(ff) > 1e-6) propose({ dof: i, kind: 'torque', pri, tau: ff, src: 'lowerCommand.ff' });
  }
}

export function applyLowerBodyPDDirect(w: World, out: LowerBodyOutput): void {
  for (let i = 0; i < w.body.dofs.length; i++) {
    const d = w.body.dofs[i]!;
    if (!isLower(d.name) && !/^(spine|neck)_/.test(d.name) || d.engineMotor) continue;
    const lim = Math.max(Math.abs(d.min), Math.abs(d.max), 0.3);
    const kp = (0.5 * d.tauMax) / lim;
    const kd = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.V3_LOWER_PD_KD ?? 0.05) * d.tauMax;
    const gs = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.V3_LOWER_GRAV ?? 1);
    let tau = kp * (out.qRef[i]! - d.angle) - kd * d.vel + (out.tauGravity[i] ?? 0) * (Number.isFinite(gs) ? gs : 1) + (out.ff[i] ?? 0);
    const cap = 0.8 * Math.max(1, d.tauMax);
    tau = Math.max(-cap, Math.min(cap, tau));
    w.executor.addTorque(i, tau);
  }
}
