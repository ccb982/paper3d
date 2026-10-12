/** _probe-hf-joints: per-joint HF (2nd-difference energy) during single-leg => trembling map. */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');

const joints: Array<[string, number]> = [
  ['spine1', 0], ['spine1', 2], ['spine2', 0], ['spine2', 2],
  ['hip_r', 0], ['hip_r', 2], ['knee_r', 2], ['foot_r', 0], ['foot_r', 2],
  ['hip_l', 2], ['knee_l', 2], ['foot_l', 0], ['foot_l', 2],
];
const st = new Map<string, { w0: number; w1: number; e: number; n: number }>();
for (const [n, ax] of joints) st.set(`${n}/${ax}`, { w0: 0, w1: 0, e: 0, n: 0 });
let order = 0;
for (let s = 0; s < Math.round(9.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  for (const [n, ax] of joints) {
    const d = w.body.dofByName(n, ax);
    if (d < 0) continue;
    const v = w.body.dofs[d]!.vel;
    const k = `${n}/${ax}`;
    const o = st.get(k)!;
    const d2 = v - 2 * o.w1 + o.w0;
    if (t > 3.2 && t < 3.9) { o.e += d2 * d2; o.n++; }   // ★ 窗口=抬脚瞬间
    o.w0 = o.w1; o.w1 = v;
  }
  order++;
  void order;
}
console.log('单腿期逐关节 HF 能量（二阶差分，>1e-3 即显著抖动）：');
const rows = [...st.entries()].map(([k, o]) => [k, o.n > 0 ? o.e / o.n : 0] as const).sort((a, b) => b[1] - a[1]);
for (const [k, v] of rows) console.log(`  ${k.padEnd(10)} ${v.toExponential(2)}${v > 1e-3 ? '  ★抖' : ''}`);
