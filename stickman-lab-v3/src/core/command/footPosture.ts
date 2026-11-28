import type { World } from '../world';
import { propose, PRI } from '../proposalBus';
import { baseState } from '../servo/baseTable';
import type { FootAnkleTargets } from '../servo/footAnkleModule';
import { contactSafe } from './contactGate';

export function proposeFootPosture(w: World, a: FootAnkleTargets, src: string): void {
  const down = (globalThis as { __SQC_SQUAT_DOWN?: boolean }).__SQC_SQUAT_DOWN === true;
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const n = (k: string, d: number): number => { const v = Number(env[k]); return Number.isFinite(v) ? v : d; };
  for (const side of ['l', 'r'] as const) {
    for (const ax of [0, 1, 2] as const) {
      const i = w.body.dofByName(`foot_${side}`, ax);
      if (i < 0) continue;
      let kp = a.kp[i]!;
      let kd = a.kd[i]!;
      if (baseState() === 'squat' && !down && ax === 2) {
        const pasBase = Math.max(0, n('SQC_ANKLE_PAS_K', 150));
        const pasGain = n('SQC_ANKLE_PAS_GAIN', 0);
        const pasMax = Math.max(0, n('SQC_ANKLE_PAS_MAX', 200));
        const e = a.qRef[i]! - (w.body.dofs[i]?.angle ?? 0);
        kp += Math.max(0, Math.min(pasMax, pasBase + pasGain * e));
        kd += Math.max(0, n('SQC_ANKLE_PAS_B', 6));
      }
      const safe = contactSafe(side);
      propose({ dof: i, kind: 'angle', pri: PRI.direct, rad: safe ? a.qRef[i]! : (w.body.dofs[i]?.angle ?? a.qRef[i]!), kp, kd, src });
    }
  }
}
