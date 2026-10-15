/** _tmp-hold10.ts v3 —— 用户判决实验："初始状态就是抬单条腿的，一直注入基础力，看能不能站够10s"
 *  直构初始态（无物理作战）：① w.reset() 站立 → ② 运动学直摆左腿链进入抬腿姿势（hip 0.45 / knee −0.75 / ankle 0.08）
 *  → ③ 整体平移使 CoM 落在右脚正上方 → ④ 全体零速 + 全新控制器（CoM 目标=当前位=无拉偏）→ ⑤ 观察 12s。
 *  A/B：回正 env（SUP_DY_KP=0 SUP_PI_KP=0 SUP_KNEE0_CORR=0）=纯基础力。
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportColumn, captureSupportPose, setLiftDone } from '../src/core/servo/supportReg';
import type { PhaseCtx } from '../src/core/program';
import { PROPOSALS } from '../src/core/proposalBus';

const ENV = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
const HOLD = Number(ENV.HOLD ?? 12.0);
const DEG = 57.29578;

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
w.advance(1);   // 传感器就位

type V3 = { x: number; y: number; z: number };
type Q4 = { x: number; y: number; z: number; w: number };
const qMul = (a: Q4, b: Q4): Q4 => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
const qRot = (q: Q4, v: V3): V3 => {
  const { x, y, z, w: qw } = q;
  const ix = qw * v.x + y * v.z - z * v.y;
  const iy = qw * v.y + z * v.x - x * v.z;
  const iz = qw * v.z + x * v.y - y * v.x;
  const iw = -x * v.x - y * v.y - z * v.z;
  return {
    x: ix * qw + iw * -x + iy * -z - iz * -y,
    y: iy * qw + iw * -y + iz * -x - ix * -z,
    z: iz * qw + iw * -z + ix * -y - iy * -x,
  };
};
const axisAngleQ = (axis: V3, ang: number): Q4 => {
  const s = Math.sin(ang / 2);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(ang / 2) };
};

const idx = (key: string): number => w.body.indexByKey.get(key)!;
const names = ['thigh_l', 'shin_l', 'foot_l', 'arch_l', 'mfoot_l'];

// ② 运动学直摆：绕各关节锚点旋转下游链（顺序：髋→膝→踝；枢轴用旋转后的实际位置推进）
{
  const steps: Array<[string, number, number, string[]]> = [
    ['hip_l', 2, Number(ENV.HIPL ?? 0.45), ['thigh_l', 'shin_l', 'foot_l', 'arch_l', 'mfoot_l']],
    ['knee_l', 2, Number(ENV.KNEEL ?? -0.75), ['shin_l', 'foot_l', 'arch_l', 'mfoot_l']],
    ['foot_l', 2, Number(ENV.FOOTL ?? 0.08), ['foot_l', 'arch_l', 'mfoot_l']],
  ];
  for (const [jn, ax, ang, chain] of steps) {
    const di = w.body.dofByName(jn, ax);
    if (di < 0) continue;
    const d0 = w.body.dofs[di]!;
    const pivotPre: V3 = { x: d0.anchorWorld[0]!, y: d0.anchorWorld[1]!, z: d0.anchorWorld[2]! };
    const axis: V3 = { x: d0.axisWorld[0]!, y: d0.axisWorld[1]!, z: d0.axisWorld[2]! };
    const rot = axisAngleQ(axis, ang);
    for (const key of chain) {
      const rb = w.body.bodies[idx(key)]!;
      const p = rb.translation() as V3;
      const dp: V3 = { x: p.x - pivotPre.x, y: p.y - pivotPre.y, z: p.z - pivotPre.z };
      const dr = qRot(rot, dp);
      rb.setTranslation({ x: pivotPre.x + dr.x, y: pivotPre.y + dr.y, z: pivotPre.z + dr.z }, true);
      rb.setRotation(qMul(rot, rb.rotation() as Q4), true);
    }
    // 枢轴推进：位于本 step 链内的下游关节（膝的父=thigh、踝的父=shin）锚点+轴方向同步旋转
    for (const [jn2, parentBody] of [['knee_l', 'thigh_l'], ['foot_l', 'shin_l']] as Array<[string, string]>) {
      if (!chain.includes(parentBody)) continue;
      const di2 = w.body.dofByName(jn2, 2);
      if (di2 < 0) continue;
      const d2 = w.body.dofs[di2]!;
      const ap: V3 = { x: d2.anchorWorld[0]!, y: d2.anchorWorld[1]!, z: d2.anchorWorld[2]! };
      const dap: V3 = { x: ap.x - pivotPre.x, y: ap.y - pivotPre.y, z: ap.z - pivotPre.z };
      const dar = qRot(rot, dap);
      d2.anchorWorld[0] = pivotPre.x + dar.x;
      d2.anchorWorld[1] = pivotPre.y + dar.y;
      d2.anchorWorld[2] = pivotPre.z + dar.z;
      const av: V3 = { x: d2.axisWorld[0]!, y: d2.axisWorld[1]!, z: d2.axisWorld[2]! };
      const avr = qRot(rot, av);
      d2.axisWorld[0] = avr.x;
      d2.axisWorld[1] = avr.y;
      d2.axisWorld[2] = avr.z;
    }
  }
}

// ③ 整体平移使 CoM 落在右脚正上方
{
  let m = 0, cx = 0, cz = 0;
  for (const rb of w.body.bodies) {
    const c = rb.worldCom();
    m += rb.mass();
    cx += rb.mass() * c.x;
    cz += rb.mass() * c.z;
  }
  cx /= m; cz /= m;
  const footR = w.body.bodies[idx('foot_r')]!;
  const fp = footR.translation() as V3;
  const targetCoM = { x: cx, z: fp.z };   // CoM 移到右脚 z 上方（x 保持）
  const del = { x: targetCoM.x - cx, z: targetCoM.z - cz };
  for (const rb of w.body.bodies) {
    const p = rb.translation() as V3;
    rb.setTranslation({ x: p.x + del.x, y: p.y, z: p.z + del.z }, true);
  }
  console.log(`② 摆姿完成；③ 平移 Δz=${(del.z * 100).toFixed(1)}cm（CoM → 右脚上方）`);
  for (const key of names) {
    const rb = w.body.bodies[idx(key)]!;
    const p = rb.translation() as V3;
    console.log(`    ${key}: y=${(p.y * 100).toFixed(1)}cm  x=${(p.x * 100).toFixed(1)}  z=${(p.z * 100).toFixed(1)}`);
  }
}

// ④ 零速 + 全新控制器
for (const rb of w.body.bodies) {
  rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
  rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
}
const ctl2 = new ControlModule(w, { postureTone: 8 });
w.controller = ctl2;
w.advance(1);
ctl2.warner.setComTarget(ctl2.sensors.com[0]!, ctl2.sensors.com[2]!);
// 摆动腿姿势保持（手写不放开）
ctl2.manual.setAngle('hip_l', 2, Number(ENV.HIPL ?? 0.45));
ctl2.manual.setAngle('knee_l', 2, Number(ENV.KNEEL ?? -0.75));
ctl2.manual.setAngle('foot_l', 2, Number(ENV.FOOTL ?? 0.08));
console.log(`④ 初始态就位。com=(x${(ctl2.sensors.com[0]! * 100).toFixed(1)},z${(ctl2.sensors.com[2]! * 100).toFixed(1)})cm fzL=${ctl2.sensors.feet[0]!.fz.toFixed(0)} fzR=${ctl2.sensors.feet[1]!.fz.toFixed(0)} roll=${(ctl2.sensors.torsoTilt[1]! * DEG).toFixed(1)}°`);

// ⑤ 判决（每帧注入支撑柱写手=基础力+回正）
const STEPCTX: PhaseCtx = { sensors: ctl2.sensors, bal: ctl2.warner, body: w.body };
let fall = -1, peakRoll = 0, peakPitch = 0;
const N = Math.round(HOLD / w.dt);
const SETTLE_N = Math.round(Number(ENV.SETTLE ?? 0.25) / w.dt);   // 静置窗：接触落定（消传送冲击尖峰）
setLiftDone(true);                                  // 视为"抬腿已完成"
captureSupportPose(STEPCTX, 'r');                   // 捕获支撑姿态 θ₀（无动作时缺此步）
for (let s = 0; s < N; s++) {
  supportColumn(STEPCTX, 'r', w.dt);
  if (s === 60) console.log(`DBG@0.25s: bus=${PROPOSALS.length} 样本=${PROPOSALS.slice(0, 6).map((p) => p.src).join(',')}`);
  w.advance(1);
  if (s < SETTLE_N) {
    for (const rb of w.body.bodies) {
      rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }
  const roll = ctl2.sensors.torsoTilt[1]!, pitch = ctl2.sensors.torsoTilt[0]!;
  peakRoll = Math.max(peakRoll, Math.abs(roll));
  peakPitch = Math.max(peakPitch, Math.abs(pitch));
  const fallen = Math.abs(pitch) > Math.PI / 4 || Math.abs(roll) > Math.PI / 4 || ctl2.sensors.com[1]! < 0.75;
  if (fallen) { fall = (s + 1) * w.dt; break; }
  if (s % Math.round(1.0 / w.dt) === 0) {
    console.log(`t=${(s * w.dt).toFixed(1)}s com=(x${(ctl2.sensors.com[0]! * 100).toFixed(1)},z${(ctl2.sensors.com[2]! * 100).toFixed(1)})cm roll=${(roll * DEG).toFixed(1)}° pitch=${(pitch * DEG).toFixed(1)}° fzL=${ctl2.sensors.feet[0]!.fz.toFixed(0)} fzR=${ctl2.sensors.feet[1]!.fz.toFixed(0)}`);
  }
}
console.log(`判决：${fall < 0 ? `站住 ${HOLD}s ✓` : `倒下 @${fall.toFixed(2)}s ✗`}  |roll|峰=${(peakRoll * DEG).toFixed(1)}° |pitch|峰=${(peakPitch * DEG).toFixed(1)}°`);
