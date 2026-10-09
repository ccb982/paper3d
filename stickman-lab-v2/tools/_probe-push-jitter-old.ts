/** _probe-push-jitter-old.ts —— 旧版（b93970d3，按钮=manual）挺腰小腿 HF */
import './_boot';
import { World } from '../src/core/world';
import { BalanceController } from '../src/core/balance';
import { PUSH_RISE } from '../src/core/actions';

function run(label: string, act: boolean): void {
  const w = new World();
  const bal = new BalanceController(w, {
    gravityComp: true, comKp: 12, comKd: 5, maxForceFrac: 0.35,
    postureTone: 8, lateralControl: true,
  });
  w.controller = bal;
  w.reset();
  if (act) bal.manual.play(PUSH_RISE.frames, { loop: false, holdEnd: true });
  const knee = w.body.dofByName('knee_l', 2);
  let w0 = 0, w1 = 0, jit = 0, n = 0;
  for (let s = 0; s < Math.round(2.8 / w.dt); s++) {
    w.advance(1);
    const t = s * w.dt;
    const v = w.body.dofs[knee]!.vel;
    const d2 = v - 2 * w1 + w0;
    if (t > 1.2 && t < 2.6) { jit += d2 * d2; n++; }
    w0 = w1; w1 = v;
  }
  console.log(`${label}：膝 HF 能量=${(jit / Math.max(n, 1)).toExponential(2)}`);
}
run('站立对照 ', false);
run('挺腰(旧版)', true);
