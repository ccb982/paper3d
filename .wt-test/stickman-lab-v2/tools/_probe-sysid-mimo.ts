import './_boot';
import fs from 'node:fs';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';

const T_END = Number(process.env.T_END ?? 5.2);
const OUT = process.env.SYSID_OUT ?? 'sysid_mimo.csv';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
const court: CourtState = squatCourtSetup(w, ctl, 2.0);
const ti = w.body.indexByKey.get('torso')!;
const al = w.body.dofByName('foot_l', 0);
const ah = w.body.dofByName('hip_l', 0);
const rows: string[] = ['t,e,v,trZ,trR,ua,uh,ub'];
const bit = (k: number, salt: number): number => { let x = (k * 1103515245 + salt) >>> 0; x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; return (x >>> 0) & 1 ? 1 : -1; };
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  let ua = 0, uh = 0, ub = 0;
  w.advance(1, () => {
    const t = court.t;
    if (t >= 2.8 && t < 5.0) {
      const k = Math.floor((t - 2.8) / 0.1);
      ua = bit(k, 1) * 5;
      uh = bit(k, 2) * 5;
      ub = bit(k, 3) * 10;
      if (al >= 0) w.executor.addTorque(al, ua);
      if (ah >= 0) w.executor.addTorque(ah, uh);
      w.body.bodies[ti]!.applyImpulse({ x: 0, y: 0, z: ub * w.dt }, true);
    }
  });
  squatFrame(w, ctl, court);
  const t = court.t;
  if (t >= 2.8 && t <= 5.0) {
    const tr = ctl.lateral.parts['trunk'];
    rows.push(`${t.toFixed(4)},${(ctl.sensors.com[2]! * 1000).toFixed(3)},${(ctl.sensors.comVel[2]! * 1000).toFixed(3)},${((tr?.z ?? 0) * 1000).toFixed(3)},${((tr?.roll ?? 0) * 57.3).toFixed(4)},${ua.toFixed(3)},${uh.toFixed(3)},${ub.toFixed(3)}`);
  }
  if (court.fall >= 0) break;
}
fs.writeFileSync(OUT, rows.join('\n'));
console.log(`WROTE ${OUT} rows=${rows.length} fall=${court.fall >= 0 ? (court.fall - court.settle).toFixed(3) : 'none'}`);
