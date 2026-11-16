/** _probe-foot-10hz.ts —— 蹬地时脚踝 10Hz 振荡幅值（变体：arch 阻尼） */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

function run(label: string, body: object): void {
  const w = new World({ body: body as never });
  const ctl = new ControlModule(w, { postureTone: 8 });
  w.controller = ctl;
  w.reset();
  ctl.actions.play('pushRise');
  const foot = w.body.dofByName('foot_l', 2);
  const knee = w.body.dofByName('knee_l', 2);
  const arr: number[] = [];
  const karr: number[] = [];
  for (let s = 0; s < Math.round(2.6 / w.dt); s++) {
    w.advance(1);
    const t = s * w.dt;
    if (t >= 1.2 && t < 2.6) { arr.push(w.body.dofs[foot]!.vel); karr.push(w.body.dofs[knee]!.vel); }
  }
  const ampAt = (a: number[], f: number) => {
    let re = 0, im = 0;
    for (let k = 0; k < a.length; k++) { const om = 2 * Math.PI * f * k * w.dt; re += a[k]! * Math.cos(om); im -= a[k]! * Math.sin(om); }
    return Math.hypot(re, im) / a.length;
  };
  let bestF = 0, bestA = 0;
  for (let f = 4; f <= 40; f += 1) { const a = ampAt(arr, f); if (a > bestA) { bestA = a; bestF = f; } }
  const jit = (a: number[]) => { let j = 0; for (let k = 2; k < a.length; k++) j += (a[k]! - 2 * a[k - 1]! + a[k - 2]!) ** 2; return j / a.length; };
  console.log(`${label}: 脚主频=${bestF}Hz(幅${bestA.toFixed(2)})  脚HF=${jit(arr).toExponential(1)} 膝HF=${jit(karr).toExponential(1)}`);
}
run('基线 400/12 ', {});
run('arch 400/40 ', { archDamping: 40 });
run('arch 400/80 ', { archDamping: 80 });
