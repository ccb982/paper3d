/** _tmp-swing-trace.ts —— 摆动腿尸检（用户："可能是摆动腿导致的"）
 *  确定性单腿；每 0.1s：com dx/dz、支撑fz、摆动腿（hip_l/2、knee_l/2、foot_l/2 角）+ foot_l 世界位置
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { isLiftDone, resetFootLateral } from '../src/core/servo/supportReg';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
resetFootLateral();
ctl.actions.play('singleLegR');
console.log('PROBE-MARKER-v3-2026-10-16');
const DEG = 180 / Math.PI;
const dHL = w.body.dofByName('hip_l', 2), dKL = w.body.dofByName('knee_l', 2), dFL = w.body.dofByName('foot_l', 2);
const dH0 = w.body.dofByName('hip_l', 0);
const dHR0 = w.body.dofByName('hip_r', 0), dHR2 = w.body.dofByName('hip_r', 2), dKR = w.body.dofByName('knee_r', 2), dFR = w.body.dofByName('foot_r', 2);   // ★ 支撑腿（下身）
const iFL = w.body.indexByKey.get('foot_l') ?? -1;
const manual = (ctl.warner as unknown as { manual: { isPinned(j: string, a: number): boolean } }).manual;
const dr = (ctl.warner as unknown as {
  drive: { lastBreakdown: Array<{ act: number; servo: number; stiff: number; damp: number }>; pairRef: Float64Array; pairC: Float64Array };
}).drive;
let tLift = -1, nextMark = 0;
const accK: number[] = [], accH: number[] = [];   // ★ 固定后逐帧力矩（稳不稳）
const accV: number[] = [], accA: number[] = [];   // ★ 固定后逐帧角速度/角度（波形）
const accR0: number[] = [], accR2: number[] = [], accRK: number[] = [];   // ★ 支撑腿力矩（下身）
for (let s = 0; s < Math.round(6.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (tLift < 0 && isLiftDone()) { tLift = t; nextMark = t; console.log(`★抬腿 t=${t.toFixed(2)}s`); }
  if (tLift >= 0 && t - tLift >= 0.2 && t - tLift <= 1.2) {
    if (dKL >= 0) accK.push(dr.lastBreakdown[dKL]?.act ?? 0);
    if (dHL >= 0) accH.push(dr.lastBreakdown[dHL]?.act ?? 0);
    if (dKL >= 0) { accV.push(w.body.dofs[dKL]!.vel); accA.push(w.body.dofs[dKL]!.angle * DEG); }
    if (dHR0 >= 0) accR0.push(dr.lastBreakdown[dHR0]?.act ?? 0);
    if (dHR2 >= 0) accR2.push(dr.lastBreakdown[dHR2]?.act ?? 0);
    if (dKR >= 0) accRK.push(dr.lastBreakdown[dKR]?.act ?? 0);
  }
  if (tLift >= 0 && t >= nextMark) {
    const ang = (i: number): string => (i >= 0 ? (w.body.dofs[i]!.angle * DEG).toFixed(0).padStart(5) : '  -  ');
    const fp = iFL >= 0 ? w.body.bodies[iFL]!.translation() : { x: 0, y: 0, z: 0 };
    const bK = dKL >= 0 ? (dr.lastBreakdown[dKL] ?? { act: 0, servo: 0, stiff: 0, damp: 0 }) : { act: 0, servo: 0, stiff: 0, damp: 0 };
    const dpeK = dKL >= 0 ? ((dr.pairRef[dKL]! - w.body.dofs[dKL]!.angle) * DEG) : 0;
    const cK = dKL >= 0 ? dr.pairC[dKL]! : 0;
    const tq = (i: number): string => {
      if (i < 0) return '  -  ';
      const b = dr.lastBreakdown[i] ?? { act: 0, servo: 0, stiff: 0, damp: 0 };
      return b.act.toFixed(1).padStart(6);
    };
    const bk = (i: number, k: 'servo' | 'stiff' | 'damp'): string => {
      if (i < 0) return '  -  ';
      const b = dr.lastBreakdown[i] ?? { act: 0, servo: 0, stiff: 0, damp: 0 };
      return b[k].toFixed(1).padStart(6);
    };
    const pins = `${manual.isPinned('hip_l', 2) ? 'H' : '·'}${manual.isPinned('knee_l', 2) ? 'K' : '·'}${manual.isPinned('foot_l', 2) ? 'F' : '·'}`;
    const st = ctl.actions.status;
    console.log(`+${(t - tLift).toFixed(1)}s [${st.phase ?? '-'}] com=(dx=${(ctl.sensors.com[0]! * 100).toFixed(0)},dz=${(ctl.sensors.com[2]! * 100).toFixed(0)}) | 摆膝=${ang(dKL)} 钉${pins} c=${cK.toFixed(2)} | 固定后力矩 髋0=${tq(dH0)} 髋2=${tq(dHL)} 膝2=${tq(dKL)} 踝2=${tq(dFL)} | 膝2分解 伺=${bk(dKL, 'servo')} 刚=${bk(dKL, 'stiff')} 阻=${bk(dKL, 'damp')}`);
    console.log(`        支撑腿力矩 髋0=${tq(dHR0)} 髋2=${tq(dHR2)} 膝2=${tq(dKR)} 踝2=${tq(dFR)} | 支撑腿角 髋0=${ang(dHR0)} 髋2=${ang(dHR2)} 膝2=${ang(dKR)} 踝2=${ang(dFR)}`);
    nextMark = Math.round((t + 0.1) * 100) / 100;
  }
  if (tLift >= 0 && t - tLift > 2.2) break;
}
const stats = (a: number[]): string => {
  if (!a.length) return '无数据';
  let mn = Infinity, mx = -Infinity, s = 0, s2 = 0;
  for (const v of a) { mn = Math.min(mn, v); mx = Math.max(mx, v); s += v; s2 += v * v; }
  const m = s / a.length, sd = Math.sqrt(Math.max(0, s2 / a.length - m * m));
  return `min=${mn.toFixed(1)} max=${mx.toFixed(1)} 均值=${m.toFixed(1)} 标准差=${sd.toFixed(1)} 峰峰=${(mx - mn).toFixed(1)}`;
};
console.log(`【固定后力矩稳定性】窗口 +0.2~+1.2s（${accK.length}帧，逐帧）`);
console.log(`  膝2: ${stats(accK)}`);
console.log(`  髋2: ${stats(accH)}`);
console.log(`  膝2逐帧波形(前40帧) tq=${accK.slice(0, 40).map((v) => v.toFixed(0)).join(',')}`);
console.log(`  vel=${accV.slice(0, 40).map((v) => v.toFixed(2)).join(',')}`);
console.log(`  ang=${accA.slice(0, 40).map((v) => v.toFixed(2)).join(',')}`);
console.log(`【支撑腿力矩稳定性】同窗口（${accR0.length}帧，逐帧）`);
console.log(`  支撑髋0: ${stats(accR0)}`);
console.log(`  支撑髋2: ${stats(accR2)}`);
console.log(`  支撑膝2: ${stats(accRK)}`);
