/**
 * PostSquatPD —— 交接后的执行层。
 * 只消费 PostSquatCommand 输出；不生成 IK、不改脚目标。
 */
import type { World } from '../world';
import type { PostSquatTargets } from '../command/postSquatCommand';
import type { Sensors } from '../sensors';

export function applyPostSquatPD(w: World, t: PostSquatTargets, s: Sensors): void {
  for (let i = 0; i < w.body.dofs.length; i++) {
    const d = w.body.dofs[i]!;
    const kp = t.kp[i] ?? 0;
    const kd = t.kd[i] ?? 0;
    if (kp === 0 && kd === 0) {
      w.executor.addTorque(i, 0);
      continue;
    }
    let tau = kp * (t.qRef[i]! - d.angle) - kd * d.vel + (t.ff[i] ?? 0) + (t.tauGravity[i] ?? 0);
    const cap = 0.8 * Math.max(1, d.tauMax);
    tau = Math.max(-cap, Math.min(cap, tau));
    w.executor.addTorque(i, tau);
  }
  // 骨盆水平支撑：只托住质心，不写脚。
  const ex = t.comTarget.x - s.com[0]!;
  const ez = t.comTarget.z - s.com[2]!;
  const fx = Math.max(-80, Math.min(80, 2500 * ex - 180 * s.comVel[0]!));
  const fz = Math.max(-80, Math.min(80, 2500 * ez - 180 * s.comVel[2]!));
  const ey = t.comTarget.y - s.com[1]!;
  const fy = Math.max(-250, Math.min(250, 5000 * ey - 300 * s.comVel[1]!));
  w.body.torso().applyImpulse({ x: fx * w.dt, y: fy * w.dt, z: fz * w.dt }, true);
}
