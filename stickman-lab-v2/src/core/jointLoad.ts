import type { World } from './world';
import type { CourtState as CS } from './court';
import { baseState } from './servo/baseTable';

/** 关节压缩前馈：在关节两侧施加等大反向力（沿骨段），模拟肌肉共激活。
 *  只增加关节约束力，不改变整体外力/CoM；不是力矩 cap。 */
export function squatJointLoad(w: World, st: CS): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_JOINT_LOAD ?? '0') !== '1') return;
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;
  const bw = w.sk.massTotal * 9.81;
  const targets: Array<[string, number]> = [
    ['hip_l', Number(env.SQC_JOINT_HIP_BW ?? 0.5) * bw],
    ['hip_r', Number(env.SQC_JOINT_HIP_BW ?? 0.5) * bw],
    ['knee_l', Number(env.SQC_JOINT_KNEE_BW ?? 0.5) * bw],
    ['knee_r', Number(env.SQC_JOINT_KNEE_BW ?? 0.5) * bw],
    ['foot_l', Number(env.SQC_JOINT_ANKLE_BW ?? 0.4) * bw],
    ['foot_r', Number(env.SQC_JOINT_ANKLE_BW ?? 0.4) * bw],
    ['spine1', Number(env.SQC_JOINT_SPINE_BW ?? 0) * bw],
    ['spine2', Number(env.SQC_JOINT_SPINE_BW ?? 0) * bw],
    ['spine3', Number(env.SQC_JOINT_SPINE_BW ?? 0) * bw],
  ];
  const rampT = Math.max(1e-3, Number(env.SQC_JOINT_LOAD_RAMP ?? 0.5));
  const ramp = Math.max(0, Math.min(1, (st.t - st.settle) / rampT));
  for (const [name, force0] of targets) {
    const force = force0 * ramp;
    const di = w.body.dofByName(name, 0);
    if (di < 0) continue;
    const d = w.body.dofs[di]!;
    const pb = w.body.bodies[d.b1];
    const cb = w.body.bodies[d.b2];
    if (!pb || !cb) continue;
    // 作用在关节锚点，方向沿“关节 → 子体质心”，力线过关节轴 ⇒ 不产生关节力矩。
    const p = d.anchorWorld;
    const cc = cb.translation();
    let dx = cc.x - p[0]!, dy = cc.y - p[1]!, dz = cc.z - p[2]!;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) continue;
    dx /= len; dy /= len; dz /= len;
    const imp = force * w.dt;
    pb.applyImpulseAtPoint({ x: dx * imp, y: dy * imp, z: dz * imp }, { x: p[0]!, y: p[1]!, z: p[2]! }, true);
    cb.applyImpulseAtPoint({ x: -dx * imp, y: -dy * imp, z: -dz * imp }, { x: p[0]!, y: p[1]!, z: p[2]! }, true);
    if (String(env.SQC_JOINT_LOAD_DBG ?? '0') === '1' && name === 'hip_l' && Math.floor(w.clock * 10) !== Math.floor((w.clock - w.dt) * 10)) {
      console.log(`JOINTLOAD t=${w.clock.toFixed(2)} ${name} F=${force.toFixed(0)}N (${(force / bw).toFixed(2)}BW)`);
    }
  }
}
