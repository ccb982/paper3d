import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
import { captureShankLeg } from '../src/core/servo/shankIK';
import { measureActualForceChain } from '../src/core/servo/actualForceChain';
import { measureJointLoads } from '../src/core/servo/fullInverseDynamics';

(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
w.controller = ctl;
w.reset();
ctl.actions.idleEnabled = false;
ctl.manual.clear();
squatResetLimits(w);
const court = squatCourtSetup(w, ctl, 2.0);

const f3 = (v: { x: number; y: number; z: number }): string => `(${v.x.toFixed(0)},${v.y.toFixed(0)},${v.z.toFixed(0)})`;
const n3 = (v: { x: number; y: number; z: number }): number => Math.hypot(v.x, v.y, v.z);

for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  supportClean(ctx, 'r');
  supportClean(ctx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  if (court.t < 1.99) continue;
  if (Math.abs(court.t * 10 - Math.round(court.t * 10)) > 1e-6) continue;
  const jl = measureJointLoads(w);
  for (const side of ['l', 'r'] as const) {
    const leg = captureShankLeg(w, side);
    const ac = measureActualForceChain(w, side, leg.hip, leg.knee, leg.ankle);
    const knee = jl.find((j) => j.name === `knee_${side}`)!;
    const hip = jl.find((j) => j.name === `hip_${side}`)!;
    const ankle = jl.find((j) => j.name === `foot_${side}`)!;
    const un = { x: knee.anchor.x - ankle.anchor.x, y: knee.anchor.y - ankle.anchor.y };
    const unn = Math.hypot(un.x, un.y) || 1;
    const oldPar = ac.F.x * (un.x / unn) + ac.F.y * (un.y / unn);
    const oldPerp = Math.hypot(ac.F.x - oldPar * (un.x / unn), ac.F.y - oldPar * (un.y / unn), ac.F.z);
    console.log(
      `t=${court.t.toFixed(2)} ${side} contactF=${f3(ac.F)} |F|=${n3(ac.F).toFixed(0)} ` +
      `kneeF=${f3(knee.force)} raw=${f3(knee.rawForce)} |kneeF|=${n3(knee.force).toFixed(0)} ` +
      `chain par=${ac.chain.parallel.toFixed(0)} perp=${ac.chain.perp.toFixed(0)} ratio=${(ac.chain.perp / Math.max(1, ac.chain.parallel)).toFixed(2)} ` +
      `old par=${oldPar.toFixed(0)} perp=${oldPerp.toFixed(0)} ` +
      `tau K=${knee.torque.toFixed(0)}/${knee.rawTorque.toFixed(0)} H=${hip.torque.toFixed(0)}/${hip.rawTorque.toFixed(0)} A=${ankle.torque.toFixed(0)}/${ankle.rawTorque.toFixed(0)} ` +
      `tauUtil=${ac.tauUtil.toFixed(2)} contact=${ac.contact} copIn=${ac.copInside}`,
    );
  }
  if (court.fall >= 0) { console.log('FALL', court.fall.toFixed(3), court.reason); break; }
}
