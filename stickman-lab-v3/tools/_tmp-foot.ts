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
const tot = (n: string, ax: number): string => { const di = body.dofByName(n, ax); if (di<0) return '  n/a'; const b = dr.lastBreakdown[di] as any; if (!b) return '  ---'; return ((b.act||0)+(b.servo||0)+(b.ff||0)+(b.stiff||0)+(b.damp||0)).toFixed(0).padStart(5); };
const y = (n: string): number => { try { const ix = body.indexByKey.get(n); if (ix === undefined) return 0; return body.bodies[ix].translation().y; } catch { return 0; } };
console.log('t | fz(N) | CoPz | 足y | 足0矩 | 足1矩 | 足2矩(蹬地) | 足2角 | 输出速度(下+?)');
let py = 0, py2 = 0;
for (let s = 0; s < Math.round(3.3 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  const f = ctl.sensors.feet[1]!;
  const fy = y('foot_r');
  const fyv = (fy - py) / w.dt; py = fy;
  const a2 = body.dofs[body.dofByName('foot_r',2)]?.angle ?? 0;
  const a2v = (a2 - py2) / w.dt; py2 = a2;
  if (t > 2.3 && s % 16 === 0) {
    console.log(`${t.toFixed(2)} | ${f.fz.toFixed(0).padStart(4)} | ${f.copZ.toFixed(3).padStart(6)} | ${(fy*100).toFixed(2).padStart(6)} | ${tot('foot_r',0)} | ${tot('foot_r',1)} | ${tot('foot_r',2)} | ${(a2*57.3).toFixed(0).padStart(4)} | ${(a2v*57.3).toFixed(0).padStart(5)}`);
  }
}
