import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const P = (key: string, what: 'y' | 'z' | 'wz' | 'vz'): number => {
  const ix = body.indexByKey.get(key);
  if (ix === undefined) return NaN;
  const b = body.bodies[ix];
  const p = b.translation();
  const v = b.linvel();
  if (what === 'y') return p.y * 100;
  if (what === 'z') return p.z * 100;
  if (what === 'vz') return v.z * 100;
  return b.angvel().z * 57.3;
};
let lastPh = '';
for (let s = 0; s < Math.round(4.0 / w.dt); s++) {
  w.advance(1);
  const ph = ctl.actions.status.phase ?? '?';
  if (ph !== lastPh) {
    console.log(`--- ${ph} @${(s * w.dt).toFixed(2)}s`);
    lastPh = ph;
  }
  if ((ph === 'B\u62ac\u817f' || ph === 'C\u4fdd\u6301') && s % 12 === 0) {
    const fz = ctl.sensors.feet[1]!.fz;
    const W = body.sk.massTotal * 9.81;
    const t = (s * w.dt).toFixed(2);
    const fzL = ctl.sensors.feet[0]!.fz;
    console.log(`t=${t} 右y=${P('foot_r', 'y').toFixed(1)} 右载=${(fz / W * 100).toFixed(0)}% 右ωz=${P('foot_r', 'wz').toFixed(0)} 右vz=${P('foot_r', 'vz').toFixed(0)} | 左y=${P('foot_l', 'y').toFixed(1)} 左载=${(fzL / W * 100).toFixed(0)}% 左ωz=${P('foot_l', 'wz').toFixed(0)} 左vz=${P('foot_l', 'vz').toFixed(0)} | tilt=${(ctl.sensors.torsoTilt[1]! * 57.3).toFixed(1)} CoMz=${((ctl.sensors.com[2]! - ctl.sensors.feet[1]!.z) * 100).toFixed(1)}`);
  }
}
