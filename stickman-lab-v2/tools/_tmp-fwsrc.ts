import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { observe as obs } from '../src/core/servo/unified';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const dr = ctl.warner.drive as any;
const tot = (n: string, ax: number): number => { const di = body.dofByName(n, ax); if (di<0) return 0; const b = dr.lastBreakdown[di] as any; if (!b) return 0; return (b.stiff||0)+(b.itb||0)+(b.lum||0)+(b.act||0)+(b.servo||0)+(b.ff||0)+(b.damp||0); };
console.log('t | UBvx | UBax | 足/2矩(蹬地) | 髁/2矩 | 膝/2矩 | 腰以上矩合 | CoMx | 足x | CoM-足');
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 12 === 0) {
    const sv = ctl.sensors as any;
    const vx = (sv.comVel[0]! * 100);
    const ax = 0;
    const ubsag = tot('spine1',2)+tot('spine2',2)+tot('spine3',2)+tot('hip_r',2);
    const fx = ((sv.com[0]!)*100);
    const footx = (() => { try { return (body.bodies[body.indexByKey.get('foot_r')].position().x*100); } catch { return 0; } })();
    console.log(`${t.toFixed(2)} | ${vx.toFixed(0).padStart(4)} | ${ax.toFixed(0).padStart(5)} | ${tot('foot_r',2).toFixed(0).padStart(4)} | ${tot('hip_r',2).toFixed(0).padStart(4)} | ${tot('knee_r',2).toFixed(0).padStart(4)} | ${ubsag.toFixed(0).padStart(5)} | ${fx.toFixed(1).padStart(5)} | ${footx.toFixed(1).padStart(5)} | ${(fx-footx).toFixed(1).padStart(5)}`);
  }
}
