import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const F = (b: any, k: string): string => (b && b[k] ? (b[k] as number).toFixed(0).padStart(4) : '   0');
const line = (n: string, ax: number): string => {
  const di = body.dofByName(n, ax);
  if (di < 0) return 'n/a';
  const b = ctl.warner.drive.lastBreakdown[di] as any;
  if (!b) return '---';
  const tot = (b.stiff||0)+(b.itb||0)+(b.lum||0)+(b.act||0)+(b.servo||0)+(b.ff||0)+(b.damp||0);
  return tot.toFixed(0).padStart(5) + '[i' + F(b,'itb') + ' lu' + F(b,'lum') + ' a' + F(b,'act') + ' s' + F(b,'servo') + ' d' + F(b,'damp') + ']';
};
console.log('t | hipR/0 | hipL/0 | spine1/0 | footR/0 | side');
for (let s = 0; s < Math.round(3.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.35 && s % 6 === 0) {
    console.log(`${t.toFixed(2)} | ${line('hip_r',0)} | ${line('hip_l',0)} | ${line('spine1',0)} | ${line('foot_r',0)} | ${ctl.warner.drive.legReflex.side ?? '-'}`);
  }
}
