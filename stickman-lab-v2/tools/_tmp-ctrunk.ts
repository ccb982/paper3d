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
const g = (n: string, ax: number): number => {
  const i = body.dofByName(n, ax);
  return i >= 0 ? body.dofs[i]!.angle * 57.3 : NaN;
};
let comZ0 = 0, entered = false;
console.log('t  相位 | comZ(cm) footZ(cm) errZ=comZ−comZ0 | spine1_0° spine2_0° spine3_0° | 躯干R° | hipR0角°(支撑外展)');
for (let s = 0; s < Math.round(4.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.3 || t > 4.3) continue;
  if (Math.abs(t * 20 - Math.round(t * 20)) > 1e-6) continue;
  const ph = ctl.actions.status.phase ?? '?';
  if (!entered && ph === 'C保持') { comZ0 = ctl.sensors.com[2]!; entered = true; }
  const comZ = ctl.sensors.com[2]!;
  const footZ = ctl.sensors.feet[1]!.z;
  console.log(`${t.toFixed(2)} ${ph.padEnd(4)} | ${(comZ * 100).toFixed(1).padStart(6)} ${(footZ * 100).toFixed(1).padStart(7)} ${((comZ - comZ0) * 100).toFixed(1).padStart(8)} | ${g('spine1', 0).toFixed(2).padStart(8)} ${g('spine2', 0).toFixed(2).padStart(8)} ${g('spine3', 0).toFixed(2).padStart(8)} | ${roll('torso').toFixed(1).padStart(6)} | ${g('hip_r', 0).toFixed(1).padStart(6)}`);
}
