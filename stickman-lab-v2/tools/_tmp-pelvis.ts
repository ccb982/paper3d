/** 临时：盆骨段（torso/spine 段）结构直读 */
import './_boot';
import { World } from '../src/core/world';
const w = new World();
const b = w.body;
console.log('刚体列表（段 0 = 骨盆）:');
for (let i = 0; i < b.sk.bodies.length; i++) {
  const def = b.sk.bodies[i]!;
  if (!/torso|spine|thigh|shin|foot/.test(def.key)) continue;
  const bd = b.bodies[i]!;
  const m = bd.mass();
  const t = bd.translation();
  console.log(`  ${def.key.padEnd(10)} mass=${m.toFixed(2)}kg y=${t.y.toFixed(3)} z=${t.z.toFixed(3)} cy=${def.cy.toFixed(3)}`);
}
console.log('\n关节（骨盆相关）:');
for (const j of b.sk.joints) {
  if (!/torso|spine|hip/.test(j.parentKey) && !/torso|spine|hip/.test(j.childKey)) continue;
  console.log(`  ${(j.name ?? '?').padEnd(10)} parent=${j.parentKey.padEnd(10)} child=${j.childKey.padEnd(10)}`);
}
console.log(`\nmassTotal=${b.sk.massTotal.toFixed(1)}kg`);
