import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
const body = w.body as any;
const names: string[] = [];
for (const n of ['spine1','spine2','spine3','spine4','torso','pelvis','chest']) {
  for (const ax of [0,1,2]) {
    const d = body.dofByName(n, ax);
    if (d >= 0) names.push(n + '/' + ax + '=' + d);
  }
}
console.log('SPINE-family dofs:', names.join(' '));
console.log('total dofs:', body.dofs.length);
const all: string[] = [];
for (let i = 0; i < body.dofs.length; i++) { const d = body.dofs[i]; all.push((d.name ?? '?') + '/' + (d.axis ?? '?')); }
console.log('ALL:', all.join(' '));
