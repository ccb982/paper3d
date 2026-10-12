import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const b = w.body as any;
console.log('=== 各链刚体质量（mid=运动学节点应为近零质量）===');
for (const key of ['hand_l', 'arm_l', 'foot_l', 'foot_r', 'shin_l', 'thigh_l']) {
  const ix = b.indexByKey.get(key);
  if (ix === undefined) { console.log(key, 'n/a'); continue; }
  console.log(`${key.padEnd(8)} mass=${b.bodies[ix].mass().toFixed(5)} key exists`);
}
console.log('=== ALL bodies with low mass (mids) ===');
for (let i = 0; i < b.bodies.length; i++) {
  const m = b.bodies[i].mass();
  if (m < 0.5) console.log(`idx=${i} mass=${m.toFixed(6)}`);
}
console.log('=== foot_l 链（从 dof 反查 b1/b2 与质量）===');
for (const ax of [0, 1, 2]) {
  const di = w.body.dofByName('foot_l', ax);
  if (di < 0) continue;
  const d = b.dofs[di]!;
  console.log(`foot_l/${ax}: b1=${d.b1}(m=${b.bodies[d.b1]?.mass?.().toFixed(5)}) b2=${d.b2}(m=${b.bodies[d.b2]?.mass?.().toFixed(5)}) rest=${d.rest.toFixed(2)}`);
}
console.log('=== hand_l 链对照 ===');
for (const ax of [0, 1, 2]) {
  const di = w.body.dofByName('hand_l', ax);
  if (di < 0) continue;
  const d = b.dofs[di]!;
  console.log(`hand_l/${ax}: b1=${d.b1}(m=${b.bodies[d.b1]?.mass?.().toFixed(5)}) b2=${b.bodies[d.b2]?.mass?.().toFixed(5)})`);
}
