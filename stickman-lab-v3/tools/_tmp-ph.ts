import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
console.log('t | phase | runnerPhase');
for (let s = 0; s < Math.round(4.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.0 && s % 96 === 0) {
    const st = (ctl as any).actions?.status;
    console.log(`${t.toFixed(2)} | ${st?.phase ?? '?'} | ${(ctl as any).actions?.runner?.current?.name ?? (ctl as any).actions?.runner?.phases ?? '?'}`);
  }
}
