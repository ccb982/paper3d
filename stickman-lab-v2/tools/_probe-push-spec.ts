/** _probe-push-spec.ts —— 蹬地抖动：逐部件 HF + DFT 主频（基线 240Hz） */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('pushRise');
const parts = ['knee_l:2', 'hip_l:2', 'foot_l:2', 'shin_l', 'foot_l', 'mfoot_l', 'arch_l'];
const hf = new Map<string, number>();
const series = new Map<string, number[]>();
for (const p of parts) series.set(p, []);
let n = 0;
for (let s = 0; s < Math.round(3.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t <= 1.2 || t >= 2.6) continue;
  for (const p of parts) {
    let v: number;
    if (p.includes(':')) {
      const [nm, ax] = p.split(':');
      const i = w.body.dofByName(nm!, Number(ax));
      v = i >= 0 ? w.body.dofs[i]!.vel : 0;
    } else {
      const bi = w.body.indexByKey.get(p);
      const av = bi !== undefined ? w.body.bodies[bi]!.angvel() : { x: 0, y: 0, z: 0 };
      v = Math.hypot(av.x, av.y, av.z);
    }
    series.get(p)!.push(v);
  }
  n++;
}
for (const p of parts) {
  const arr = series.get(p)!;
  let jit = 0;
  for (let k = 2; k < arr.length; k++) {
    const d2 = arr[k]! - 2 * arr[k - 1]! + arr[k - 2]!;
    jit += d2 * d2;
  }
  // DFT 主频（10..120Hz）
  const N = arr.length;
  let bestF = 0, bestA = 0;
  for (let f = 10; f <= 120; f += 1) {
    let re = 0, im = 0;
    const om = (2 * Math.PI * f) / w.dt;
    for (let k = 0; k < N; k++) { re += arr[k]! * Math.cos(om * k); im -= arr[k]! * Math.sin(om * k); }
    const a = Math.hypot(re, im) / N;
    if (a > bestA) { bestA = a; bestF = f; }
  }
  console.log(`${p}: HF=${(jit / N).toExponential(2)}  主频=${bestF}Hz(幅${bestA.toFixed(3)})`);
}
