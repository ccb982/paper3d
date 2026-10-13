import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
for (let s = 0; s < Math.round(1.0 / w.dt); s++) w.advance(1);
const body = w.body as any;
for (const nm of ['hip_r','knee_r','foot_r','spine1','spine2','spine3']) {
  for (const ax of [0,1,2]) {
    const di = body.dofByName(nm, ax);
    if (di < 0) continue;
    const d = body.dofs[di];
    const a = [d.axisWorld[0], d.axisWorld[1], d.axisWorld[2]].map((v:number)=>v.toFixed(2));
    const r = [d.anchorWorld[0], d.anchorWorld[1], d.anchorWorld[2]].map((v:number)=>v.toFixed(2));
    console.log(`${nm}/${ax}: axis=(${a.join(',')}) anchor=(${r.join(',')})`);
  }
}
