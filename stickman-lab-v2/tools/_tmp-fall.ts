import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { observe as obs } from '../src/core/servo/unified';
import { balanceScale } from '../src/core/servo/supportReg';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const tq = (n: string, ax: number): number => {
  const di = body.dofByName(n, ax);
  if (di < 0) return 0;
  const b = ctl.warner.drive.lastBreakdown[di] as any;
  return b ? ((b.stiff||0)+(b.act||0)+(b.servo||0)+(b.ff||0)+(b.damp||0)+(b.itb||0)+(b.lum||0)) : 0;
};
console.log('t | tiltRel | CoMz | 余量cm | 髇pair矩 | 踝fused矩 | M2 | 链(最弯 dZcm)');
for (let s = 0; s < Math.round(4.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) {
    const U = obs({ bal: ctl.warner, body, sensors: ctl.sensors } as any, 'r');
    const bs = balanceScale({ bal: ctl.warner, body, sensors: ctl.sensors } as any, 'r');
    const hc = U.chain.reduce((a: any, c: any) => Math.abs(c.dZ) > Math.abs(a.dZ) ? c : a, { name: '-', dZ: 0 });
    const margin = Math.min(bs.marginMed ?? 0, bs.marginLat ?? 0);
    console.log(`${t.toFixed(2)} | ${U.tiltRelDeg.toFixed(1).padStart(5)} | ${(ctl.sensors.com[2]!*100).toFixed(1).padStart(6)} | ${(margin*100).toFixed(1).padStart(5)} | ${tq('hip_r',0).toFixed(0).padStart(6)} | ${tq('foot_r',0).toFixed(0).padStart(5)} | ${ctl.warner.drive.legReflex.pelvisDamp.toFixed(0).padStart(4)} | ${hc.name}${(hc.dZ*100).toFixed(1)}`);
  }
}
