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
const g = (n: string, ax: number): {act:number; cap:number} => { const di = body.dofByName(n, ax); if (di<0) return {act:0,cap:0}; const b = dr.lastBreakdown[di] as any; return { act: (b?.act||0), cap: (dr.pairCap[di] ?? Infinity) }; };
console.log('t | 脊矢act | 脊侧act | 髋2act | 踝0act | 脊矢cap | 脊侧cap | 髋cap | 踝cap');
for (let s = 0; s < Math.round(3.3 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.3 && s % 10 === 0) {
    const sag = g('spine1',2).act + g('spine2',2).act + g('spine3',2).act;
    const lat = g('spine1',0).act + g('spine2',0).act + g('spine3',0).act;
    const sagCap = g('spine2',2).cap;
    const latCap = g('spine2',0).cap;
    const hipCap = (() => { const di = body.dofByName('hip_r',0); return dr.pairCap[di] ?? Infinity; })();
    const ankCap = (() => { const di = body.dofByName('foot_r',0); return dr.pairCap[di] ?? Infinity; })();
    console.log(`${t.toFixed(2)} | ${sag.toFixed(0).padStart(6)} | ${lat.toFixed(0).padStart(6)} | ${g('hip_r',2).act.toFixed(0).padStart(5)} | ${g('foot_r',0).act.toFixed(0).padStart(5)} | ${sagCap.toFixed(0).padStart(6)} | ${latCap.toFixed(0).padStart(6)} | ${(hipCap===Infinity?'∞':hipCap.toFixed(0)).padStart(5)} | ${(ankCap===Infinity?'∞':ankCap.toFixed(0)).padStart(5)}`);
  }
}
