/**
 * _probe-wave.ts —— 抖动波形：spine1/2 每步角度/速度（0.3s）
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
// 先跑 1s 进入稳态
for (let s = 0; s < 240; s++) w.advance(1);
const di = w.body.dofByName('spine1', 2);
const j = w.sk.joints.find((x) => x.name === 'spine1')!;
const pIdx = w.body.indexByKey.get(j.parentKey)!;
const cIdx = w.body.indexByKey.get(j.childKey)!;
console.log('step  θ(rad)    ω_proj    |ωp|   |ωc|   |ωc−ωp|');
for (let s = 0; s < 72; s++) {
  w.advance(1);
  if (s % 6 === 0) {
    const d = w.body.dofs[di]!;
    const wp = w.body.bodies[pIdx]!.angvel();
    const wc = w.body.bodies[cIdx]!.angvel();
    const magP = Math.hypot(wp.x, wp.y, wp.z);
    const magC = Math.hypot(wc.x, wc.y, wc.z);
    const magD = Math.hypot(wc.x - wp.x, wc.y - wp.y, wc.z - wp.z);
    console.log(`${String(s).padStart(4)}  ${d.angle.toFixed(5)}  ${d.vel.toFixed(3).padStart(8)}  ${magP.toFixed(2).padStart(6)} ${magC.toFixed(2).padStart(6)} ${magD.toFixed(2).padStart(7)}`);
  }
}
