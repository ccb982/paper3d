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
console.log('t | comX(前后) | comZ(侧) | comVx | comVz | pitchRel | tiltRel | hipR2 | hipR0');
for (let s = 0; s < Math.round(3.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) {
    const U = obs({ bal: ctl.warner, body, sensors: ctl.sensors } as any, 'r');
    const A = (n: string, ax: number): number => { const di = body.dofByName(n, ax); return di >= 0 ? (body.dofs[di]?.angle ?? 0) * 57.3 : NaN; };
    console.log(`${t.toFixed(2)} | ${(ctl.sensors.com[0]!*100).toFixed(1).padStart(6)} | ${(ctl.sensors.com[2]!*100).toFixed(1).padStart(6)} | ${(ctl.sensors.comVel[0]!*100).toFixed(0).padStart(4)} | ${(ctl.sensors.comVel[2]!*100).toFixed(0).padStart(4)} | ${U.pitchRelDeg.toFixed(1).padStart(6)} | ${U.tiltRelDeg.toFixed(1).padStart(5)} | ${A('hip_r',2).toFixed(0).padStart(4)} | ${A('hip_r',0).toFixed(0).padStart(4)}`);
  }
}
