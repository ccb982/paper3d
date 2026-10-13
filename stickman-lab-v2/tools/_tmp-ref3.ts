import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const dr = ctl.warner.drive as any;
console.log('t | hipR0实 | pairRef | 偏差dev | lock属性 | posHipNow | pairC');
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) {
    const dh = body.dofByName('hip_r', 0);
    const a = (body.dofs[dh]?.angle ?? 0) * 57.3;
    const ref = (dr.pairRef[dh] ?? 0) * 57.3;
    const posHip = ((ctl as any).lean?.postureHipNow ?? 0) * 57.3;
    console.log(`${t.toFixed(2)} | ${a.toFixed(0).padStart(5)} | ${ref.toFixed(1).padStart(6)} | ${(a-ref).toFixed(1).padStart(5)} | ${(ref - posHip).toFixed(1).padStart(6)} | ${posHip.toFixed(1).padStart(5)} | ${(dr.pairC[dh]??0).toFixed(2)}`);
  }
}
