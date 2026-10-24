/** 蹲姿被动刚度层：关节囊/韧带/肌腱的基线刚度。
 *
 *  与主动回正分开：
 *  - 目标是释放瞬间的关节角；
 *  - 只写 hip/0、hip/2、knee/2、foot/2；
 *  - cap 很小，不抢主动回正。
 *
 *  论文量级：踝内在刚度约 1.3–3.6 Nm/deg（≈75–206 Nm/rad）；
 *  这里用保守值，等效 0.3–1.5 Nm/deg。
 */
import type { World } from '../world';
import type { CourtState as CS } from '../court';
import { propose, PRI } from '../proposalBus';
import { baseState } from './baseTable';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function squatPassiveStiffness(w: World, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_PASSIVE_STIFF ?? '0') !== '1') return;
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;
  const kHip = Math.abs(Number(env.SQC_PS_HIP_K ?? 20));
  const kHip2 = Math.abs(Number(env.SQC_PS_HIP2_K ?? 10));
  const kKnee = Math.abs(Number(env.SQC_PS_KNEE_K ?? 15));
  const kFoot = Math.abs(Number(env.SQC_PS_FOOT_K ?? 60));
  const capHip = Math.abs(Number(env.SQC_PS_HIP_CAP ?? 2));
  const capHip2 = Math.abs(Number(env.SQC_PS_HIP2_CAP ?? 2));
  const capKnee = Math.abs(Number(env.SQC_PS_KNEE_CAP ?? 2));
  const capFoot = Math.abs(Number(env.SQC_PS_FOOT_CAP ?? 3));
  const slack = Math.abs(Number(env.SQC_PS_SLACK_DEG ?? 6)) / 57.3;
  for (const side of ['l', 'r'] as const) {
    for (const [jn, ax, k, cap] of [
      ['hip', 0, kHip, capHip],
      ['hip', 2, kHip2, capHip2],
      ['knee', 2, kKnee, capKnee],
      ['foot', 2, kFoot, capFoot],
    ] as Array<[string, number, number, number]>) {
      const di = w.body.dofByName(`${jn}_${side}`, ax);
      if (di < 0) continue;
      const d = w.body.dofs[di]!;
      const ref = st.ang0?.get(di) ?? d.angle;
      const dev = ref - d.angle;
      const ad = Math.abs(dev);
      if (ad <= slack) continue;
      const e = (ad - slack) * Math.sign(dev);
      const tau = clamp(k * e, -cap, cap);
      if (Math.abs(tau) > 1e-9) propose({ dof: di, kind: 'ext', pri: PRI.servo, tau, src: 'squat.passiveStiffness', channel: 'passive' });
    }
  }
}
