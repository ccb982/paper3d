import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const dh = body.dofByName('hip_r', 0);
console.log('t | M2总 | eZ cm | vZc cm/s | 间隔标');
let lastAct = 0; let gapRun = 0;
for (let s = 0; s < Math.round(4.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 2.7) continue;
  const bd = ctl.warner.drive.lastBreakdown[dh];
  const act = bd ? Math.abs(bd.act) : 0;
  if (act < 8) gapRun += w.dt; else gapRun = 0;
  if (s % 12 === 0) {
    const eZ = (ctl.sensors.com[2]! - ctl.sensors.feet[1]!.z - 0.042) * 100;
    const vz = (ctl.sensors.comVel[2] ?? 0) * 100;
    console.log(`${t.toFixed(2)} | ${(bd ? bd.act.toFixed(0) : '?')} | ${eZ.toFixed(1)} | ${vz.toFixed(1)} | ${gapRun > 0.1 ? '◆间隙' + gapRun.toFixed(2) : ''}`);
    lastAct = act;
  }
}
void lastAct;
