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
const tot = (n: string, ax: number): string => { const di = body.dofByName(n, ax); if (di<0) return '  n/a'; const b = dr.lastBreakdown[di] as any; if (!b) return '  ---'; const t = (b.stiff||0)+(b.act||0)+(b.servo||0)+(b.ff||0)+(b.damp||0)+(b.lum||0)+(b.itb||0); return t.toFixed(0).padStart(5); };
console.log('t | sp4→ | sp3→ | sp2→ | sp1→ | 骫2 | 膝2 | 足2 | 合计 | fz(N)');
for (let s = 0; s < Math.round(3.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.2 && s % 16 === 0) {
    const g = (n: string, ax: number): number => { const di = body.dofByName(n, ax); if (di<0) return 0; const b = dr.lastBreakdown[di] as any; return b ? ((b.stiff||0)+(b.act||0)+(b.servo||0)+(b.ff||0)+(b.damp||0)+(b.lum||0)+(b.itb||0)) : 0; };
    const sum = g('spine4',2)+g('spine3',2)+g('spine2',2)+g('spine1',2)+g('hip_r',2)+g('knee_r',2)+g('foot_r',2);
    console.log(`${t.toFixed(2)} | ${tot('spine4',2)} | ${tot('spine3',2)} | ${tot('spine2',2)} | ${tot('spine1',2)} | ${tot('hip_r',2)} | ${tot('knee_r',2)} | ${tot('foot_r',2)} | ${sum.toFixed(0).padStart(5)} | ${ctl.sensors.feet[1]!.fz.toFixed(0).padStart(4)}`);
  }
}
