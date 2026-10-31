/** _perf3.ts —— 碰撞体/接触数统计 + 分类计时 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World({ physicsHz: 480 });
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
let colliders = 0;
for (const list of w.body.collidersByBody) colliders += list.length;
console.log(`刚体=${w.body.allBodies.length}  碰撞体=${colliders}  逻辑关节=${w.sk.joints.length}  自由度=${w.body.dofs.length}`);
// 分步计时：物理 vs JS
for (let i = 0; i < 960; i++) w.advance(1);
let tPhys = 0, tAll = 0;
for (let i = 0; i < 960; i++) {
  const a = performance.now();
  w.advance(1);
  const b = performance.now();
  tAll += b - a;
}
console.log(`平均 ${(tAll / 960).toFixed(3)} ms/步`);
