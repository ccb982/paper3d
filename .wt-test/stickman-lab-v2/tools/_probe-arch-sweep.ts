/** _probe-arch-sweep.ts —— 蹬地：arch 引擎 刚度/阻尼 扫描（arch 体 HF + 脚 7Hz 幅） */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

function run(label: string, body: object): void {
  const w = new World({ body: body as never });
  const ctl = new ControlModule(w, { postureTone: 8 });
  w.controller = ctl;
  w.reset();
  ctl.actions.play('pushRise');
  const ai = w.body.indexByKey.get('arch_l')!;
  const mi = w.body.indexByKey.get('mfoot_l')!;
  const foot = w.body.dofByName('foot_l', 2);
  const state = [0, 0, 0, 0];
  const series: number[][] = [[], []];
  for (let s = 0; s < Math.round(2.6 / w.dt); s++) {
    w.advance(1);
    const t = s * w.dt;
    if (t < 1.2 || t >= 2.6) { state[0] = 0; state[1] = 0; continue; }
    const aa = w.body.bodies[ai]!.angvel();
    const ma = w.body.bodies[mi]!.angvel();
    const aA = Math.hypot(aa.x, aa.y, aa.z), aM = Math.hypot(ma.x, ma.y, ma.z);
    state[2] += (aA - 2 * state[1] + state[0]) ** 2; state[3]++;
    state[0] = state[1]; state[1] = aA;
    series[0]!.push(w.body.dofs[foot]!.vel);
    series[1]!.push(aM);
  }
  const ampAt = (a: number[], f: number) => {
    let re = 0, im = 0;
    for (let k = 0; k < a.length; k++) { const om = 2 * Math.PI * f * k * w.dt; re += a[k]! * Math.cos(om); im -= a[k]! * Math.sin(om); }
    return Math.hypot(re, im) / a.length;
  };
  const hfOf = (a: number[]) => { let j = 0; for (let k = 2; k < a.length; k++) j += (a[k]! - 2 * a[k - 1]! + a[k - 2]!) ** 2; return j / a.length; };
  // 找脚的主频
  let bf = 0, ba = 0;
  for (let f = 4; f <= 30; f++) { const a = ampAt(series[0]!, f); if (a > ba) { ba = a; bf = f; } }
  console.log(`${label}: archHF=${(state[2] / Math.max(state[3], 1)).toExponential(1)}  soleHF=${hfOf(series[1]!).toExponential(1)}  脚主频=${bf}Hz(幅${ba.toFixed(2)})`);
}
run('180/40        ', { archStiffness: 180, archDamping: 40 });
run('200/40        ', { archStiffness: 200, archDamping: 40 });
run('220/40        ', { archStiffness: 220, archDamping: 40 });
run('200/30        ', { archStiffness: 200, archDamping: 30 });
run('200/60        ', { archStiffness: 200, archDamping: 60 });
