/** _probe-hipnoise —— 静息段 hip/0 位置的**数值微分噪声**有多大？（决定 hipDamp 的力是否全是噪声）
 *  用法：node tools/run.mjs _probe-hipnoise
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, type CourtState } from '../src/core/court';
import { squatFrame } from '../src/core/servo/squat';

const w = new World();
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
w.controller = ctl;
w.driveEnabled = true;
w.reset();
const court = squatCourtSetup(w, ctl, 2.0) as CourtState | null;
const body = w.body;
const hi = ['l', 'r'].map((s) => body.dofByName(`hip_${s}`, 0));
let prev = [NaN, NaN];
const buf: number[][] = [[], []];
const win: number[][] = [[], []];
for (let s = 0; s < Math.round(5 / w.dt); s++) {
  w.advance(1);
  if (court) squatFrame(w, ctl, court);
  if (!court || !court.released) continue;
  const t = court.t;
  for (let k = 0; k < 2; k++) {
    const di = hi[k]!;
    if (di < 0) continue;
    const hz = body.dofs[di]!.anchorWorld[2]!;
    if (Number.isFinite(prev[k]!)) {
      const vz = (hz - prev[k]!) / w.dt;
      buf[k]!.push(vz);
      if (t >= 2.5 && t <= 3.0) win[k]!.push(vz);
    }
    prev[k] = hz;
  }
}
const stat = (a: number[]): string => {
  if (!a.length) return 'n/a';
  const rms = Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
  const pk = Math.max(...a.map(Math.abs));
  const mean = a.reduce((s, v) => s + v, 0) / a.length;
  return `n=${a.length} mean=${(mean * 1000).toFixed(2)}mm/s rms=${(rms * 1000).toFixed(2)}mm/s peak=${(pk * 1000).toFixed(1)}mm/s ⇒ hipDamp·rms=${(1000 * rms).toFixed(2)}N·m peak=${(1000 * pk).toFixed(1)}N·m`;
};
console.log('hip_l/0 全程 ', stat(buf[0]!));
console.log('hip_r/0 全程 ', stat(buf[1]!));
console.log('hip_l/0 静息 ', stat(win[0]!));
console.log('hip_r/0 静息 ', stat(win[1]!));
