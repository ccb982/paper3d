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
const A = (n: string, ax: number): number => { const di = body.dofByName(n, ax); return di >= 0 ? (body.dofs[di]?.angle ?? 0) * 57.3 : NaN; };
console.log('=== 腰走势 (三轴全读) ===');
console.log('t | sp1(x/y/z) | sp2(x/y/z) | sp3(x/y/z) | tiltRel');
for (let s = 0; s < Math.round(3.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.5 && s % 24 === 0) {
    const U = obs({ bal: ctl.warner, body, sensors: ctl.sensors } as any, 'r');
    const g = (n: string): string => `${A(n,1).toFixed(0).padStart(3)}/${A(n,0).toFixed(0).padStart(3)}/${A(n,2).toFixed(0).padStart(3)}`;
    console.log(`${t.toFixed(2)} | ${g('spine1')} | ${g('spine2')} | ${g('spine3')} | ${U.tiltRelDeg.toFixed(0).padStart(5)}`);
  }
}
console.log('=== 力链 (腰上各节 d/tauZ/tauX) ===');
for (let s = 0; s < Math.round(3.4 / w.dt); s++) {
  w.advance(0);
  break;
}
