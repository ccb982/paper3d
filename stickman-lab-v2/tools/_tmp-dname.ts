import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
const body = w.body as any;
for (const [n, a] of [['hip_r', 0], ['hip_l', 0], ['knee_r', 0], ['foot_r', 0], ['spine1', 0], ['spine1', 2]] as Array<[string, number]>) {
  const di = body.dofByName(n, a);
  const d = di >= 0 ? body.dofs[di] : null;
  console.log(n, a, '-> di', di, '| name:', d ? JSON.stringify(d.name) : 'n/a', '| axis:', d ? d.axis : 'n/a', '| regex:', d ? /^(hip_|knee_|foot_)/.test(d.name) : 'n/a');
}
