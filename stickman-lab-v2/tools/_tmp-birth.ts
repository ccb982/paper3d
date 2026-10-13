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
const bz = (n: string): number => { try { const ix = body.indexByKey.get(n); if (ix === undefined) return 0; return body.bodies[ix].translation().z; } catch { return 0; } };
const act = (n: string, ax: number): string => { try { const di = body.dofByName(n, ax); if (di<0) return '  n/a'; const b = dr.lastBreakdown[di] as any; if (!b) return '  ---'; return ((b.act||0)+(b.servo||0)+(b.ff||0)+(b.stiff||0)).toFixed(0).padStart(5); } catch { return '  err'; } };
let pc = 0, psl = 0, pfr = 0;
console.log('t | comZ | comZ速 | 摆足Z | 摆足速 | 支撑足Z | 髋0(支) | 膝0(支) | 腰以上0合');
for (let s = 0; s < Math.round(2.7 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  const cz = ctl.sensors.com[2]!; const vz = ctl.sensors.comVel[2]!;
  const sl = bz('foot_l'); const slv = (sl - psl) / w.dt; psl = sl;
  const fr = bz('foot_r'); const frv = (fr - pfr) / w.dt; pfr = fr;
  if (t > 1.85 && s % 12 === 0) {
    const sp = act('spine1',0).trim() !== 'n/a' ? 0 : 0;
    void sp; void pc;
    const ubs = ((dr.lastBreakdown[body.dofByName('spine1',0)]?.act||0)+(dr.lastBreakdown[body.dofByName('spine2',0)]?.act||0)+(dr.lastBreakdown[body.dofByName('spine3',0)]?.act||0)).toFixed(0).padStart(5);
    console.log(`${t.toFixed(2)} | ${(cz*100).toFixed(1).padStart(5)} | ${(vz*100).toFixed(0).padStart(4)} | ${(sl*100).toFixed(1).padStart(6)} | ${(slv*100).toFixed(0).padStart(4)} | ${(fr*100).toFixed(1).padStart(6)} | ${act('foot_r',0)} | ${act('knee_r',0)} | ${ubs}`);
  }
}
