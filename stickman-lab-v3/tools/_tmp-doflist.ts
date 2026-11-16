import './_boot';
import { World } from '../src/core/world';
const w = new World();
console.log(`DOF 总数=${w.body.dofs.length}`);
for (const d of w.body.dofs) {
  console.log(`${d.name}/${d.axis}  tauMax=${d.tauMax.toFixed(0)}  range=[${d.min.toFixed(2)},${d.max.toFixed(2)}]  engine=${d.engineMotor ? 'Y' : '-'}${d.engineLimited ? 'L' : ''}`);
}
