import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { observe as obs } from '../src/core/servo/unified';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const ang = (n: string, ax: number): number => {
  const di = body.dofByName(n, ax);
  return di >= 0 ? (body.dofs[di]?.angle ?? 0) * 57.3 : NaN;
};
console.log('=== 关节实读 (支撑腿+腰) ===');
console.log('t | ankleR0 | kneeR0 | hipR0 | hipR1 | hipR2 | spine1/0 | spine2/0 | spine3/0');
for (let s = 0; s < Math.round(3.8 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.6 && s % 48 === 0) {
    console.log(`${t.toFixed(2)} | ${ang('foot_r',0).toFixed(0).padStart(5)} | ${ang('knee_r',0).toFixed(0).padStart(4)} | ${ang('hip_r',0).toFixed(0).padStart(5)} | ${ang('hip_r',1).toFixed(0).padStart(4)} | ${ang('hip_r',2).toFixed(0).padStart(4)} | ${ang('spine1',0).toFixed(1).padStart(5)} | ${ang('spine2',0).toFixed(1).padStart(5)} | ${ang('spine3',0).toFixed(1).padStart(5)}`);
  }
}
console.log('=== 力链: 自下向上各节 dZ(cm)/tau · tau/τmax% ===');
for (let s = 0; s < Math.round(3.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.6 && s % 96 === 0) {
    const U = obs({ bal: ctl.warner, body, sensors: ctl.sensors } as any, 'r');
    const rows = U.chain.map((c: any) => {
      const di = body.dofByName(c.name, 0);
      const d = di >= 0 ? body.dofs[di] : null;
      const tm = d ? d.tauMax : 1;
      const b = di >= 0 ? ctl.warner.drive.lastBreakdown[di] as any : null;
      const tot = b ? (b.stiff||0)+(b.act||0)+(b.servo||0)+(b.ff||0)+(b.damp||0)+(b.itb||0)+(b.lum||0) : 0;
      return c.name + ' d' + (c.dZ*100).toFixed(0) + ' τ' + tot.toFixed(0) + '/' + tm.toFixed(0);
    });
    console.log(t.toFixed(2), '|', rows.join('  '));
  }
}
