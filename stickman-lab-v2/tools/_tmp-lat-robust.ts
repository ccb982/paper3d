/** _tmp-lat-robust.ts —— 随机预历史鲁棒性探针（复刻"原始网页"：idle 随机小动作后按单腿按钮）
 *  用法：node tools/run.mjs _tmp-lat-robust [N=10] [Tmax=8] [Twin=12]
 *  每种子：seed 注入 → reset → idle 随机 Tpre∈[0.5,Tmax] 秒 → play singleLegR
 *  ★ 有效站立时间（用户口径）：从抬脚起计时 → 首次违规止：
 *      |前后倾|>20° 或 |左右倾|>15°（相对竖直绝对角）或 水平CoM偏移初始(抬脚时)位置>10cm
 *  输出：逐种子（Tpre/有效站立时间/违规原因）+ 汇总（中位/最短/最长/抬腿失败数）
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { isLiftDone, resetFootLateral } from '../src/core/servo/supportReg';

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const N = Number(ARGS[0] ?? 10);
const TMAX = Number(ARGS[1] ?? 8);
const TWIN = Number(ARGS[2] ?? 12);

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

let w = new World();
let ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
const DEG = 180 / Math.PI;

const stands: number[] = [];
let liftFails = 0;
let excluded = 0;
const lines: string[] = [];
for (let seed = 1; seed <= N; seed++) {
  (Math as { random: () => number }).random = mulberry32(seed);
  ctl.actions.idleEnabled = true;
  let tPre = 0, attempt = 0, preOk = false;
  let prePitch = 0, preRoll = 0, preH = 0;
  for (attempt = 1; attempt <= 5; attempt++) {
    // ★ 独立试验：每次尝试重建 World+Control（=网页刚打开第一次按，杜绝跨轮残留；
    //   supportReg 是模块级共享态 → 仍需 resetFootLateral 清锁）
    w = new World();
    ctl = new ControlModule(w, { postureTone: 8 });
    w.controller = ctl;
    ctl.actions.idleEnabled = true;
    resetFootLateral();
    tPre = 0.5 + Math.random() * TMAX;
    let fell = false;
    for (let s = 0; s < Math.round(tPre / w.dt); s++) {
      w.advance(1);
      if (s * w.dt > 0.5 && ctl.sensors.com[1]! < 0.70) { fell = true; break; }
    }
    prePitch = ctl.sensors.torsoTilt[0]! * DEG;
    preRoll = ctl.sensors.torsoTilt[1]! * DEG;
    preH = ctl.sensors.com[1]!;
    if (!fell && preH > 0.70 && Math.abs(prePitch) <= 20 && Math.abs(preRoll) <= 15) { preOk = true; break; }
  }
  if (!preOk) { excluded++; lines.push(`seed=${seed} 5次预历史全不达标(倒下或按点超限,排除)`); continue; }
  ctl.actions.play('singleLegR');
  let tLift = -1, stand = 0, viol = '', liftFail = false;
  let x0 = 0, z0 = 0;
  for (let s = 0; s < Math.round((TWIN + 3.0) / w.dt); s++) {
    w.advance(1);
    const t = s * w.dt;
    if (tLift < 0) {
      if (!isLiftDone()) {
        if (t > 2.5) { liftFail = true; break; }
        continue;
      }
      tLift = t;
      x0 = ctl.sensors.com[0]!; z0 = ctl.sensors.com[2]!;
      continue;
    }
    const pitch = ctl.sensors.torsoTilt[0]! * DEG;
    const roll = ctl.sensors.torsoTilt[1]! * DEG;
    const drift = Math.hypot(ctl.sensors.com[0]! - x0, ctl.sensors.com[2]! - z0) * 100;
    if (Math.abs(pitch) > 20) { viol = `前后=${pitch.toFixed(1)}°`; break; }
    if (Math.abs(roll) > 15) { viol = `左右=${roll.toFixed(1)}°`; break; }
    if (drift > 10) { viol = `偏移=${drift.toFixed(1)}cm`; break; }
    stand = t - tLift;
    if (stand >= TWIN) { viol = '满窗'; break; }
  }
  if (liftFail) { liftFails++; lines.push(`seed=${seed} Tpre=${tPre.toFixed(1)}s(第${attempt}次) 预状态(前=${prePitch.toFixed(0)}° CoM高=${(preH * 100).toFixed(0)}cm) 抬腿失败`); continue; }
  stands.push(stand);
  lines.push(`seed=${seed} Tpre=${tPre.toFixed(1)}s(第${attempt}次) 预(前=${prePitch.toFixed(0)}° 左=${preRoll.toFixed(0)}° 高=${(preH * 100).toFixed(0)}cm) 有效=${stand.toFixed(2)}s ${viol === '满窗' ? `满窗(${TWIN}s)未违规` : `违规:${viol}`}`);
}
for (const l of lines) console.log(l);
const sorted = [...stands].sort((a, b) => a - b);
const med = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
console.log(
  `=== 汇总(${N}种子) 有效站立中位=${med.toFixed(2)}s 最短=${(sorted[0] ?? 0).toFixed(2)} 最长=${(sorted[sorted.length - 1] ?? 0).toFixed(2)} 抬腿失败=${liftFails} 预历史排除=${excluded}`,
);
