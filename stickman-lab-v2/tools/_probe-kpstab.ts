/** _probe-kpstab.ts —— 显式弹簧稳定性判据：kp·dt²/I 全关节扫描 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
const dt = w.dt;
console.log('自由度        I(有效)   I_low    posture_kp  kp·dt²/I  (稳定需<4)');
for (const d of w.body.dofs) {
  if (d.engineMotor) continue;
  const lim = Math.max(Math.abs(d.min), Math.abs(d.max), 0.3);
  const postureKp = 8 * 0.5 * d.tauMax / lim;
  const ratio = postureKp * dt * dt / Math.max(d.inertia, 1e-9);
  const flag = ratio > 4 ? '  ★不稳' : ratio > 1 ? '  (边缘)' : '';
  if (ratio > 1 || ['knee_l', 'knee_r', 'hip_l', 'hip_r', 'foot_l', 'foot_r', 'spine2'].includes(d.name)) {
    console.log(`${d.name}/${d.axis}  I=${d.inertia.toExponential(1)}  Il=${d.inertiaLow.toExponential(1)}  kp=${postureKp.toFixed(0)}  ratio=${ratio.toFixed(2)}${flag}`);
  }
}
