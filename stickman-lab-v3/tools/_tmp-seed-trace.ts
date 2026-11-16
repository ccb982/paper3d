/** _tmp-seed-trace.ts —— 单种子救援尸检（用户："选一个种子看怎么救的"）
 *  用法：node tools/run.mjs _tmp-seed-trace [seed=2] [Tmax=8]
 *  复刻 robust 种子流程（idle 预历史→play），随后每 0.1s 打印：
 *  前/左/侧 + 救援[latSig latD sagD comDz] + 关键力矩（踝两电机/膝髋脊净）
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { isLiftDone, resetFootLateral } from '../src/core/servo/supportReg';
import { lastRescueDbg } from '../src/core/servo/rescue';

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const SEED = Number(ARGS[0] ?? 2);
const TMAX = Number(ARGS[1] ?? 8);
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
(Math as { random: () => number }).random = mulberry32(SEED * 100 + 1);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
ctl.actions.idleEnabled = true;
resetFootLateral();
const tPre = 0.5 + Math.random() * TMAX;
for (let s = 0; s < Math.round(tPre / w.dt); s++) w.advance(1);
console.log(`seed=${SEED} Tpre=${tPre.toFixed(1)}s 预状态:前=${(ctl.sensors.torsoTilt[0]! * 57.3).toFixed(1)}° 侧=${(ctl.sensors.com[2]! * 100).toFixed(1)}cm`);
ctl.actions.play('singleLegR');
const DEG = 180 / Math.PI;
const dr = (ctl.warner as unknown as { drive: { lastBreakdown: Array<{ act: number; servo: number; stiff: number; damp: number }> } }).drive;
const ax: Array<[string, number]> = [['foot_r', 0], ['foot_r', 2], ['knee_r', 0], ['knee_r', 2], ['hip_r', 0], ['hip_r', 2], ['spine1', 0], ['spine1', 2]];
const dIdx = ax.map(([n, a]) => w.body.dofByName(n, a));
let tLift = -1, nextMark = 0;
for (let s = 0; s < Math.round(12.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (tLift < 0 && isLiftDone()) { tLift = t; nextMark = t; console.log(`★抬腿 t=${t.toFixed(2)}s`); }
  if (tLift >= 0 && t >= nextMark) {
    const pitch = ctl.sensors.torsoTilt[0]! * DEG, roll = ctl.sensors.torsoTilt[1]! * DEG;
    const lat = ctl.sensors.com[2]! * 100;
    const pinS2 = (ctl.warner as unknown as { manual: { isPinned(j: string, a: number): boolean } }).manual;
    const pins = ['spine1', 'spine2', 'spine3'].map((s) => (pinS2.isPinned(s, 2) ? '钉' : '·')).join('');
    const footZ = ctl.sensors.feet[1]!.z * 100;
    const needZ = Math.abs(lat - footZ) / 100 * 9.81 * (w.body as unknown as { sk: { massTotal: number } }).sk.massTotal;   // 侧向重力矩需求(N·m)
    const needX = Math.abs(ctl.sensors.com[0]! - ctl.sensors.feet[1]!.x) * 9.81 * (w.body as unknown as { sk: { massTotal: number } }).sk.massTotal;   // 前后重力矩需求
    const cells = ax.map(([n, a], k) => {
      const i = dIdx[k]!;
      if (i < 0) return `${n}/${a}:-`;
      const d0 = w.body.dofs[i]!;
      if (d0.engineMotor) return `${n}/${a}:电${(((d0 as unknown as { motorTqEst?: number }).motorTqEst ?? 0)).toFixed(0).padStart(4)}`;
      const b = dr.lastBreakdown[i] ?? { act: 0, servo: 0, stiff: 0, damp: 0 };
      return `${n}/${a}:净${(b.act + b.servo + b.stiff + b.damp).toFixed(0).padStart(4)}`;
    });
    console.log(`+${(t - tLift).toFixed(1)}s 前=${pitch.toFixed(1).padStart(5)} 左=${roll.toFixed(1).padStart(5)} 侧=${lat.toFixed(1).padStart(6)} 脊钉=${pins} 需求(侧=${needZ.toFixed(0)}/前=${needX.toFixed(0)}Nm) 救援[latSig=${lastRescueDbg.latSig.toFixed(2)} latD=${lastRescueDbg.latRollD.toFixed(2)} sagD=${lastRescueDbg.sagD.toFixed(2)}] | ${cells.join(' ')}`);
    nextMark = Math.round((t + 0.1) * 100) / 100;
  }
  if (tLift >= 0 && t - tLift > 2.5) break;
}
