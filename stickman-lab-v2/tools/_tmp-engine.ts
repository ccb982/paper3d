import './_boot';
import { World } from '../src/core/world';
const w = new World();
for (const d of w.body.dofs) {
  if ((d as { engineMotor?: boolean }).engineMotor) console.log(`engineMotor: ${d.name}/${d.axis}`);
}
