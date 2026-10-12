import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { balanceScale } from '../src/core/servo/supportReg';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const shim = () => ({ bal: (ctl as any).warner, body: w.body, sensors: ctl.sensors }) as any;
console.log('t 相 | comZ vZ(cm/s) copZ | XcoM MoS内 MoS外 可救 | Lx eOrb | 摆脚z fz撑/摆');
for (let s = 0; s < Math.round(4.7 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.6 || t > 4.65) continue;
  if (Math.abs(t * 120 - Math.round(t * 120)) > 1e-6) continue;
  const bs = balanceScale(shim(), 'r');
  const f = (v: number, n = 1): string => (Number.isFinite(v) ? v.toFixed(n) : '--').padStart(6 + (n > 1 ? 0 : 0));
  console.log(`${t.toFixed(3)} ${(ctl.actions.status.phase ?? '?').slice(0, 1)} | ${(ctl.sensors.com[2]! * 100).toFixed(1).padStart(6)} ${(ctl.sensors.comVel[2]! * 100).toFixed(1).padStart(6)} ${(bs.copZ * 100).toFixed(1).padStart(6)} | ${(bs.mosMed * 1000).toFixed(0).padStart(5)} ${(bs.mosLat * 1000).toFixed(0).padStart(5)} ${bs.recoverable ? '可救' : '不可'} | ${(bs.mosPredMed * 1000).toFixed(0).padStart(5)} ${(bs.mosPredLat * 1000).toFixed(0).padStart(5)} ${bs.recoverablePred ? '可救' : '不可'} | ${f(bs.Lx, 1)} ${f(bs.eOrb, 3)} | ${(ctl.sensors.feet[0]!.z * 100).toFixed(1).padStart(6)} ${ctl.sensors.feet[1]!.fz.toFixed(0).padStart(4)}/${ctl.sensors.feet[0]!.fz.toFixed(0).padStart(4)}`);
}
