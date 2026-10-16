/** _tmp-hold10.ts v3 —— 用户判决实验："初始状态就是抬单条腿的，一直注入基础力，看能不能站够10s"
 *  直构初始态（无物理作战）：① w.reset() 分腿站 → ② 运动学直摆左腿链进入抬腿姿势（hip 0.45 / knee −0.75 / ankle 0.08）
 *  → ③ 绕支撑踝旋转+绕支撑髋回正（CoM 过踝，自然单腿站姿）→ ④ 全体零速 + 全新控制器（CoM 目标=当前位=无拉偏）→ ⑤ 观察 12s。
 *  A/B：回正 env（SUP_DY_KP=0 SUP_PI_KP=0 SUP_KNEE0_CORR=0）=纯基础力。
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportColumn, swingColumn, swingColumnReset, captureSupportPose, setLiftDone } from '../src/core/servo/supportReg';
import { supportClean, supportCleanReset } from '../src/core/servo/supportClean';
import type { PhaseCtx } from '../src/core/program';
import { PROPOSALS } from '../src/core/proposalBus';

const ENV = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
const SEED = Number(ENV.SEED ?? 0);
if (SEED) {
  const mulberry32 = (seed: number): (() => number) => {
    let a2 = seed >>> 0;
    return () => {
      a2 = (a2 + 0x6d2b79f5) >>> 0;
      let t2 = Math.imul(a2 ^ (a2 >>> 15), 1 | a2);
      t2 = (t2 + Math.imul(t2 ^ (t2 >>> 7), 61 | t2)) ^ t2;
      return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296;
    };
  };
  (Math as { random: () => number }).random = mulberry32(SEED * 100 + 1);   // ★ 用户："多来点种子"——确定性复现
}
const HOLD = Number(ENV.HOLD ?? 12.0);
const DEG = 57.29578;

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
w.advance(1);   // 传感器就位
{
  const cs = ctl.sensors.com;
  const idx2 = (k: string): number => w.body.indexByKey.get(k)!;
  const g = (k: string): V3 => w.body.bodies[idx2(k)]!.translation() as V3;
  const fr = g('foot_r'), mr = g('mfoot_r'), fl = g('foot_l'), ml = g('mfoot_l');
  const dA = w.body.dofs[w.body.dofByName('foot_r', 2)]!;
  console.log(`① reset 站位：com=(x${(cs[0]! * 100).toFixed(1)},z${(cs[2]! * 100).toFixed(1)})cm` +
    ` 右脚板中点z=${(((fr.z + mr.z) / 2) * 100).toFixed(1)} 左脚板中点z=${(((fl.z + ml.z) / 2) * 100).toFixed(1)}` +
    ` 踝_r锚=(x${(dA.anchorWorld[0]! * 100).toFixed(1)},z${(dA.anchorWorld[2]! * 100).toFixed(1)})`);
}

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
const names = ['thigh_l', 'shin_l', 'foot_l', 'arch_l', 'mfoot_l', 'foot_r', 'mfoot_r', 'shin_r'];

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

// ③ 单腿转移（运动学直构）：绕支撑踝把整体旋到 CoM 过踝 → 再绕支撑髋把躯干回正 = 自然单腿站姿
//   （原实现=全平移：脚也跟着走，com−脚偏移不变，等于没对位 → 就是要修的病根）
{
  const body = w.body;
  const rotAbout = (pivot: V3, axis: V3, ang: number, chain: typeof w.body.bodies): Q4 => {
    const rot = axisAngleQ(axis, ang);
    for (const rb of chain) {
      const p = rb.translation() as V3;
      const dp: V3 = { x: p.x - pivot.x, y: p.y - pivot.y, z: p.z - pivot.z };
      const dr = qRot(rot, dp);
      rb.setTranslation({ x: pivot.x + dr.x, y: pivot.y + dr.y, z: pivot.z + dr.z }, true);
      rb.setRotation(qMul(rot, rb.rotation() as Q4), true);
    }
    return rot;
  };
  const rotPt = (rot: Q4, pivot: V3, p: V3): V3 => {
    const dp: V3 = { x: p.x - pivot.x, y: p.y - pivot.y, z: p.z - pivot.z };
    const dr = qRot(rot, dp);
    return { x: pivot.x + dr.x, y: pivot.y + dr.y, z: pivot.z + dr.z };
  };
  const comXZ = (): { cx: number; cy: number; cz: number } => {
    let m = 0, cx = 0, cy = 0, cz = 0;
    for (const rb of body.bodies) {
      const c = rb.worldCom();
      m += rb.mass(); cx += rb.mass() * c.x; cy += rb.mass() * c.y; cz += rb.mass() * c.z;
    }
    return { cx: cx / m, cy: cy / m, cz: cz / m };
  };
  // 链：除支撑脚两体外的全部；躯干链：除支撑腿全部
  const footR = idx('foot_r'), mfootR = idx('mfoot_r');
  const footSet = new Set([footR, mfootR]);
  const legRKeys = ['thigh_r', 'shin_r', 'arch_r', 'foot_r', 'mfoot_r'];
  const legRSet = new Set(legRKeys.map((k) => idx(k)).filter((i) => i >= 0));
  const chainAll = body.bodies.filter((_, i) => !footSet.has(i));
  const chainTrunk = body.bodies.filter((_, i) => !legRSet.has(i));

  const A = ((): V3 => {
    const dA = body.dofs[body.dofByName('foot_r', 2)]!;
    return { x: dA.anchorWorld[0]!, y: dA.anchorWorld[1]!, z: dA.anchorWorld[2]! };
  })();
  {
    for (const ax of [0, 1, 2]) {
      const di = body.dofByName('foot_r', ax);
      if (di < 0) continue;
      const dd = body.dofs[di]!;
      console.log(`③轴 foot_r/${ax}: dir=(${dd.axisWorld[0]!.toFixed(2)},${dd.axisWorld[1]!.toFixed(2)},${dd.axisWorld[2]!.toFixed(2)})`);
    }
  }
  const c0 = comXZ();
  const phi = -Math.atan2(c0.cz - A.z, c0.cy - A.y);   // 绕踝把 com 转到踝正上方
  const axA: V3 = { x: 1, y: 0, z: 0 };   // ★ 用世界 x（矢状摆动轴）：踝=万向关节，x-z 面内旋转可精确表示（关节斜轴会把 com 甩歪）
  const rot1 = rotAbout(A, axA, phi, chainAll);
  const c1a = comXZ();
  console.log(`③a rot1(ax=(${axA.x.toFixed(2)},${axA.y.toFixed(2)},${axA.z.toFixed(2)}),φ=${(phi * DEG).toFixed(1)}°)后 com=(x${(c1a.cx * 100).toFixed(1)},z${(c1a.cz * 100).toFixed(1)})`);

  // 髋锚点（第一步旋转后） + 用踝轴逆旋转精确回正躯干（不能用髋轴：向向可能相反）
  const dH = body.dofs[body.dofByName('hip_r', 2)]!;
  const Hpre: V3 = { x: dH.anchorWorld[0]!, y: dH.anchorWorld[1]!, z: dH.anchorWorld[2]! };
  const H = rotPt(rot1, A, Hpre);
  const axA2 = qRot(rot1, axA);
  rotAbout(H, axA2, -phi, chainTrunk);   // 躯干绕支撑髋回正（轴=踝轴旋转后）

  const c1 = comXZ();
  console.log(`② 摆姿完成；③ 绕踝旋转 ${(phi * DEG).toFixed(1)}° + 躯干回正（CoM 过踝）com=(x${(c1.cx * 100).toFixed(1)},z${(c1.cz * 100).toFixed(1)})cm（踝 z=${(A.z * 100).toFixed(1)}）`);
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
const ctl2 = new ControlModule(w, { postureTone: Number(ENV.TONE ?? 0) });   // ★ 用户：零外部力——姿态张力层不在测试里拽摆腿
w.controller = ctl2;
w.advance(1);
ctl2.warner.setComTarget(ctl2.sensors.com[0]!, ctl2.sensors.com[2]!);
// ★ 用户："抬腿前什么外部力也没有；公式化把腿移到固定位置后，持续注入基础力"
//   → 摆腿不写任何伺服（无外部力，自由悬挂）；只有支撑柱（基础力）在注入
console.log(`④ 初始态就位。com=(x${(ctl2.sensors.com[0]! * 100).toFixed(1)},z${(ctl2.sensors.com[2]! * 100).toFixed(1)})cm fzL=${ctl2.sensors.feet[0]!.fz.toFixed(0)} fzR=${ctl2.sensors.feet[1]!.fz.toFixed(0)} roll=${(ctl2.sensors.torsoTilt[1]! * DEG).toFixed(1)}°`);

// ⑤ 判决（每帧注入支撑柱写手=基础力+回正）
const STEPCTX: PhaseCtx = { sensors: ctl2.sensors, bal: ctl2.warner, body: w.body };
let fall = -1, peakRoll = 0, peakPitch = 0;
const N = Math.round(HOLD / w.dt);
const SETTLE_N = Math.round(Number(ENV.SETTLE ?? 0.5) / w.dt);   // 洗掉初帧冲击（0.25s→0.5s）
let c0z = 0, c0x = 0;
const plog = String(ENV.PLOG ?? '0') === '1' ? ((globalThis as { __PROPLOG?: Array<[number, string, number, string]> }).__PROPLOG = []) : null;
const diHL2 = w.body.dofByName('hip_l', 2), diHR2 = w.body.dofByName('hip_r', 2);
const diKR0 = w.body.dofByName('knee_r', 0), diFR0 = w.body.dofByName('foot_r', 0), diFR2 = w.body.dofByName('foot_r', 2);   // 静置窗：接触落定（消传送冲击尖峰）
setLiftDone(true);                                  // 视为"抬腿已完成"
c0z = ctl2.sensors.com[2]!; c0x = ctl2.sensors.com[0]!;   // 严格判据基准（初态）
captureSupportPose(STEPCTX, 'r');                   // 捕获支撑姿态 θ₀（无动作时缺此步）
swingColumnReset();                                 // ★ 用户：抬腿结束后立刻注入基础力（摆腿也吃基础力）
const CLEAN = String(ENV.CLEAN ?? '0') === '1';
if (CLEAN) supportCleanReset();                     // ★ 骨架版（真常值力矩+单向阻尼）
// ★ 用户："基础力要能始终维持初态"——冻结窗末（完美初态帧）逐轴对账：需求(原始式，符号=执行器取反) vs 实际出力
const settleLedger = (): void => {
  const sfx = '_r';
  const excl = new Set(['thigh', 'shin', 'foot', 'arch', 'mfoot'].map((q) => `${q}${sfx}`));
  console.log('══ 初态对账（需求原始式=执行器取反；差额=执行器需求−实际）══');
  for (const [jn, ax] of [['hip', 0], ['hip', 2], ['knee', 0], ['knee', 2], ['foot', 0], ['foot', 2]] as Array<[string, number]>) {
    const di = w.body.dofByName(`${jn}${sfx}`, ax);
    if (di < 0) continue;
    const d0 = w.body.dofs[di]!;
    const u = d0.axisWorld, a0 = d0.anchorWorld;
    let tau = 0;
    for (const [kk, bi] of w.body.indexByKey.entries()) {
      if (excl.has(kk)) continue;
      const rb = w.body.bodies[bi]!;
      const c = rb.worldCom();
      const Fy = rb.mass() * w.world.gravity.y;
      tau += u[0]! * (-(c.z - a0[2]!) * Fy) + u[2]! * ((c.x - a0[0]!) * Fy);
    }
    const need = -tau;   // 执行器口径需求
    const app = d0.engineMotor ? (d0.motorTqEst ?? 0) : w.executor.appliedOf(di);
    console.log(`  ${`${jn}${sfx}/${ax}`.padEnd(9)} 需求=${need.toFixed(1).padStart(7)}  实际=${app.toFixed(1).padStart(7)}  差额=${(need - app).toFixed(1).padStart(7)}`);
  }
  // ★ 用户："还得看看脊柱"——脊柱链逐段需求（上方体段静矩；人体口径对照）
  const UP = ['spine1', 'spine2', 'spine3', 'spine4', 'torso', 'head', 'arm_l', 'arm_r', 'hand_l', 'hand_r'];
  for (const [jn, ax] of [['spine1', 0], ['spine1', 2], ['spine2', 0], ['spine2', 2], ['spine3', 0], ['spine3', 2]] as Array<[string, number]>) {
    const di = w.body.dofByName(jn, ax);
    if (di < 0) continue;
    const d0 = w.body.dofs[di]!;
    const u = d0.axisWorld, a0 = d0.anchorWorld;
    const below = UP.slice(0, UP.indexOf(jn));   // 该关节之下的体段不计（载荷=上方）
    let tau = 0;
    for (const [kk, bi] of w.body.indexByKey.entries()) {
      if (below.includes(kk)) continue;
      if (!UP.includes(kk)) continue;
      const rb = w.body.bodies[bi]!;
      const cC = rb.worldCom();
      const Fy = rb.mass() * w.world.gravity.y;
      tau += u[0]! * (-(cC.z - a0[2]!) * Fy) + u[2]! * ((cC.x - a0[0]!) * Fy);
    }
    const need = -tau;
    const app = d0.engineMotor ? (d0.motorTqEst ?? 0) : w.executor.appliedOf(di);
    console.log(`  ${`${jn}/${ax}`.padEnd(9)} 需求=${need.toFixed(1).padStart(7)}  实际=${app.toFixed(1).padStart(7)}  差额=${(need - app).toFixed(1).padStart(7)}`);
  }
};
for (let s = 0; s < N; s++) {
  if (CLEAN) {
    supportClean(STEPCTX, 'r');
    supportClean(STEPCTX, 'l');
  } else {
    supportColumn(STEPCTX, 'r', w.dt);
    if (String(ENV.SWING_COL ?? '1') === '1') swingColumn(STEPCTX, 'l', w.dt);
  }
  if (s === 60 || s === 120) {
    const appOf = (n: string, ax: number): number => {
      const di = w.body.dofByName(n, ax);
      return di < 0 ? NaN : w.executor.appliedOf(di);
    };
    console.log(`DBG@${(s * w.dt).toFixed(2)}s fzR=${ctl2.sensors.feet[1]!.fz.toFixed(0)} 支用:hipR0=${appOf('hip_r', 0).toFixed(1)} 摆用:hipL2=${appOf('hip_l', 2).toFixed(1)} kneeL2=${appOf('knee_l', 2).toFixed(1)}`);
  }
  w.advance(1);
  if (s < SETTLE_N) {
    for (const rb of w.body.bodies) {
      rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }
  if (plog && s === Math.round(0.61 / w.dt)) {
    const last = (i: number): string => {
      const e = [...plog].reverse().find((x) => x[0] === i);
      return e ? `rad=${e[2].toFixed(4)}(${e[3]})` : '无';
    };
    const diS10 = w.body.dofByName('spine1', 0);
    const diS30 = w.body.dofByName('spine3', 0);
    console.log(`PLOG spine1/0[${last(diS10)}] spine3/0[${last(diS30)}] 该帧提案数=${plog.length}`);
  }
  if (s === 2) { console.log('── 刚抬完（初态原帧 t≈0.01s）──'); settleLedger(); }
  if (s === SETTLE_N) settleLedger();
  if (String(ENV.LED2 ?? '0') === '1' && s === Math.round(Number(ENV.LED2_T ?? 2.5) / w.dt)) {
    console.log(`── 自由跑账（t=${(s * w.dt).toFixed(1)}s，settle 后自然平衡）──`);
    settleLedger();
  }
  const roll = ctl2.sensors.torsoTilt[1]!, pitch = ctl2.sensors.torsoTilt[0]!;
  peakRoll = Math.max(peakRoll, Math.abs(roll));
  peakPitch = Math.max(peakPitch, Math.abs(pitch));
  // ★ 用户判据（身体状态）：前后±20° / 左右±10° / 偏移±5cm（相对初态）
  const STRICT = String(ENV.STRICT ?? '1') !== '0';
  const offZ = Math.abs(ctl2.sensors.com[2]! - c0z), offX = Math.abs(ctl2.sensors.com[0]! - c0x);
  const fallen = STRICT
    ? (Math.abs(pitch) > 0.3491 || Math.abs(roll) > 0.1745 || offZ > 0.05 || offX > 0.05 || ctl2.sensors.com[1]! < 0.75)
    : (Math.abs(pitch) > Math.PI / 4 || Math.abs(roll) > Math.PI / 4 || ctl2.sensors.com[1]! < 0.75);
  if (fallen) {
    fall = (s + 1) * w.dt;
    const why: string[] = [];
    if (Math.abs(pitch) > 0.3491) why.push(`pitch=${(pitch * DEG).toFixed(1)}°`);
    if (Math.abs(roll) > 0.1745) why.push(`roll=${(roll * DEG).toFixed(1)}°`);
    if (offZ > 0.05) why.push(`offZ=${(offZ * 100).toFixed(1)}cm`);
    if (offX > 0.05) why.push(`offX=${(offX * 100).toFixed(1)}cm`);
    if (ctl2.sensors.com[1]! < 0.75) why.push(`comY=${(ctl2.sensors.com[1]! * 100).toFixed(1)}cm`);
    console.log(`☠ 判死因：${why.join(' + ')}  com=(x${(ctl2.sensors.com[0]! * 100).toFixed(1)},z${(ctl2.sensors.com[2]! * 100).toFixed(1)}) c0=(x${(c0x * 100).toFixed(1)},z${(c0z * 100).toFixed(1)})`);
    break;
  }
  if (String(ENV.TRF ?? '0') === '1' && s <= Math.round(0.1 / w.dt) && s % 2 === 0) {
    const drvA = (ctl2.warner as unknown as { drive: { pairRef: Float64Array } }).drive;
    const rep = (n: string, ax: number): string => {
      const di = w.body.dofByName(n, ax);
      if (di < 0) return '--';
      const d0 = w.body.dofs[di]!;
      return `角=${(d0.angle * DEG).toFixed(1)}° ref=${(drvA.pairRef[di]! * DEG).toFixed(1)}° 力=${w.executor.appliedOf(di).toFixed(0)}`;
    };
    const yL = (w.body.bodies[idx('mfoot_l')]!.translation() as { y: number }).y;
    console.log(`tf=${(s * w.dt).toFixed(3)}s 脚高=${(yL * 100).toFixed(1)}cm 摆髋2[${rep('hip_l', 2)}] 摆膝2[${rep('knee_l', 2)}] fzL=${ctl2.sensors.feet[0]!.fz.toFixed(0)}`);
  }
  if (String(ENV.TR ?? '0') === '1' && s % Math.round(Number(ENV.TR_T ?? 0.1) / w.dt) === 0) {
    const appOf = (n: string, ax: number): number => {
      const di = w.body.dofByName(n, ax);
      return di < 0 ? NaN : w.executor.appliedOf(di);
    };
    const drvD = (ctl2.warner as unknown as { drive: { ffOf: (i: number) => number; pairRef: Float64Array; pairC: Float64Array } }).drive;
    const dec = (n: string, ax: number): string => {
      const di = w.body.dofByName(n, ax);
      if (di < 0) return '--';
      const d0 = w.body.dofs[di]!;
      return `ff=${drvD.ffOf(di).toFixed(0)} ref=${(drvD.pairRef[di]! * DEG).toFixed(1)}° c=${drvD.pairC[di]!.toFixed(2)} 角=${(d0.angle * DEG).toFixed(1)}° v=${d0.vel.toFixed(1)}`;
    };
    console.log(`DEC 摆髋2[${dec('hip_l', 2)}] 支髋2[${dec('hip_r', 2)}]`);
    console.log(
      `t=${(s * w.dt).toFixed(1)}s comY=${(ctl2.sensors.com[1]! * 100).toFixed(1)}cm cvx=${(ctl2.sensors.comVel[0]! * 100).toFixed(1)} cvz=${(ctl2.sensors.comVel[2]! * 100).toFixed(1)}cm/s com=(x${(ctl2.sensors.com[0]! * 100).toFixed(1)},z${(ctl2.sensors.com[2]! * 100).toFixed(1)}) pitch=${(pitch * DEG).toFixed(1)}° roll=${(roll * DEG).toFixed(1)}°` +
      ` 支角(h2=${(w.body.dofs[w.body.dofByName('hip_r', 2)]!.angle * DEG).toFixed(1)},k2=${(w.body.dofs[w.body.dofByName('knee_r', 2)]!.angle * DEG).toFixed(1)},k0=${(w.body.dofs[w.body.dofByName('knee_r', 0)]!.angle * DEG).toFixed(1)},f0=${(w.body.dofs[w.body.dofByName('foot_r', 0)]!.angle * DEG).toFixed(1)},f2=${(w.body.dofs[w.body.dofByName('foot_r', 2)]!.angle * DEG).toFixed(1)})` +
      ` 支力(hip0=${appOf('hip_r', 0).toFixed(0)},hip2=${appOf('hip_r', 2).toFixed(0)},knee2=${appOf('knee_r', 2).toFixed(0)},foot0=${appOf('foot_r', 0).toFixed(0)},foot2=${appOf('foot_r', 2).toFixed(0)})` +
      ` 摆力(hip2=${appOf('hip_l', 2).toFixed(0)},knee2=${appOf('knee_l', 2).toFixed(0)}) fzL=${ctl2.sensors.feet[0]!.fz.toFixed(0)} fzR=${ctl2.sensors.feet[1]!.fz.toFixed(0)}` +
      ` 支脚=(x${(ctl2.sensors.feet[1]!.x * 100).toFixed(1)},z${(ctl2.sensors.feet[1]!.z * 100).toFixed(1)}) CoP=(x${(ctl2.sensors.feet[1]!.copX * 100).toFixed(1)},z${(ctl2.sensors.feet[1]!.copZ * 100).toFixed(1)},${ctl2.sensors.feet[1]!.copValid ? 'v' : '-'})`
    );
  }
}
console.log(`判决：${fall < 0 ? `站住 ${HOLD}s ✓` : `倒下 @${fall.toFixed(2)}s ✗`}  |roll|峰=${(peakRoll * DEG).toFixed(1)}° |pitch|峰=${(peakPitch * DEG).toFixed(1)}°`);
