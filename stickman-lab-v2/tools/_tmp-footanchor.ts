/** _tmp-footanchor: 脚落点是否钉住 + 闭链反解目标几何
 *
 *  ① 脚刚体世界位置漂移（静置期/释放后）——「蹲下时脚不能动」是否成立
 *  ② 从脚落点 + 段长，解「膝竖直 + 髋水平」的目标位置
 *  ③ 实际位置 vs 目标位置的误差
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

(globalThis as { process?: { env?: Record<string, string> } }).process!.env;
const E = globalThis.process!.env;

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
ctl.actions.idleEnabled = false;
w.controller = ctl;
w.reset();
const court = squatCourtSetup(w, ctl, Number(E.SETTLE ?? '2.0')) as CourtState;
const body = w.body;

/** 脚落点：foot 刚体上表面中心（世界系）。用刚体原点即可 —— 落点不动 = 原点不动 */
const footPos = (sd: 'l' | 'r'): { x: number; y: number; z: number } => {
  const bi = body.indexByKey.get(`foot_${sd}`)!;
  const t = body.bodies[bi]!.translation();
  return { x: t.x, y: t.y, z: t.z };
};
/** 踝锚点（脚与胫骨的铰接点） */
const anklePos = (sd: 'l' | 'r'): { x: number; y: number; z: number } => {
  const i = body.dofByName(`foot_${sd}`, 2);
  const a = body.dofs[i]!.anchorWorld;
  return { x: a[0]!, y: a[1]!, z: a[2]! };
};
const kneePos = (sd: 'l' | 'r'): { x: number; y: number; z: number } => {
  const i = body.dofByName(`knee_${sd}`, 2);
  const a = body.dofs[i]!.anchorWorld;
  return { x: a[0]!, y: a[1]!, z: a[2]! };
};
const hipPos = (sd: 'l' | 'r'): { x: number; y: number; z: number } => {
  const i = body.dofByName(`hip_${sd}`, 2);
  const a = body.dofs[i]!.anchorWorld;
  return { x: a[0]!, y: a[1]!, z: a[2]! };
};

console.log(' t     | 脚L(x,y,z)cm          脚R(x,y,z)cm          | 踝L(x,y)cm   膝L(x,y)cm   髋L(x,y)cm  | 脚漂移mm');
let last = -1;
const f0 = { l: footPos('l'), r: footPos('r') };
for (let s = 0; s < Math.round(Number(E.T_END ?? '4.0') / w.dt); s++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  const t = court.t;
  if (t < 0.8 || t - last < 0.2 - 1e-9) continue;
  last = t;
  const fl = footPos('l'), fr = footPos('r');
  const al = anklePos('l'), kl = kneePos('l'), hl = hipPos('l');
  const driftL = Math.hypot(fl.x - f0.l.x, fl.y - f0.l.y, fl.z - f0.l.z) * 1000;
  const driftR = Math.hypot(fr.x - f0.r.x, fr.y - f0.r.y, fr.z - f0.r.z) * 1000;
  console.log(
    `${t.toFixed(2)} | ${(fl.x * 100).toFixed(2).padStart(6)} ${(fl.y * 100).toFixed(2).padStart(6)} ${(fl.z * 100).toFixed(2).padStart(6)}  ` +
    `${(fr.x * 100).toFixed(2).padStart(6)} ${(fr.y * 100).toFixed(2).padStart(6)} ${(fr.z * 100).toFixed(2).padStart(6)}  |` +
    ` ${(al.x * 100).toFixed(1).padStart(5)} ${(al.y * 100).toFixed(1).padStart(5)}  ${(kl.x * 100).toFixed(1).padStart(5)} ${(kl.y * 100).toFixed(1).padStart(5)}  ${(hl.x * 100).toFixed(1).padStart(5)} ${(hl.y * 100).toFixed(1).padStart(5)} |` +
    ` L${driftL.toFixed(1)} R${driftR.toFixed(1)}`,
  );
  if (court.fall >= 0 && t >= court.fall + 0.1) break;
}
console.log(`fall=${court.fall >= 0 ? `${court.fall.toFixed(2)}s ${court.reason}` : '未倒'}`);

