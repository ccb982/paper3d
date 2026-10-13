import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const dr = ctl.warner.drive as any;
const act = (n: string, ax: number): string => { const di = body.dofByName(n, ax); if (di<0) return ' n/a'; const b = dr.lastBreakdown[di] as any; return b ? ((b.act||0)).toFixed(1).padStart(6) : '  ---'; };
const W = body.sk.massTotal * 9.81;
console.log('t | comZ | footZ | latNeed | 足/0 act | 骫/0 act | sp1/0 act | tiltRel | sp2/0 act');
for (let s = 0; s < Math.round(3.3 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) {
    const comZ = ctl.sensors.com[2]!;
    const fZ = ctl.sensors.feet[1]!.z;
    const lat = W * (comZ - fZ);
    console.log(`${t.toFixed(2)} | ${comZ.toFixed(3).padStart(6)} | ${fZ.toFixed(3).padStart(6)} | ${lat.toFixed(1).padStart(7)} | ${act('foot_r',0)} | ${act('hip_r',0)} | ${act('spine1',0)} | ${(ctl.sensors as any).torsoTilt ? (ctl.sensors.torsoTilt[1]*57.3).toFixed(1).padStart(6) : ' n/a'} | ${act('spine2',0)}`);
  }
}
