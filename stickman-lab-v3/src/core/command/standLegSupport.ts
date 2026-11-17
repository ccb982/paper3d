import type { LowerBodyContext } from './lowerBody';
import { baseAng, baseTq } from '../servo/baseTable';

const AX: Array<['hip' | 'knee' | 'foot', number]> = [
  ['hip', 0], ['hip', 1], ['hip', 2],
  ['knee', 0], ['knee', 1], ['knee', 2],
  ['foot', 0], ['foot', 1], ['foot', 2],
];

export function standLegTorque(ctx: LowerBodyContext, out: Float64Array): void {
  out.fill(0);
  const body = ctx.world.body;
  const comX = ctx.sensors.com[0] ?? 0;
  const comZ = ctx.sensors.com[2] ?? 0;
  const comY = Math.max(0.3, ctx.sensors.com[1] ?? 0.8);
  const w0 = Math.sqrt(9.81 / comY);
  const xcomX = comX + (ctx.sensors.comVel[0] ?? 0) / w0;
  const li = body.indexByKey.get('foot_l') ?? -1;
  const ri = body.indexByKey.get('foot_r') ?? -1;
  const lp = li >= 0 ? body.bodies[li]!.translation() : { x: 0, z: 0 };
  const rp = ri >= 0 ? body.bodies[ri]!.translation() : { x: 0, z: 0 };
  const midX = (lp.x + rp.x) / 2;
  const midZ = (lp.z + rp.z) / 2;
  const footL = ctx.world.perception.feet[0];
  for (const side of ['l', 'r'] as const) {
    const copX = ctx.world.perception.feet[side === 'l' ? 0 : 1]?.copX ?? comX;
    for (const [jn, ax] of AX) {
      const i = body.dofByName(`${jn}_${side}`, ax);
      if (i < 0) continue;
      const d = body.dofs[i]!;
      if (d.engineMotor) continue;
      const ref = baseAng(jn, ax) ?? d.angle;
      const bias = baseTq(jn, ax, true);
      const w = jn === 'hip' ? 0.45 : jn === 'knee' ? 0.15 : 0.10;
      const kp = ax === 0 ? 500 : ax === 2 ? 400 : 0;
      const sgn = ax === 0 && side === 'l' ? -1 : 1;
      let dir = 0;
      if (ax === 0) dir = w * 2500 * (midZ - comZ);
      else if (ax === 2) dir = w * 2500 * (midX - comX);
      if (jn === 'foot' && ax === 2) dir += 250 * (xcomX - copX);
      let tau = sgn * (bias + dir) + kp * (ref - d.angle);
      const lim = Math.max(1, d.tauMax);
      tau = Math.max(-lim, Math.min(lim, tau));
      out[i] = tau;
      if (jn === 'foot') void side;
    }
  }
  void footL;
}
