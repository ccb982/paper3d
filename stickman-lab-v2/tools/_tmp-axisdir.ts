import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const axOf = (n: string, ax: number): Float64Array | null => {
  const i = w.body.dofByName(n, ax);
  if (i < 0) return null;
  return w.body.dofs[i]!.axisWorld;
};
console.log('轴世界方向 (x=前 y=上 z=侧) | 理想: 髋屈/膝/踝的轴≈横向(0,0,±1)的旋转轴；y分量应≈0');
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 2.4 || t > 3.0) continue;
  if (Math.abs(t * 10 - Math.round(t * 10)) > 1e-6) continue;
  const fmt = (n: string, ax: number): string => {
    const a = axOf(n, ax);
    if (!a) return '   n/a   ';
    return `${a[0]!.toFixed(2).padStart(5)} ${a[1]!.toFixed(2).padStart(5)} ${a[2]!.toFixed(2).padStart(5)}`;
  };
  console.log(`${t.toFixed(1)} | 摆髋L/2: ${fmt('hip_l', 2)} | 摆膝L/2: ${fmt('knee_l', 2)} | 摆踝L/2: ${fmt('foot_l', 2)} | 摆髋L/0: ${fmt('hip_l', 0)}`);
}
