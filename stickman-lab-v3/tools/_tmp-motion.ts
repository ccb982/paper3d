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
const A = (n: string, ax: number): string => {
  const di = body.dofByName(n, ax);
  if (di < 0) return '  --   --  ';
  const d = body.dofs[di]!;
  return `${(d.angle * 57.3).toFixed(1).padStart(5)} ${d.vel.toFixed(1).padStart(5)}`;
};
const roll = (key: string): number => {
  const ix = body.indexByKey.get(key);
  if (ix === undefined) return NaN;
  const q = body.bodies[ix].rotation();
  return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.z * q.z + q.y * q.y)) * 57.3;
};
console.log('t 相 | comZ vZ | 支髋: τ ang vel | 支踝额: τ ang vel | 支膝: τ | sp1角 | 大腿R 躯干R');
for (let s = 0; s < Math.round(4.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 2.4 || t > 4.3) continue;
  if (Math.abs(t * 20 - Math.round(t * 20)) > 1e-6) continue;
  console.log(`${t.toFixed(2)} ${(ctl.actions.status.phase ?? '?').slice(0, 1)} | ${(ctl.sensors.com[2]! * 100).toFixed(1).padStart(6)} ${(ctl.sensors.comVel[2]! * 100).toFixed(1).padStart(5)} | ${tau('hip_r', 0).toFixed(0).padStart(4)} ${A('hip_r', 0)} | ${tau('foot_r', 0).toFixed(0).padStart(4)} ${A('foot_r', 0)} | ${tau('knee_r', 2).toFixed(0).padStart(4)} | ${A('spine1', 0).slice(0, 5)} | ${roll('thigh_r').toFixed(1).padStart(5)} ${roll('torso').toFixed(1).padStart(5)}`);
}
