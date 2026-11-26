import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { solveFloatingBaseId } from '../src/core/servo/floatingBaseId';

const w = new World();
new ControlModule(w);
w.reset();
w.switchPoseState('stand');
for (let k = 0; k < 60; k++) w.advance(1);
const contacts = w.body.allContactSamples(w.dt).map((c) => ({
  body: c.body, x: c.x, y: c.y, z: c.z,
  fx: c.fx, fy: c.fy, fz: c.fz,
  tx: 0, ty: 0, tz: 0,
}));
const qdd = new Array(w.body.dofs.length + 6).fill(0);
const id = solveFloatingBaseId({ w, qdd, contacts });
let finite = true;
for (const v of id.tau) if (!Number.isFinite(v)) finite = false;
for (const v of id.baseResidual) if (!Number.isFinite(v)) finite = false;
for (const row of id.M) for (const v of row) if (!Number.isFinite(v)) finite = false;
console.log(`floating nq=${w.body.dofs.length + 6} contacts=${contacts.length} tau=${id.tau.length} finite=${finite}`);
console.log('tau', id.tau.slice(0, 12).map((v) => +v.toFixed(2)));
console.log('baseResidual', id.baseResidual.map((v) => +v.toFixed(2)));
