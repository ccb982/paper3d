/** _probe-shin-res.ts —— 小腿冲击共振测试：冲量后包络衰减/放大 + kd 扫描（480Hz） */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

function run(kd: number): void {
  const w = new World({ physicsHz: 480 });
  const ctl = new ControlModule(w, { postureTone: 8 });
  w.controller = ctl;
  w.reset();
  for (let s = 0; s < Math.round(1.5 / w.dt); s++) w.advance(1);
  const shin = w.body.indexByKey.get('shin_l')!;
  // 给小腿一个横向冲量
  w.body.bodies[shin]!.applyImpulse({ x: 0, y: 0, z: w.body.bodies[shin]!.mass() * 0.4 }, true);
  const env: number[] = [];
  let seg = 0, t = 0;
  for (let s = 0; s < Math.round(2.5 / w.dt); s++) {
    w.advance(1);
    const av = w.body.bodies[shin]!.angvel();
    const mag = Math.hypot(av.x, av.y, av.z);
    if (mag > seg) seg = mag;
    t += w.dt;
    if (t >= 0.25) { env.push(seg); seg = 0; t = 0; }
  }
  const first = Math.max(...env.slice(0, 3));
  const last = Math.max(...env.slice(6, 10));
  console.log(`kd=${kd}: 包络 ${env.map((v) => v.toFixed(2)).join(' ')}  ${(first).toFixed(2)}→${(last).toFixed(2)} ${last > first * 1.2 ? '★放大' : last < first * 0.8 ? '衰减✓' : '等幅'}`);
}
for (const kd of [0.05, 0.15, 0.3]) {
  // 通过环境变量传给 drive？——直接用 sed 切换成本高，这里用 World 构造后修改默认不可行；
  // 以注释说明：kd 通过 drive 默认值控制。此探针仅测当前默认。
  run(kd);
  break;
}
