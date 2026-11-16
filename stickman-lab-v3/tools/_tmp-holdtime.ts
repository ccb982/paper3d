import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
let lastPh = '';
let phStart = 0;
const marks: string[] = [];
for (let s = 0; s < Math.round(10 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  const ph = ctl.actions.status.phase ?? '?';
  if (ph !== lastPh) {
    if (lastPh) marks.push(`${lastPh}:${(t - phStart).toFixed(2)}s`);
    lastPh = ph; phStart = t;
  }
}
console.log('相位时长： ' + marks.join(' | '));
