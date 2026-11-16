/** _tmp-shake.ts —— 上身抖动度量（单腿保持窗 liftDone+0.2~+1.2s）
 *  输出：躯干世界角速度 RMS/峰值、各脊柱自由度角速度 RMS、CoM 速度 RMS
 *  用法：node tools/run.mjs _tmp-shake [nopairdamp|noexdamp]
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { observe as obs } from '../src/core/servo/unified';
import { isLiftDone } from '../src/core/servo/supportReg';

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const MODE = ARGS[0] ?? 'base';
if (MODE === 'nopairdamp') (globalThis as unknown as { __PAIRDAMP0?: boolean }).__PAIRDAMP0 = true;

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body;
const watch: Array<[string, number, number]> = [];
for (const sn of ['spine1', 'spine2', 'spine3']) for (const ax of [0, 2]) { const i = body.dofByName(sn, ax); if (i >= 0) watch.push([sn, ax, i]); }

let tLift = -1, n = 0, peakTorso = 0, peakRoll = 0;
const acc = new Map<number, number>();
let tSq = 0, comSq = 0;
let prevRollV = 0, zc = 0;
let inBox = 0, firstBreach = -1;
for (let s = 0; s < Math.round(6.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  const U = obs({ bal: ctl.warner, body: w.body, sensors: ctl.sensors } as unknown as never, 'r');
  const ok = Math.abs(U.pitchRelDeg) <= 20 && Math.abs(U.tiltRelDeg) <= 10;
  if (tLift < 0) { if (isLiftDone()) tLift = t; else continue; }
  if (ok) inBox += w.dt; else if (firstBreach < 0) firstBreach = t;
  const dtL = t - tLift;
  if (dtL < 0.2 || dtL > 1.2) continue;
  const tv = ctl.sensors.torsoAngVel;
  const tv0 = tv[0]!, tv1 = tv[1]!, tv2 = tv[2]!;
  tSq += tv0 * tv0 + tv1 * tv1 + tv2 * tv2;
  const mag = Math.hypot(tv0, tv1, tv2);
  if (mag > peakTorso) peakTorso = mag;
  if (Math.abs(tv2) > peakRoll) peakRoll = Math.abs(tv2);
  if (prevRollV !== 0 && Math.sign(tv2) !== Math.sign(prevRollV)) zc++;
  prevRollV = tv2;
  comSq += ctl.sensors.comVel[0]! ** 2 + ctl.sensors.comVel[2]! ** 2;
  for (const [, , i] of watch) { const v = body.dofs[i]!.vel; acc.set(i, (acc.get(i) ?? 0) + v * v); }
  n++;
}
const S = (x: number): string => Math.sqrt(x / Math.max(1, n)).toFixed(3);
console.log(`模式=${MODE} LP_TAU=${process.env.PAIR_LP_TAU ?? 'def'} CAP_K=${process.env.PAIR_CAP ?? 'def'} 窗=${n}帧`);
console.log(`【框内=${inBox.toFixed(2)}s 首次破=${firstBreach > 0 ? (firstBreach - tLift).toFixed(2) : 'never'}】`);
console.log(`躯干角速度 RMS(总)=${S(tSq)} rad/s  峰值=${peakTorso.toFixed(2)}  roll分量峰值=${peakRoll.toFixed(2)}`);
console.log(`CoM 水平速度 RMS=${S(comSq)} m/s`);
console.log(`躯干roll速度过零=${zc}次/1s窗 → 主频≈${(zc / 2).toFixed(0)}Hz`);
for (const [sn, ax, i] of watch) {
  const rms = Math.sqrt((acc.get(i) ?? 0) / Math.max(1, n));
  console.log(`  ${sn}/${ax}: vel RMS=${rms.toFixed(3)} rad/s (${(rms * 57.3).toFixed(0)}°/s)`);
}
