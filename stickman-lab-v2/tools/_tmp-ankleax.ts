import './_boot';
import { World } from '../src/core/world';
const w = new World();
for (const d of w.body.dofs) {
  if (/foot_l|foot_r/.test(d.name)) console.log(`${d.name}/${d.axis}  range=[${d.min.toFixed(2)},${d.max.toFixed(2)}]`);
}
