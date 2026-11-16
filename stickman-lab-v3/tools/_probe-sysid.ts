import './_boot';
import fs from 'node:fs';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';

const T_END = Number(process.env.T_END ?? 6);
const OUT = process.env.SYSID_OUT ?? 'sysid.csv';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
const court: CourtState = squatCourtSetup(w, ctl, 2.0);
const ti = w.body.indexByKey.get('torso')!;
const rows: string[] = ['t,e,v,trZ,trR,u'];
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  w.advance(1);
  squatFrame(w, ctl, court);
  const t = court.t;
  let u = 0;
  if (t >= 2.8 && t < 5.0) {
    const k = Math.floor((t - 2.8) / 0.1);
    let x = (k * 1103515245 + 12345) >>> 0;
    x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0;
    u = (x & 1) ? 20 : -20;
    w.body.bodies[ti]!.applyImpulse({ x: 0, y: 0, z: u * w.dt }, true);
  }
  if (t >= 2.8 && t <= 5.0) {
    const tr = ctl.lateral.parts['trunk'];
    rows.push(`${t.toFixed(4)},${(ctl.sensors.com[2]! * 1000).toFixed(3)},${(ctl.sensors.comVel[2]! * 1000).toFixed(3)},${((tr?.z ?? 0) * 1000).toFixed(3)},${((tr?.roll ?? 0) * 57.3).toFixed(4)},${(u * w.dt).toFixed(6)}`);
  }
  if (court.fall >= 0) break;
}
fs.writeFileSync(OUT, rows.join('\n'));
console.log(`WROTE ${OUT} rows=${rows.length} fall=${court.fall >= 0 ? (court.fall - court.settle).toFixed(3) : 'none'}`);
