import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';
const w = new World();
const ctl = new ControlModule(w, { postureTone: Number(process.env.TONE ?? 8) });
w.controller = ctl;
w.reset();
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
for (let s = 0; s < 480; s++) { supportClean(ctx, 'r'); supportClean(ctx, 'l'); w.advance(1); }
ctl.actions.idleEnabled = false;
ctl.actions.play(String(process.env.ACT ?? '深蹲'));
const fr = w.body.bodies[w.body.indexByKey.get('foot_r')!]!;
for (let s = 0; s < 2880; s++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  if (s % 120 === 0) {
    const com = ctl.sensors.com;
    const p = fr.translation();
    const q = fr.rotation();
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    console.log(`A t=${(s / 480).toFixed(2)} comY=${(com[1]! * 100).toFixed(1)}cm fz=${ctl.sensors.feet[0]!.fz.toFixed(0)}/${ctl.sensors.feet[1]!.fz.toFixed(0)} 脚R=(${(p.x * 100).toFixed(0)},${(p.y * 100).toFixed(0)}) up=${upY.toFixed(2)} 动作=${ctl.actions.status.active ? ctl.actions.status.id : '-'}`);
  }
}
