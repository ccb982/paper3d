/** _perf4.ts —— 分项计时：updateDofState / world.step / executor */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World({ physicsHz: 480 });
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
for (let i = 0; i < 960; i++) w.advance(1);

function t(label: string, fn: () => void, n = 1920): void {
  const a = performance.now();
  for (let i = 0; i < n; i++) fn();
  console.log(`${label}: ${((performance.now() - a) / n).toFixed(3)} ms/次`);
}
t('updateDofState      ', () => w.body.updateDofState());
t('executor begin+apply', () => { w.executor.beginStep(); w.executor.applyAll(1 / 480); });
t('world.step (裸物理) ', () => w.world.step());
const c = ctl;
t('controller.step     ', () => c.step(1 / 480));
t('full advance        ', () => w.advance(1));
