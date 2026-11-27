import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { solveFullTsid } from '../src/core/servo/fullTsid';

const w = new World();
new ControlModule(w);
w.reset();
w.switchPoseState('stand');
for (let k = 0; k < 60; k++) w.advance(1);
const contacts = (['l', 'r'] as const).map((side) => {
  const bi = w.body.indexByKey.get(`foot_${side}`)!;
  const p = w.body.bodies[bi]!.translation();
  const fz = w.body.footNormalForce(side, w.dt);
  return {
    body: bi, x: p.x, y: p.y, z: p.z,
    fx: 0, fy: fz, fz: 0,
    tx: 0, ty: 0, tz: 0,
    halfX: 0.12, halfZ: 0.06, mu: 0.7, fzMin: 0,
  };
});
const accDes = contacts.map(() => [0, 0, 0, 0, 0, 0]);
const wDes = contacts.flatMap((c) => [0, c.fy, 0, 0, 0, 0]);
const out = solveFullTsid({ w, contacts, contactAccDes: accDes, wDes });
console.log(`fullTsid feasible=${out.feasible} message=${out.message} contacts=${contacts.length} tau=${out.tau.length} qdd=${out.qdd.length} W=${out.W.length}`);
if (out.feasible) {
  console.log('tau', out.tau.slice(0, 8).map((v) => +v.toFixed(2)));
  console.log('qdd', out.qdd.slice(0, 8).map((v) => +v.toFixed(3)));
  console.log('W', out.W.slice(0, 12).map((v) => +v.toFixed(2)));
}
