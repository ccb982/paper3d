/** _tmp-lat-robust.ts —— 随机预历史鲁棒性探针（复刻"原始网页"：idle 随机小动作后按单腿按钮）
 *  用法：node tools/run.mjs _tmp-lat-robust [N=10] [Tmax=8]
 *  每个种子：seed 注入 → reset → idle 随机 Tpre∈[0.5,Tmax] 秒 → play singleLegR → 测框
 *  输出：逐种子（Tpre/框/破点）+ 汇总（中位/最短/最长/抬腿失败数）
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { isLiftDone } from '../src/core/servo/supportReg';

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const N = Number(ARGS[0] ?? 10);
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

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
const DEG = 180 / Math.PI;

const boxes: number[] = [];
let liftFails = 0;
const lines: string[] = [];
for (let seed = 1; seed <= N; seed++) {
  (Math as { random: () => number }).random = mulberry32(seed);
  w.reset();
  ctl.actions.idleEnabled = true;
  const tPre = 0.5 + Math.random() * TMAX;
  for (let s = 0; s < Math.round(tPre / w.dt); s++) w.advance(1);
  ctl.actions.play('singleLegR');
  let tLift = -1, inBox = 0, firstBreach = -1, pitch0 = 0, roll0 = 0;
  let liftFail = false;
  for (let s = 0; s < Math.round(7.0 / w.dt); s++) {
    w.advance(1);
    const t = s * w.dt;
    if (tLift < 0) {
      if (!isLiftDone()) {
        if (t > 2.5) { liftFail = true; break; }
        continue;
      }
      tLift = t;
      pitch0 = ctl.sensors.torsoTilt[0]! * DEG;
      roll0 = ctl.sensors.torsoTilt[1]! * DEG;
      continue;
    }
    const pitchRel = ctl.sensors.torsoTilt[0]! * DEG - pitch0;
    const tiltRel = ctl.sensors.torsoTilt[1]! * DEG - roll0;
    const ok = Math.abs(pitchRel) <= 20 && Math.abs(tiltRel) <= 10;
    if (ok) inBox += w.dt; else if (firstBreach < 0) firstBreach = t;
  }
  if (liftFail) { liftFails++; lines.push(`seed=${seed} Tpre=${tPre.toFixed(1)}s 抬腿失败(>2.5s)`); continue; }
  boxes.push(inBox);
  lines.push(`seed=${seed} Tpre=${tPre.toFixed(1)}s 框=${inBox.toFixed(2)}s 破=${firstBreach > 0 ? `@${(firstBreach - tLift).toFixed(1)}` : 'never'}`);
}
for (const l of lines) console.log(l);
const sorted = [...boxes].sort((a, b) => a - b);
const med = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
console.log(
  `=== 汇总(${N}种子) 中位=${med.toFixed(2)}s 最短=${(sorted[0] ?? 0).toFixed(2)} 最长=${(sorted[sorted.length - 1] ?? 0).toFixed(2)} 抬腿失败=${liftFails}/${N}`,
);
