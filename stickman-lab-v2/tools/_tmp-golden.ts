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
  return (b.act ?? 0) + (b.itb ?? 0) + (b.lum ?? 0) + (b.servo ?? 0) + (b.ff ?? 0) + (b.damp ?? 0) + (b.stiff ?? 0);
};
const ang = (n: string, ax: number): number => {
  const di = body.dofByName(n, ax);
  return di >= 0 ? body.dofs[di]!.angle * 57.3 : NaN;
};
let t0 = -1;
console.log('t−lift | comZ cm vZ cm/s | 支髋额 τ(ang) | 支踝额 τ | 支踝跖 τ | sp1 τ | 摆脚z cm | 支撑fz');
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  const ph = ctl.actions.status.phase ?? '?';
  if (t0 < 0 && ph === 'B抬腿') t0 = t;
  if (t0 < 0 || t - t0 > 0.32) continue;
  if (Math.abs((t - t0) * 120 - Math.round((t - t0) * 120)) > 1e-6) continue;
  const ti = body.indexByKey.get('mfoot_l');
  const fz = ctl.sensors.feet[1]!.fz;
  console.log(`${((t - t0) * 1000).toFixed(0).padStart(5)}ms | ${(ctl.sensors.com[2]! * 100).toFixed(1).padStart(6)} ${(ctl.sensors.comVel[2]! * 100).toFixed(1).padStart(6)} | ${tau('hip_r', 0).toFixed(0).padStart(5)}(${ang('hip_r', 0).toFixed(1).padStart(5)}) | ${tau('foot_r', 0).toFixed(0).padStart(5)} | ${tau('foot_r', 2).toFixed(0).padStart(5)} | ${tau('spine1', 0).toFixed(0).padStart(4)} | ${(body.bodies[ti]!.translation().z * 100).toFixed(1).padStart(5)} | ${fz.toFixed(0).padStart(4)}`);
}
