import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { observe as obs, modeOf } from '../src/core/servo/unified';
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
  return b ? (b.act + b.servo + b.damp) : 0;
};
const pairC = (n: string, ax: number): number => {
  const di = body.dofByName(n, ax);
  return di >= 0 ? (ctl.warner.drive.pairC[di] ?? 0) : -1;
};
console.log('t | tiltRel | 模式 | side | hipR0矩 | sp1矩 | footR0矩 | pairC(sp1/sp2/sp3)');
for (let s = 0; s < Math.round(4.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.9 && s % 12 === 0) {
    const U = obs((ctl as any).ctx ?? { bal: ctl.warner, body, sensors: ctl.sensors }, 'r');
    const tilt = U.tiltRelDeg;
    const mode = modeOf(U, false);
    const side = ctl.warner.drive.legReflex.side ?? '-';
    console.log(`${t.toFixed(2)} | ${(tilt ?? 0).toFixed(1)} | ${mode} | ${side} | ${tq('hip_r', 0).toFixed(0)} | ${tq('spine1', 0).toFixed(0)} | ${tq('foot_r', 0).toFixed(0)} | ${pairC('spine1', 0).toFixed(2)}/${pairC('spine2', 0).toFixed(2)}/${pairC('spine3', 0).toFixed(2)}`);
  }
}
