/** _probe-foot-force: 脚尖/脚掌接触位置与脚矢状力矩 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

process.env.SQC_BASE_ONLY = '1';
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
const p = (k: string): { x: number; y: number; z: number } => {
  const i = w.body.indexByKey.get(k); if (i === undefined) return { x: NaN, y: NaN, z: NaN };
  const t = w.body.bodies[i]!.translation(); return { x: t.x, y: t.y, z: t.z };
};
const cop = new Float64Array(3);
let last = -1;
console.log('t     comX   |  side  fz   copX   footX  archX  mfootX  foot2  app   base');
for (let s = 0; s < Math.round(2.3 / w.dt); s++) {
  const t = s * w.dt;
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  if (!court.released || t - last < 0.05) continue;
  last = t;
  const buf = (ctl.warner as unknown as { squatBaseBuf(): Float64Array | null }).squatBaseBuf();
  const comX = ctl.sensors.com[0]!;
  for (const sd of ['l', 'r'] as const) {
    const ok = w.body.footCoP(sd, w.dt, cop);
    const fz = w.body.footNormalForce(sd, w.dt);
    const f = p(`foot_${sd}`), a = p(`arch_${sd}`), m = p(`mfoot_${sd}`);
    const fi = w.body.dofByName(`foot_${sd}`, 2);
    const d = fi >= 0 ? w.body.dofs[fi]! : null;
    const l = fi >= 0 ? w.executor.ledger[fi]! : null;
    console.log(`${(court.t - court.settle).toFixed(2).padStart(4)} ${(comX * 100).toFixed(1).padStart(5)} | ${sd}  ${fz.toFixed(0).padStart(4)} ${ok ? (cop[0]! * 100).toFixed(1).padStart(6) : '  --  '} ${(f.x * 100).toFixed(1).padStart(6)} ${(a.x * 100).toFixed(1).padStart(6)} ${(m.x * 100).toFixed(1).padStart(6)} ${d ? (d.angle * 57.3).toFixed(1).padStart(5) : '-'} ${l ? l.applied.toFixed(0).padStart(4) : '-'} ${buf && fi >= 0 ? buf[fi]!.toFixed(0).padStart(5) : '-'}`);
  }
  if (court.fall >= 0) { console.log(`fall=${(court.fall - court.settle).toFixed(2)}`); break; }
}
