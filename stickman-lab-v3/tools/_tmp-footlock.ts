import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const roll = (key: string): number => {
  const ix = body.indexByKey.get(key);
  if (ix === undefined) return NaN;
  const q = body.bodies[ix].rotation();
  return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.z * q.z + q.y * q.y)) * 57.3;
};
const drive = (ctl as any).drive ?? (w as any).drive;
const bdOf = (n: string, ax: number): string => {
  const di = body.dofByName(n, ax);
  if (di < 0) return ' --';
  const b = drive?.lastBreakdown?.[di] ?? {};
  const s = (v: number | undefined): string => (v ?? 0).toFixed(0).padStart(4);
  return `${s(b.act)}${s(b.servo)}${s(b.ff)}${s(b.damp)}${s(b.stiff)}`;
};
console.log('t  相位 | 足R° 小腿R° 大腿R° | 踝0角° 踝0速 | 踝0(bd:act servo ff damp stiff) | 摆脚fz 撑脚fz');
for (let s = 0; s < Math.round(4.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 2.2 || t > 4.3) continue;
  if (Math.abs(t * 40 - Math.round(t * 40)) > 1e-6) continue;
  const d0 = body.dofByName('foot_r', 0);
  const ang = d0 >= 0 ? (body.dofs[d0]!.angle * 57.3).toFixed(1).padStart(5) : '  --';
  const vel = d0 >= 0 ? body.dofs[d0]!.vel.toFixed(1).padStart(5) : '  --';
  const fl = ctl.sensors.feet[0]!.fz, fr = ctl.sensors.feet[1]!.fz;
  console.log(`${t.toFixed(2)} ${(ctl.actions.status.phase ?? '?').padEnd(4)} | ${roll('foot_r').toFixed(1).padStart(5)} ${roll('shin_r').toFixed(1).padStart(6)} ${roll('thigh_r').toFixed(1).padStart(7)} | ${ang} ${vel} |  ${bdOf('foot_r', 0)} | ${fl.toFixed(0).padStart(4)} ${fr.toFixed(0).padStart(4)}`);
}
