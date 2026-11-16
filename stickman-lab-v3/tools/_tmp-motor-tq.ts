/** _tmp-motor-tq.ts —— 踝内外翻电机力矩回读（§2.606b）：θ/目标/τ_est vs 邻轴与盆骨
 *  用法：node tools/run.mjs _tmp-motor-tq [t0=2.3] [t1=3.3]
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { isLiftDone } from '../src/core/servo/supportReg';

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const T0 = Number(ARGS[0] ?? 2.3), T1 = Number(ARGS[1] ?? 3.3);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body;
const i0 = body.dofByName('foot_r', 0);
const tau = (n: string, ax: number): number => { const i = body.dofByName(n, ax); return i >= 0 ? w.executor.ledger[i]!.applied : 0; };
const D = (r: number): number => (r * 180) / Math.PI;

let tLift = -1;
console.log('t      | 踝0 θ° 目标° τest(电机) | 踝0 θvel | 踝2τ | hip0τ | 盆roll° | fz  CoPz');
for (let s = 0; s < Math.round(6.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (tLift < 0) { if (isLiftDone()) tLift = t; else continue; }
  if (t < T0 || t > T1) continue;
  if (s % Math.round(0.05 / w.dt) !== 0) continue;
  const d0 = body.dofs[i0]!;
  const q = body.bodies[body.indexByKey.get('torso')!]!.rotation();
  const roll = Math.atan2(2 * (q.y * q.z + q.w * q.x), 1 - 2 * (q.x * q.x + q.y * q.y)) * D(1);
  const f = ctl.sensors.feet[1]!;
  console.log(
    `${t.toFixed(2)} | ${D(d0.angle).toFixed(1).padStart(6)} ${D(d0.motorTgt ?? NaN).toFixed(1).padStart(6)} ${(d0.motorTqEst ?? NaN).toFixed(0).padStart(8)} | ${d0.vel.toFixed(2).padStart(6)} | ${tau('foot_r', 2).toFixed(0).padStart(5)} | ${tau('hip_r', 0).toFixed(0).padStart(6)} | ${roll.toFixed(1).padStart(6)} | ${f.fz.toFixed(0).padStart(4)} ${(f.copValid ? f.copZ : NaN).toFixed(2)}`,
  );
}
