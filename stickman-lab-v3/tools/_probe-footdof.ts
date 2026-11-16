import './_boot';
import { World } from '../src/core/world';
const w = new World();
w.reset();
for (const ax of [0,1,2]) {
  const i = w.body.dofByName('foot_l', ax);
  const d = w.body.dofs[i]!;
  console.log(`foot_l/${ax} engineMotor=${d.engineMotor} preRing=${d.preRing} min=${(d.min*57.3).toFixed(1)} max=${(d.max*57.3).toFixed(1)} tauMax=${d.tauMax} axisWorld=(${d.axisWorld.map((v:number)=>v.toFixed(2)).join(',')})`);
}
