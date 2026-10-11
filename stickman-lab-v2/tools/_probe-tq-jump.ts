/** _probe-tq-jump: frame-by-frame torque mutation finder (support leg + swing, net per frame).
 *  Prints |d(net)/frame| large jumps with the channel breakdown of that frame.
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');

const body = w.body;
const names: Array<[string, number]> = [['foot_r', 0], ['foot_r', 2], ['knee_r', 2], ['hip_r', 0], ['hip_r', 2], ['spine1', 0], ['spine1', 2]];
const kdOf = (d: number) => (w.drive as unknown as { kd: Float64Array }).kd[d]!;
const kpOf = (d: number) => (w.drive as unknown as { kp: Float64Array }).kp[d]!;
const prev = new Map<string, number>();
const net = (d: number) => { const b = w.drive.lastBreakdown[d]!; return b.stiff + b.itb + b.lum + b.act + b.servo + b.ff + b.damp; };
console.log('t      关节     净τ     Δτ(帧)  通道[stiff|servo|ff|damp]');
for (let s = 0; s < Math.round(9.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.5 || t > 7.5) continue;
  for (const [n, ax] of names) {
    const d = body.dofByName(n, ax);
    if (d < 0) continue;
    const cur = net(d);
    const key = `${n}/${ax}`;
    const pv = prev.get(key) ?? cur;
    const dj = cur - pv;
    prev.set(key, cur);
    if (Math.abs(dj) > 12) {
      const b = w.drive.lastBreakdown[d]!;
      const dtmp = body.dofs[d]!;
      console.log(`${t.toFixed(3)} ${key.padEnd(9)} ${cur.toFixed(0).padStart(6)} ${dj.toFixed(0).padStart(7)}  [st${b.stiff.toFixed(0)}|sv${b.servo.toFixed(0)}|ff${b.ff.toFixed(0)}|dp${b.damp.toFixed(0)}] kp=${kpOf(d).toFixed(0)} kd=${Number.isNaN(kdOf(d)) ? 'NaN' : kdOf(d).toFixed(1)} ω=${dtmp.vel.toFixed(1)} θ=${dtmp.angle.toFixed(3)}`);
    }
  }
}
