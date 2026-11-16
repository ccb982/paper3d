import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
const body = w.body as any;
const keys = Array.from(body.indexByKey.keys());
console.log('BODIES:', keys.join(' '));
console.log('DOFS:', Array.from(body.dofNames || []).join(' ') || '(none)');
for (const k of keys) {
  const ix = body.indexByKey.get(k);
  const b = body.bodies[ix];
  console.log(k, '| parent:', b.parentIndex ?? b.parent ?? '?', '| joints:', (b.jointDofs ?? b.dofs ?? []).length ?? '?');
}
