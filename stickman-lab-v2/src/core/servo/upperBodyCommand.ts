/** 上身命令层空壳：隔离阶段只占位，不写执行器。 */
import type { World } from '../world';
import type { CourtState as CS } from '../court';
import { propose, PRI } from '../proposalBus';

const pitch0 = new WeakMap<CS, number>();

export function upperBodyCommand(w: World, st: CS): void {
  const ti = w.body.indexByKey.get('spine4') ?? w.body.indexByKey.get('torso');
  if (ti === undefined) return;
  const q = w.body.bodies[ti]!.rotation();
  const ux = 2 * (q.x * q.y - q.w * q.z);
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const pitch = Math.atan2(ux, uy);
  const wb = w.body.bodies[ti]!;
  const av = wb.angvel();
  const wv = av.x * 0 + av.y * 0 + av.z * 0;
  if (!pitch0.has(st)) pitch0.set(st, pitch);
  const target = (pitch0.get(st) ?? pitch) - 0.05;
  const e = target - pitch;
  const age = Math.max(0, st.t - st.settle);
  const baseOn = st.released ? 1 : 0;
  const rightRamp = Math.min(1, age / 0.2);
  const gBase = [100, 50, 10];
  const common = Math.max(-120, Math.min(120, 120 * e - 15 * wv));
  const ws = [0.2, 0.35, 0.45];
  ['spine1', 'spine2', 'spine3'].forEach((n, k) => {
    const i = w.body.dofByName(n, 2);
    if (i >= 0) propose({ dof: i, kind: 'ext', pri: PRI.direct, tau: gBase[k]! * baseOn + ws[k]! * common * rightRamp, src: 'squat.upperSupport', channel: 'support' });
  });
}
