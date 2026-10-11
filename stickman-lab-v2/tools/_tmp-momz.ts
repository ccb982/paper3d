import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const rev = new Map<number, string>();
for (const [k, i] of (w.body as any).indexByKey as Map<string, number>) rev.set(i, k);
const parts = ['thigh_l', 'shin_l', 'foot_l', 'thigh_r', 'shin_r', 'foot_r', ' pelvis', 'pelvis', 'spine1', 'spine2', 'spine3'];
console.log('侧向动量 p_z = Σm·vz（kg·m/s）按部位拆：');
for (let s = 0; s < Math.round(4.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.2 || t > 4.5) continue;
  if (Math.round(t * 10) % 2 !== 0) continue;
  let tot = 0, legL = 0, legR = 0, trunk = 0, rest = 0;
  let zLegL = 0, zLegR = 0;
  const mTmp = { l: 0, r: 0 };
  for (let i = 0; i < (w.body as any).bodies.length; i++) {
    const b = (w.body as any).bodies[i];
    const key = rev.get(i) ?? `#${i}`;
    const vz = b.linvel().z, m = b.mass();
    const p = m * vz;
    tot += p;
    if (/^(thigh|shin|foot)_l$/.test(key) || /_l$/.test(key) && /thigh|shin|foot/.test(key)) { legL += p; zLegL += m * b.worldCom().z; mTmp.l += m; }
    else if (/^(thigh|shin|foot)_r$/.test(key) || /_r$/.test(key) && /thigh|shin|foot/.test(key)) { legR += p; zLegR += m * b.worldCom().z; mTmp.r += m; }
    else if (/spine|pelvis|chest|head|neck/.test(key)) trunk += p;
    else rest += p;
  }
  console.log(`${t.toFixed(1)} 总p=${tot.toFixed(1)}  L腿=${legL.toFixed(1)}(z=${(zLegL / mTmp.l).toFixed(2)})  R腿=${legR.toFixed(1)}(z=${(zLegR / mTmp.r).toFixed(2)})  躯干=${trunk.toFixed(1)}  臂=${rest.toFixed(1)}`);
}
