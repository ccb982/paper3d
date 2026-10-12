import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
console.log('t      comX    CoPx    CoP-com  方向 | comZ    CoPz    CoPz-com  方向');
for (let s = 0; s < Math.round(4.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.0 || t > 4.2) continue;
  if (Math.abs(t * 5 - Math.round(t * 5)) > 1e-6) continue;
  const f = ctl.sensors.feet[1]!;
  const dx = f.copX - ctl.sensors.com[0]!;
  const dz = f.copZ - ctl.sensors.com[2]!;
  const dir = (v: number) => v > 0.01 ? '后推-✓' : v < -0.01 ? '前推-✗' : '  零  ';
  const dirZ = (v: number) => v > 0.01 ? '右推-?' : v < -0.01 ? '左推-?' : '  零  ';
  console.log(`${t.toFixed(1)} ${ctl.sensors.com[0]!.toFixed(3)} ${f.copX.toFixed(3)} ${dx.toFixed(3).padStart(6)} ${dir(dx)} | ${ctl.sensors.com[2]!.toFixed(3)} ${f.copZ.toFixed(3)} ${dz.toFixed(3).padStart(6)} ${dirZ(dz)}`);
}
