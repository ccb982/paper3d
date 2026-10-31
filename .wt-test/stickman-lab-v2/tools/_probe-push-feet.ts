/** _probe-push-feet.ts —— 蹬地段各部件 HF 定位（480Hz，扫 arch 参数） */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

function run(label: string, body: object): void {
  const w = new World({ physicsHz: 480, body: body as never });
  const ctl = new ControlModule(w, { postureTone: 8 });
  w.controller = ctl;
  w.reset();
  ctl.actions.play('pushRise');
  const parts = ['foot_l', 'mfoot_l', 'arch_l'];
  const st = parts.map(() => ({ w0: 0, w1: 0, hf: 0, n: 0 }));
  for (let s = 0; s < Math.round(3.0 / w.dt); s++) {
    w.advance(1);
    const t = s * w.dt;
    parts.forEach((n, k) => {
      const bi = w.body.indexByKey.get(n);
      if (bi === undefined) return;
      const av = w.body.bodies[bi]!.angvel();
      const mag = Math.hypot(av.x, av.y, av.z);
      const d2 = mag - 2 * st[k]!.w1 + st[k]!.w0;
      if (t > 1.2 && t < 2.6) { st[k]!.hf += d2 * d2; st[k]!.n++; }
      st[k]!.w0 = st[k]!.w1; st[k]!.w1 = mag;
    });
  }
  console.log(`${label}: ${parts.map((n, k) => `${n}=${(st[k]!.hf / Math.max(st[k]!.n, 1)).toExponential(1)}`).join('  ')}`);
}
run('默认400/12  ', {});
run('150/40      ', { archStiffness: 150, archDamping: 40 });
run('200/40      ', { archStiffness: 200, archDamping: 40 });
run('250/60      ', { archStiffness: 250, archDamping: 60 });
