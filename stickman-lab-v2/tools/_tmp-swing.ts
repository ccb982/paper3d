import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const g = (n: string, ax: number): number => {
  const i = w.body.dofByName(n, ax);
  return i >= 0 ? w.body.dofs[i]!.angle * 57.3 : NaN;
};
const pos = (key: string): [number, number] => {
  const ix = (w.body as any).indexByKey.get(key);
  const p = (w.body as any).bodies[ix].translation();
  return [p.x * 100, p.y * 100];
};
const angFromV = (a: [number, number], b: [number, number]): number => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  return Math.atan2(dx, -dy) * 57.3;   // 0=竖直向下，正=朝前(+x)
};
/** 大腿轴线（四元数旋转 local(0,-1,0)，不受折膝污染） */
const axisOf = (key: string): number => {
  const ix = (w.body as any).indexByKey.get(key);
  const q = (w.body as any).bodies[ix].rotation();
  const vx = 0, vy = -1, vz = 0;
  const cx = q.y * vz - q.z * vy, cy = q.z * vx - q.x * vz, cz = q.x * vy - q.y * vx;
  const ix2 = q.y * cz - q.z * cy + q.w * cx, iy2 = q.z * cx - q.x * cz + q.w * cy, iz2 = q.x * cy - q.y * cx + q.w * cz;
  const rx = vx + 2 * ix2, ry = vy + 2 * iy2, rz = vz + 2 * iz2;
  return Math.atan2(rx, -ry) * 57.3;
};
const pitchOf = (key: string): number => {
  const ix = (w.body as any).indexByKey.get(key);
  const q = (w.body as any).bodies[ix].rotation();
  const vx = 0, vy = 1, vz = 0;
  const cx = q.y * vz - q.z * vy, cy = q.z * vx - q.x * vz, cz = q.x * vy - q.y * vx;
  const ix2 = q.y * cz - q.z * cy + q.w * cx, iy2 = q.z * cx - q.x * cz + q.w * cy, iz2 = q.x * cy - q.y * cx + q.w * cz;
  const rx = vx + 2 * ix2, ry = vy + 2 * iy2;
  return Math.atan2(rx, ry) * 57.3;   // 正=躯干顶朝前(前弯)
};
console.log('t     相位   髋L_屈 膝L_折 足L_背屈 | 大腿方向 小腿方向 | 趾y | 躯干俯仰(正=前弯) 脊1/2/3(deg)');
for (let s = 0; s < Math.round(4.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 2.2 || t > 4.4) continue;
  if (Math.abs(t * 10 - Math.round(t * 10)) > 1e-6) continue;
  const ph = ctl.actions.status.phase ?? '?';
  const th = pos('thigh_l'), sh = pos('shin_l'), ft = pos('mfoot_l');
  const aTh = axisOf('thigh_l'), aSh = axisOf('shin_l');   // 轴线测量
  console.log(`${t.toFixed(1)}  ${ph.padEnd(6)} ${g('hip_l', 2).toFixed(0).padStart(6)} ${g('knee_l', 2).toFixed(0).padStart(6)} ${g('foot_l', 2).toFixed(0).padStart(8)} | ${aTh.toFixed(0).padStart(10)} ${aSh.toFixed(0).padStart(10)} | ${ft[1].toFixed(0).padStart(4)} | ${pitchOf('torso').toFixed(0).padStart(6)} ${g('spine1', 2).toFixed(0).padStart(5)} ${g('spine2', 2).toFixed(0).padStart(5)} ${g('spine3', 2).toFixed(0).padStart(5)}`);
}
