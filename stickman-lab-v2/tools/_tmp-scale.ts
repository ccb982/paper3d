import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { balanceScale } from '../src/core/servo/supportReg';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
console.log('t 相 | 支撑fz(N) %W | CoPz(cm) 天平tilt(cm) | 内缘余量 外缘余量 | 摆脚fz');
for (let s = 0; s < Math.round(4.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 2.3 || t > 4.3) continue;
  if (Math.abs(t * 20 - Math.round(t * 20)) > 1e-6) continue;
  const b = balanceScale({ bal: (ctl as any).warner, body: w.body, sensors: ctl.sensors } as any, 'r');
  const fl = ctl.sensors.feet[0]!.fz;
  const cm = (v: number): string => (Number.isFinite(v) ? (v * 100).toFixed(1) : ' -- ').padStart(6);
  console.log(`${t.toFixed(2)} ${(ctl.actions.status.phase ?? '?').slice(0, 1)} | ${b.fz.toFixed(0).padStart(5)} ${(b.wFrac * 100).toFixed(0).padStart(4)}% | ${(b.copZ * 100).toFixed(1).padStart(6)} ${cm(b.tilt)} | ${cm(b.marginMed)} ${cm(b.marginLat)} | ${fl.toFixed(0).padStart(4)}`);
}