// ── 闭链反解 ──
console.log('\n════ 闭链反解：从脚落点求「膝竖直 + 髋水平」════');
const al = anklePos('l'), kl = kneePos('l'), hl = hipPos('l');
const shinLen = Math.hypot(kl.x - al.x, kl.y - al.y, kl.z - al.z);
const thighLen = Math.hypot(hl.x - kl.x, hl.y - kl.y, hl.z - kl.z);
console.log(`  实际段长: shin=${(shinLen * 100).toFixed(1)}cm  thigh=${(thighLen * 100).toFixed(1)}cm`);

// 「膝竖直」= 膝在踝正上方（x 对齐踝）
// 「髋水平」= 大腿水平 + 髋在膝后方 thighLen
const targetKnee = { x: al.x, y: al.y + shinLen, z: al.z };
// 大腿水平：髋 y = 膝 y；髋在膝后（x 减）
const targetHip = { x: targetKnee.x - thighLen, y: targetKnee.y, z: targetKnee.z };
console.log(`  实际: 踝(${(al.x * 100).toFixed(1)},${(al.y * 100).toFixed(1)}) 膝(${(kl.x * 100).toFixed(1)},${(kl.y * 100).toFixed(1)}) 髋(${(hl.x * 100).toFixed(1)},${(hl.y * 100).toFixed(1)})`);
console.log(`  目标: 膝(${(targetKnee.x * 100).toFixed(1)},${(targetKnee.y * 100).toFixed(1)}) 髋(${(targetHip.x * 100).toFixed(1)},${(targetHip.y * 100).toFixed(1)})`);
console.log(`  误差: 膝 Δx=${((targetKnee.x - kl.x) * 100).toFixed(1)}cm  髋 Δx=${((targetHip.x - hl.x) * 100).toFixed(1)}cm Δy=${((targetHip.y - hl.y) * 100).toFixed(1)}cm`);

// 反解成关节角：shin 目标角 = atan2(Δx, Δy) 相对大腿
const shinPitchAct = Math.atan2(kl.x - al.x, kl.y - al.y);
const thighPitchAct = Math.atan2(hl.x - kl.x, hl.y - kl.y);
const shinPitchTgt = 0;                        // 竖直
const thighPitchTgt = Math.PI;                 // 水平且髋在后 → 180°? 用 atan2
console.log(`\n  矢状角（小腿相对竖直 / 大腿相对竖直）:`);
console.log(`    实际: shin=${(shinPitchAct * 57.3).toFixed(1)}°  thigh=${(thighPitchAct * 57.3).toFixed(1)}°`);
console.log(`    目标: shin=0°（竖直）  thigh=${(Math.atan2(-1, 0) * 57.3).toFixed(0)}°（水平，髋在膝后）`);
// 关节角读数与几何角的关系
const kAng = body.dofs[body.dofByName('knee_l', 2)]!.angle * 57.3;
const hAng = body.dofs[body.dofByName('hip_l', 2)]!.angle * 57.3;
const aAng = body.dofs[body.dofByName('foot_l', 2)]!.angle * 57.3;
console.log(`  关节读数: hip_l/2=${hAng.toFixed(1)}°  knee_l/2=${kAng.toFixed(1)}°  foot_l/2=${aAng.toFixed(1)}°`);
console.log(`  → 几何角(shin+thigh)=${((shinPitchAct + thighPitchAct) * 57.3).toFixed(1)}°  与 hip+knee+foot 关系待定`);

// 目标几何角 → 需要的关节角（用同样的几何↔关节映射反解）
// 几何: shin = -foot_l/2 (脚掌平贴地时)，thigh = shin + knee
console.log(`\n  校验映射: foot_l/2=${aAng.toFixed(1)}° → shin 应=${(-aAng).toFixed(1)}°，实测几何=${(shinPitchAct * 57.3).toFixed(1)}°`);
const thighFromGeo = shinPitchAct - (kAng / 57.3);
console.log(`  thigh = shin − knee = ${(thighFromGeo * 57.3).toFixed(1)}°  实测=${(thighPitchAct * 57.3).toFixed(1)}°`);
