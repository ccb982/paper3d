/** 上身执行 PD：只消费 upperBodyCommand 的目标/前馈，不生成新策略。 */
import type { World } from '../world';
import { propose, PRI } from '../proposalBus';
import type { UpperCommand } from './upperBodyCommand';

const UPPER = ['spine1', 'spine2', 'spine3', 'neck'] as const;
const num = (k: string, d: number): number => {
  const v = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[k]);
  return Number.isFinite(v) ? v : d;
};
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export class UpperTaskPD {
  private readonly velLp = new WeakMap<World, Map<number, number>>();

  step(w: World, cmd: UpperCommand): void {
    const kp = num('SQC_UPPER_KP', 160);
    const kd = num('SQC_UPPER_KD', 24);
    const cap = Math.abs(num('SQC_UPPER_CAP', 120));
    const lp = clamp(num('SQC_UPPER_VEL_LP', 0.35), 0, 1);
    let vm = this.velLp.get(w);
    if (!vm) { vm = new Map(); this.velLp.set(w, vm); }
    for (const n of UPPER) {
      for (const ax of [0, 1, 2] as const) {
        const i = w.body.dofByName(n, ax);
        if (i < 0) continue;
        const d = w.body.dofs[i]!;
        const base = clamp(cmd.base.get(i) ?? 0, -d.tauMax, d.tauMax);
        if (base !== 0) {
          propose({ dof: i, kind: 'ext', pri: PRI.servo, channel: 'support', tau: base, src: 'squat.upperBase' });
        }
        const v0 = vm.get(i) ?? d.vel;
        const v = v0 + (d.vel - v0) * lp;
        vm.set(i, v);
        const target = cmd.targets.get(i) ?? d.angle;
        const e = target - d.angle;
        let right = clamp(kp * e - kd * v, -cap, cap) * cmd.ramp;
        if (n === 'spine1' && ax === 2) {
          const maxDef = Math.abs(num('SQC_UPPER_H_MAXDEF', 0.12));
          let hCorr = cmd.hCorr;
          if (hCorr * (d.angle - target) > 0 && Math.abs(d.angle - target) >= maxDef) hCorr = 0;
          right = clamp(right + hCorr, -d.tauMax, d.tauMax);
        }
        if (right !== 0) {
          propose({ dof: i, kind: 'ext', pri: PRI.servo, channel: 'active', tau: right, src: 'squat.upperRighting' });
        }
      }
    }
  }
}
