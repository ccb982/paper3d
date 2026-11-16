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
import { lastRescueDbg } from '../src/core/servo/rescue';

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const N = Number(ARGS[0] ?? 10);
const TMAX = Number(ARGS[1] ?? 8);
const TWIN = Number(ARGS[2] ?? 12);
/** ★ §2.655 单种子模式（第4参数）：逐种子**独立进程**跑（bash 循环），彻底隔离模块级单例状态
 *  （stepPhases 相位机/rescue 内部态等跨种子污染的根治——回读实锤：同进程内 seed2+ 救援更新=1 帧）。 */
const SEED_ONLY = ARGS[3] ? Number(ARGS[3]) : 0;
if (!SEED_ONLY && N > 1) {
  console.log('⚠ 同进程多种子存在模块级状态污染（相位机/救援等单例跨 World 残留）——请用逐种子独立进程：');
  console.log(`   for s in $(seq 1 ${N}); do node tools/run.mjs _tmp-lat-robust 1 ${TMAX} ${TWIN} $s; done`);
}

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
const data: Array<{ stand: number; lat: number; roll: number; vel: number }> = [];
const lines: string[] = [];
for (let seed = SEED_ONLY || 1; seed <= (SEED_ONLY || N); seed++) {
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
    // ★ 配对铁律（用户："对比要用相同的一组种子"）：每(种子,尝试)独立注入 RNG——
    //   该尝试的预历史/动作随机流与任何先前消耗无关 ⇒ 跨配置同(seed,attempt)逐位可配对。
    (Math as { random: () => number }).random = mulberry32(seed * 100 + attempt);
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
  let lat0 = 0, rollA0 = 0, latVel0 = 0;
  let dbgChanges = 0, _lastSig = Number.NaN;
  for (let s = 0; s < Math.round((TWIN + 3.0) / w.dt); s++) {
    const com2Prev = ctl.sensors.com[2]!;
    w.advance(1);
    if (lastRescueDbg.latSig !== _lastSig) { dbgChanges++; _lastSig = lastRescueDbg.latSig; }   // 救援是否在保持期被更新
    const t = s * w.dt;
    if (tLift < 0) {
      if (!isLiftDone()) {
        if (t > 2.5) { liftFail = true; break; }
        continue;
      }
      tLift = t;
      x0 = ctl.sensors.com[0]!; z0 = ctl.sensors.com[2]!;
      lat0 = z0 * 100;
      rollA0 = ctl.sensors.torsoTilt[1]! * DEG;
      latVel0 = ((ctl.sensors.com[2]! - com2Prev) / w.dt) * 100;
      continue;
    }
    const pitch = ctl.sensors.torsoTilt[0]! * DEG;
    const roll = ctl.sensors.torsoTilt[1]! * DEG;
    const drift = Math.hypot(ctl.sensors.com[0]! - x0, ctl.sensors.com[2]! - z0) * 100;
    // ★ 用户定口径（2026-10-16 更新）：抬脚后 前后±20° / 左右±10° / 偏离中心±5cm
    if (Math.abs(pitch) > 20) { viol = `前后=${pitch.toFixed(1)}°`; break; }
    if (Math.abs(roll) > 10) { viol = `左右=${roll.toFixed(1)}°`; break; }
    if (drift > 5) { viol = `偏移=${drift.toFixed(1)}cm(x=${((ctl.sensors.com[0]! - x0) * 100).toFixed(1)},z=${((ctl.sensors.com[2]! - z0) * 100).toFixed(1)})`; break; }
    stand = t - tLift;
    if (stand >= TWIN) { viol = '满窗'; break; }
  }
  if (liftFail) { liftFails++; lines.push(`seed=${seed} Tpre=${tPre.toFixed(1)}s(第${attempt}次) 预状态(前=${prePitch.toFixed(0)}° CoM高=${(preH * 100).toFixed(0)}cm) 抬腿失败`); continue; }
  stands.push(stand);
  data.push({ stand, lat: lat0, roll: rollA0, vel: latVel0 });
  lines.push(`seed=${seed} Tpre=${tPre.toFixed(1)}s(第${attempt}次) 有效=${stand.toFixed(2)}s 初始:侧=${lat0.toFixed(1)}cm 滚=${rollA0.toFixed(1)}° 侧速=${latVel0.toFixed(1)}cm/s 救援更新次数=${dbgChanges} 救援末[latSig=${lastRescueDbg.latSig.toFixed(3)} latD=${lastRescueDbg.latRollD.toFixed(3)} comDz=${(lastRescueDbg.comDz * 100).toFixed(1)}] ${viol === '满窗' ? `满窗(${TWIN}s)未违规` : `违规:${viol}`}`);
}
for (const l of lines) console.log(l);
const sorted = [...stands].sort((a, b) => a - b);
const med = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
console.log(
  `=== 汇总(${N}种子) 有效站立中位=${med.toFixed(2)}s 最短=${(sorted[0] ?? 0).toFixed(2)} 最长=${(sorted[sorted.length - 1] ?? 0).toFixed(2)} 抬腿失败=${liftFails} 预历史排除=${excluded}`,
);
// ★ 用户：站得长 vs 站得短的初始侧偏对比（按有效站立时间上下半分两组）
if (data.length >= 4) {
  const ds = [...data].sort((a, b) => b.stand - a.stand);
  const half = Math.floor(ds.length / 2);
  const grp = (arr: typeof ds): string => {
    const m = (f: (d: (typeof ds)[number]) => number): string => (arr.reduce((s, d) => s + f(d), 0) / arr.length).toFixed(1);
    return `侧偏=${m((d) => Math.abs(d.lat))}cm 滚=${m((d) => Math.abs(d.roll))}° 侧速=${m((d) => Math.abs(d.vel))}cm/s`;
  };
  console.log(`=== 站得长上半(${half}局, 平均${(ds.slice(0, half).reduce((s, d) => s + d.stand, 0) / half).toFixed(2)}s): ${grp(ds.slice(0, half))}`);
  console.log(`=== 站得短下半(${ds.length - half}局, 平均${(ds.slice(half).reduce((s, d) => s + d.stand, 0) / (ds.length - half)).toFixed(2)}s): ${grp(ds.slice(half))}`);
}
