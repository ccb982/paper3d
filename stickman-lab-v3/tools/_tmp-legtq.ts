import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const drive = (ctl as any).drive ?? (w as any).drive;
const tau = (n: string, ax: number): number => {
  const di = body.dofByName(n, ax);
  if (di < 0) return 0;
  const b = drive?.lastBreakdown?.[di] ?? {};
  return (b.act ?? 0) + (b.itb ?? 0) + (b.lum ?? 0) + (b.servo ?? 0) + (b.ff ?? 0) + (b.damp ?? 0);
};
const roll = (key: string): number => {
  const ix = body.indexByKey.get(key);
  if (ix === undefined) return NaN;
  const q = body.bodies[ix].rotation();
  return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.z * q.z + q.y * q.y)) * 57.3;
};
console.log('t  相位 | τ髋外展 τ髋伸屈 τ膝伸 τ踝跖屈 τ踝额状 | dZ(cm) 躯干R° 大腿R° | 人参考: 外展30-60 膝15-40 踝10-25');
for (let s = 0; s < Math.round(4.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 2.3 || t > 4.3) continue;
  if (Math.abs(t * 20 - Math.round(t * 20)) > 1e-6) continue;
  const dZ = (ctl.sensors.com[2]! - ctl.sensors.feet[1]!.z) * 100;
  console.log(`${t.toFixed(2)} ${(ctl.actions.status.phase ?? '?').padEnd(4)} | ${tau('hip_r', 0).toFixed(0).padStart(6)} ${tau('hip_r', 2).toFixed(0).padStart(6)} ${tau('knee_r', 2).toFixed(0).padStart(5)} ${tau('foot_r', 2).toFixed(0).padStart(6)} ${tau('foot_r', 0).toFixed(0).padStart(6)} | ${dZ.toFixed(1).padStart(5)} ${roll('torso').toFixed(1).padStart(6)} ${roll('thigh_r').toFixed(1).padStart(6)}`);
}
