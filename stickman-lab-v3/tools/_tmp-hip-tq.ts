/** _tmp-hip-tq.ts —— 髋侧向(hip_r/0)关节力矩回读（用户：飞行局查力矩通道）
 *  用法：node tools/run.mjs _tmp-hip-tq [seed=2]
 *  复现种子坏局；从动作开始到抬腿+0.6s 每 0.1s 打印：
 *  ang / lastBreakdown(stiff,itb,act,servo,ff,damp) / pinned / manTq / com侧 / 足侧线 / err / vel
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
const tPre = 0.5 + Math.random() * 8;
for (let s = 0; s < Math.round(tPre / w.dt); s++) w.advance(1);
ctl.actions.play('singleLegR');
const DEG = 180 / Math.PI;
const drive = (ctl.warner as unknown as { drive: unknown }).drive;
const dr = drive as { lastBreakdown: Array<{ stiff: number; itb: number; lum: number; act: number; servo: number; ff: number; damp: number }> };
const manual = (ctl.warner as unknown as { manual: { isPinned(j: string, a: number): boolean; torqueOf(i: number): number } }).manual;
const dh1 = w.body.dofByName('hip_r', 0);
let tLift = -1, nextMark = 0;
console.log(`seed=${SEED} Tpre=${tPre.toFixed(1)}s dh1=${dh1}`);
for (let s = 0; s < Math.round(12.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  const liftNow = tLift < 0 && isLiftDone();
  if (liftNow) { tLift = t; nextMark = t; console.log(`★抬腿 t=${t.toFixed(2)}s`); }
  if (tLift >= 0 && t >= nextMark) {
    const bd = dr.lastBreakdown[dh1] ?? { stiff: 0, itb: 0, lum: 0, act: 0, servo: 0, ff: 0, damp: 0 };
    const ang = w.body.dofs[dh1]!.angle * DEG;
    const fin = manual.isPinned('hip_r', 0) ? 'Y' : 'N';
    const manTq = manual.torqueOf(dh1);
    const comL = ctl.sensors.com[2]! * 100;
    const footL = ctl.sensors.feet[1]!.z * 100;
    const err = comL - footL;
    const vel = ctl.sensors.comVel[2]! * 100;
    console.log(
      `t=${t.toFixed(2)} ang=${ang.toFixed(1).padStart(6)}° | 硬=${bd.stiff.toFixed(1).padStart(6)} 带=${bd.itb.toFixed(1).padStart(5)} 主=${bd.act.toFixed(1).padStart(6)} 伺=${bd.servo.toFixed(1).padStart(6)} 前=${bd.ff.toFixed(1).padStart(6)} 阻=${bd.damp.toFixed(1).padStart(5)} | 钉${fin} manTq=${manTq.toFixed(1).padStart(6)} | err=${err.toFixed(1).padStart(5)}cm vel=${vel.toFixed(1).padStart(6)}`,
    );
    nextMark = Math.round((t + 0.1) * 100) / 100;
  }
  if (tLift >= 0 && t - tLift > 0.6) break;
}
