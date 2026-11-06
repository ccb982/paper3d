import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

type Snapshot = { tilt: number; hipY: number; comZ: number; fzL: number; fzR: number };

function run(bias: { name: string; axis: number; tau: number } | null): Snapshot | null {
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
  w.controller = ctl;
  w.reset();
  ctl.actions.idleEnabled = false;
  ctl.manual.clear();
  squatResetLimits(w);
  const court = squatCourtSetup(w, ctl, 2.0);
  const di = bias ? w.body.dofByName(bias.name, bias.axis) : -1;
  let snap: Snapshot | null = null;
  for (let s = 0; s < Math.round(3.35 / w.dt); s++) {
    supportClean(ctx, 'r');
    supportClean(ctx, 'l');
    const t = w.clock;
    w.advance(1, () => {
      if (bias && di >= 0 && t >= 3.0 && t < 3.01) w.executor.addTorque(di, bias.tau);
    });
    squatFrame(w, ctl, court);
    if (t >= 3.02 && !snap) {
      const ki = w.body.dofByName('knee_l', 2);
      const ai = w.body.dofByName('foot_l', 2);
      const hi = w.body.dofByName('hip_l', 2);
      if (ki >= 0 && ai >= 0 && hi >= 0) {
        const kA = w.body.dofs[ki]!.anchorWorld;
        const aA = w.body.dofs[ai]!.anchorWorld;
        const tilt = Math.atan2(kA[2]! - aA[2]!, Math.max(1e-4, kA[1]! - aA[1]!)) * 57.29578;
        snap = {
          tilt,
          hipY: w.body.dofs[hi]!.anchorWorld[1]!,
          comZ: ctl.sensors.com[2]!,
          fzL: ctl.sensors.feet[0]!.fz,
          fzR: ctl.sensors.feet[1]!.fz,
        };
      }
    }
    if (court.fall >= 0) break;
  }
  return snap;
}

const base = run(null);
console.log(`BASE tilt=${base?.tilt.toFixed(2)} hipY=${base?.hipY.toFixed(3)} comZ=${base?.comZ.toFixed(3)} fz=${base?.fzL.toFixed(0)}/${base?.fzR.toFixed(0)}`);
const tests: Array<{ name: string; axis: number; tau: number }> = [
  { name: 'hip_l', axis: 0, tau: 1 },
  { name: 'hip_l', axis: 1, tau: 1 },
  { name: 'hip_l', axis: 2, tau: 1 },
  { name: 'knee_l', axis: 0, tau: 1 },
  { name: 'knee_l', axis: 2, tau: 1 },
  { name: 'foot_l', axis: 0, tau: 0.5 },
  { name: 'foot_l', axis: 2, tau: 0.5 },
];
for (const t of tests) {
  const s = run(t);
  if (!s || !base) continue;
  console.log(`${t.name}/${t.axis} tau=+${t.tau}: dTilt=${(s.tilt - base.tilt).toFixed(2)} dHipY=${((s.hipY - base.hipY) * 1000).toFixed(1)}mm dComZ=${((s.comZ - base.comZ) * 1000).toFixed(1)}mm fz=${s.fzL.toFixed(0)}/${s.fzR.toFixed(0)}`);
}
