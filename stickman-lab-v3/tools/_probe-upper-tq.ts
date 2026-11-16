/** _probe-upper-tq: upper body (spine+shoulders) torque readback during lift & after. */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');

const body = w.body;
const d = (n: string, ax: number) => body.dofByName(n, ax);
const net = (i: number) => { const b = w.drive.lastBreakdown[i]!; return b.stiff + b.itb + b.lum + b.act + b.servo + b.ff + b.damp; };
console.log('t      phase      sp1轴0τ sp2轴0τ sp3轴0τ | sp1轴2τ sp2轴2τ sp3轴2τ | 肩Lτ 肩Rτ | 躯干pitch roll');
for (let s = 0; s < Math.round(9.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.5 || t > 7.0) continue;
  if (s % Math.round(0.2 / w.dt) !== 0) continue;
  const g = (n: string, ax: number) => { const i = d(n, ax); return i >= 0 ? net(i) : 0; };
  console.log(
    `${t.toFixed(2)}  ${(ctl.actions.status.phase ?? '-').padEnd(9)} ${g('spine1', 0).toFixed(0).padStart(6)} ${g('spine2', 0).toFixed(0).padStart(6)} ${g('spine3', 0).toFixed(0).padStart(6)} | ` +
    `${g('spine1', 2).toFixed(0).padStart(6)} ${g('spine2', 2).toFixed(0).padStart(6)} ${g('spine3', 2).toFixed(0).padStart(6)} | ` +
    `${g('shoulder_l', 2).toFixed(0).padStart(5)} ${g('shoulder_r', 2).toFixed(0).padStart(5)} | ${ctl.sensors.torsoTilt[0]!.toFixed(2)} ${ctl.sensors.torsoTilt[1]!.toFixed(2)}`,
  );
}
