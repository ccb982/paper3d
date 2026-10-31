/** _probe-foot-hf.ts —— 脚部抖动定位：踝环 vs 鞋底/柔性足引擎（480Hz 静站） */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

function run(label: string, opts: object): void {
  const w = new World({ physicsHz: 480, ...opts });
  const ctl = new ControlModule(w, { postureTone: 8 });
  w.controller = ctl;
  w.reset();
  for (let s = 0; s < Math.round(2 / w.dt); s++) w.advance(1);
  const names = ['foot_l', 'mfoot_l', 'arch_l'];
  const stats: string[] = [];
  for (const n of names) {
    const bi = w.body.indexByKey.get(n);
    if (bi === undefined) { stats.push(`${n}=—`); continue; }
    let w0 = 0, w1 = 0, hf = 0, nn = 0;
    for (let s = 0; s < Math.round(0.8 / w.dt); s++) {
      w.advance(1);
      const av = w.body.bodies[bi]!.angvel();
      const mag = Math.hypot(av.x, av.y, av.z);
      const d2 = mag - 2 * w1 + w0;
      hf += d2 * d2; nn++;
      w0 = w1; w1 = mag;
    }
    stats.push(`${n} HF=${(hf / nn).toExponential(1)}`);
  }
  console.log(`${label}: ${stats.join('  ')}`);
}
run('默认(arch 400/12)', {});
run('arch 阻尼 40    ', { body: { archDamping: 40 } });
run('arch 刚度 150   ', { body: { archStiffness: 150 } });
