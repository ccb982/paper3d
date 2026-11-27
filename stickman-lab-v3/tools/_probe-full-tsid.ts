import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { solveFullTsid } from '../src/core/servo/fullTsid';
import { evalFootContactTask } from '../src/core/servo/footContactTask';
import { sampleFootContact } from '../src/core/servo/footContact';

const w = new World();
const ctl = new ControlModule(w);
w.reset();
w.switchPoseState('stand');
ctl.footAnkle.world.capture(w);
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
const accDes = (['l', 'r'] as const).map((side) => {
  const bi = w.body.indexByKey.get(`foot_${side}`)!;
  const rb = w.body.bodies[bi]!;
  const target = ctl.footAnkle.world.pose.get(side);
  const fc = sampleFootContact(w, side);
  const p = rb.translation(), q = rb.rotation(), v = rb.linvel(), av = rb.angvel();
  return evalFootContactTask({
    contact: fc.contact, copInside: fc.copInside, fz: fc.fzFiltered, fzMin: 5,
    targetP: target?.p ?? { x: p.x, y: p.y, z: p.z },
    targetQ: target?.q ?? q, actualP: { x: p.x, y: p.y, z: p.z },
    actualQ: q,
    linVel: { x: v.x, y: v.y, z: v.z }, angVel: { x: av.x, y: av.y, z: av.z },
    posMargin: 0.02, rotMargin: 0.12, linVelMargin: 0.2, angVelMargin: 1.5,
  }).accDes;
});
const wDes = contacts.flatMap((c) => [0, c.fy, 0, 0, 0, 0]);
const out = solveFullTsid({ w, contacts, contactAccDes: accDes, wDes });
console.log(`fullTsid feasible=${out.feasible} message=${out.message} contacts=${contacts.length} tau=${out.tau.length} qdd=${out.qdd.length} W=${out.W.length}`);
if (out.feasible) {
  console.log('tau', out.tau.slice(0, 8).map((v) => +v.toFixed(2)));
  console.log('qdd', out.qdd.slice(0, 8).map((v) => +v.toFixed(3)));
  console.log('W', out.W.slice(0, 12).map((v) => +v.toFixed(2)));
  console.log('baseResidual', out.baseResidual.map((v) => +v.toFixed(3)));
  console.log('contactResidual', out.contactResidual.map((v) => +v.toFixed(3)));
}
