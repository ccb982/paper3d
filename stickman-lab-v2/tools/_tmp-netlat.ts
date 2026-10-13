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
const act = (n: string, ax: number): string => { try { const di = body.dofByName(n, ax); if (di<0) return '  n/a'; const b = dr.lastBreakdown[di] as any; return b ? ((b.act||0)).toFixed(0).padStart(5) : '  ---'; } catch { return '  err'; } };
let pv = 0;
console.log('t | 侧加速(cm/s2) | 踝0 | 髋0 | 脊1_0 | 脊2_0 | 髋1(yaw) | 腹斜(脊1_1) | comZ速');
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  const vz = ctl.sensors.comVel[2]!;
  const az = (vz - pv) / w.dt; pv = vz;
  if (t > 2.3 && s % 24 === 0) {
    console.log(`${t.toFixed(2)} | ${(az*100).toFixed(0).padStart(6)} | ${act('foot_r',0)} | ${act('hip_r',0)} | ${act('spine1',0)} | ${act('spine2',0)} | ${act('hip_r',1)} | ${act('spine1',1)} | ${(vz*100).toFixed(1).padStart(5)}`);
  }
}
