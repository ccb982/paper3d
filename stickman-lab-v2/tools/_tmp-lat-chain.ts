/** _tmp-lat-chain.ts —— 侧向力链走线（复现坏局种子：看侧偏漂移时修正力矩是否跟着长）
 *  用法：node tools/run.mjs _tmp-lat-chain [seed=2]
 *  输出：保持期每 0.1s：CoM侧偏/侧速、躯干滚、骨盆滚、髋_l/r侧向角、髋角速度
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { isLiftDone, resetFootLateral } from '../src/core/servo/supportReg';

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const SEED = Number(ARGS[0] ?? 2);
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
(Math as { random: () => number }).random = mulberry32(SEED);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
ctl.actions.idleEnabled = true;
resetFootLateral();
const DEG = 180 / Math.PI;
const tPre = 0.5 + Math.random() * 8;
for (let s = 0; s < Math.round(tPre / w.dt); s++) w.advance(1);
console.log(`seed=${SEED} Tpre=${tPre.toFixed(1)}s 预:侧=${(ctl.sensors.com[2]! * 100).toFixed(1)}cm 滚=${(ctl.sensors.torsoTilt[1]! * DEG).toFixed(1)}°`);
ctl.actions.play('singleLegR');

const body = w.body;
const idx = body.indexByKey;
const pelvisIdx = idx.get('pelvis') ?? -1;
const dHiL = body.dofByName('hip_l', 0), dHiR = body.dofByName('hip_r', 0);
const rollOf = (bi: number): string => {
  if (bi < 0) return '  -  ';
  const q = body.bodies[bi]!.rotation();
  const ux = 2 * (q.x * q.y - q.w * q.z), uy = 1 - 2 * (q.x * q.x + q.z * q.z), uz = 2 * (q.z * q.y + q.w * q.x);
  return (Math.atan2(uz, uy) * DEG).toFixed(1).padStart(5);
};
let tLift = -1, nextMark = 0, lastHipR = 0, x0 = 0, z0 = 0;
for (let s = 0; s < Math.round(14.0 / w.dt); s++) {
  const com2Prev = ctl.sensors.com[2]!;
  const hipRPrev = dHiR >= 0 ? body.dofs[dHiR]!.angle : 0;
  w.advance(1);
  const t = s * w.dt;
  if (tLift < 0) {
    if (isLiftDone()) {
      tLift = t; nextMark = 0; lastHipR = hipRPrev;
      x0 = ctl.sensors.com[0]!; z0 = ctl.sensors.com[2]!;
      console.log(`★抬腿 t=${t.toFixed(2)}s`);
    }
    continue;
  }
  if (t - tLift >= nextMark) {
    const lat = ctl.sensors.com[2]! * 100, latV = ((ctl.sensors.com[2]! - com2Prev) / w.dt) * 100;
    const roll = ctl.sensors.torsoTilt[1]! * DEG;
    const hipR = dHiR >= 0 ? body.dofs[dHiR]!.angle * DEG : 0;
    const hipRV = (hipR - lastHipR * DEG) / 0.1;
    console.log(`+${nextMark.toFixed(1)}s 侧=${lat.toFixed(1).padStart(6)}cm 侧速=${latV.toFixed(1).padStart(6)} 躯滚=${roll.toFixed(1).padStart(5)}° 盆滚=${rollOf(pelvisIdx)}° 髋R=${hipR.toFixed(1).padStart(5)}° 髋R速=${hipRV.toFixed(0).padStart(4)}°/s`);
    lastHipR = hipR / DEG;
    nextMark = Math.round((t - tLift + 0.1) * 100) / 100;
  }
  const drift = Math.hypot(ctl.sensors.com[0]! - x0, ctl.sensors.com[2]! - z0) * 100;
  if (Math.abs(ctl.sensors.torsoTilt[1]! * DEG) > 15) { console.log(`>>> 左右超15° @+${(t - tLift).toFixed(2)}s 止`); break; }
  if (drift > 10) { console.log(`>>> 偏移超10cm @+${(t - tLift).toFixed(2)}s 止`); break; }
  if (t - tLift > 8.0) { console.log('>>> 8s 窗口到'); break; }
}
