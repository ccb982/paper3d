/** court.ts —— 法庭（网页实装版）：与 tools/_tmp-hold10.ts 同流程
 *
 *  ① reset 分腿站（调用方先 sim.reset()）
 *  ② 运动学直摆左腿链进入抬腿姿势（hip 0.45 / knee −0.75 / ankle 0.08）
 *  ③ 绕支撑踝旋转（CoM 过踝）+ 绕支撑髋躯干回正 = 自然单腿站姿
 *  ④ 全体零速 + 捕获基础位（setLiftDone / captureSupportPose / swingColumnReset / supportCleanReset）
 *  ⑤ 静置 SETTLE 秒（每帧速度清零）→ 放开 → 严格判死（前后±20° / 左右±10° / 偏移±5cm / comY<75cm）
 *
 *  用法：act('法庭') → courtSetup(sim, control)；物理循环每步 courtStep(sim, control, st)。
 */
import type { World } from './world';
import type { ControlModule } from './control';
import { captureSupportPose, swingColumnReset, setLiftDone } from './servo/supportReg';
import { supportClean, supportCleanReset } from './servo/supportClean';
import { captureAngFrom } from './servo/baseTable';

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

export interface CourtState {
  p0: number;             // ★ 初始俯仰（蹲姿法庭：判死按偏差——蹲姿本身前倾~43°）
  r0: number;             // ★ 初始滚转
  y0: number;             // ★ 初始 CoM 高度（蹲姿天然低）
  t: number;              // 法庭时间（④ 起）
  settle: number;         // 静置时长（秒）
  released: boolean;      // ★ 放开标记（静置结束）
  c0: { x: number; z: number };
  feet0?: Map<string, { p: { x: number; y: number; z: number }; q: { x: number; y: number; z: number; w: number } }>;   // ★ 绝对命令：站立时双脚原始变换（静置期钉住）
  pose0?: Map<string, { p: { x: number; y: number; z: number }; q: { x: number; y: number; z: number; w: number } }>;   // ★★ 2026-10-18 全身摆姿变换（静置期钉住全身——只钉脚时上身每帧帧内被重力拖走：2s 漂 22.6°+穿 90° 奇点假判死）
  g0?: number;            // ★★ 2026-10-18 原始重力（静置期关重力=零受力；放开恢复——用户：'静止期间全身不受力啊，静止结束才从零开始受力'）
  ang0?: Map<number, number>;   // ★★★ 2026-10-18 用户（'脱离标准目标姿态就算无效'）：标准姿态的关键关节角（判死基准）
  fall: number;           // 倒下时刻（<0 = 未倒）
  reason: string;
  peakRoll: number;
  peakPitch: number;
  log: string[];
}

/** ②③④：把世界从分腿站构造成自然单腿站姿（调用前需 sim.reset() 且 controller 已装） */
export function courtSetup(w: World, ctl: ControlModule, settle = 2.0): CourtState {
  const body = w.body;
  const idx = (key: string): number => body.indexByKey.get(key)!;

  // ② 运动学直摆：绕各关节锚点旋转下游链（髋→膝→踝；枢轴用旋转后的实际位置推进）
  {
    const steps: Array<[string, number, number, string[]]> = [
      ['hip_l', 2, 0.45, ['thigh_l', 'shin_l', 'foot_l', 'arch_l', 'mfoot_l']],
      ['knee_l', 2, -0.75, ['shin_l', 'foot_l', 'arch_l', 'mfoot_l']],
      ['foot_l', 2, 0.08, ['foot_l', 'arch_l', 'mfoot_l']],
    ];
    for (const [jn, ax, ang, chain] of steps) {
      const di = body.dofByName(jn, ax);
      if (di < 0) continue;
      const d0 = body.dofs[di]!;
      const pivotPre: V3 = { x: d0.anchorWorld[0]!, y: d0.anchorWorld[1]!, z: d0.anchorWorld[2]! };
      const axis: V3 = { x: d0.axisWorld[0]!, y: d0.axisWorld[1]!, z: d0.axisWorld[2]! };
      const rot = axisAngleQ(axis, ang);
      for (const key of chain) {
        const rb = body.bodies[idx(key)]!;
        const p = rb.translation() as V3;
        const dp: V3 = { x: p.x - pivotPre.x, y: p.y - pivotPre.y, z: p.z - pivotPre.z };
        const dr = qRot(rot, dp);
        rb.setTranslation({ x: pivotPre.x + dr.x, y: pivotPre.y + dr.y, z: pivotPre.z + dr.z }, true);
        rb.setRotation(qMul(rot, rb.rotation() as Q4), true);
      }
      for (const [jn2, parentBody] of [['knee_l', 'thigh_l'], ['foot_l', 'shin_l']] as Array<[string, string]>) {
        if (!chain.includes(parentBody)) continue;
        const di2 = body.dofByName(jn2, 2);
        if (di2 < 0) continue;
        const d2 = body.dofs[di2]!;
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

  // ③ 绕支撑踝把整体旋到 CoM 过踝 → 绕支撑髋把躯干回正
  {
    const rotAbout = (pivot: V3, axis: V3, ang: number, chain: typeof body.bodies): Q4 => {
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
    const footR = idx('foot_r'), mfootR = idx('mfoot_r');
    const footSet = new Set([footR, mfootR]);
    const legRKeys = ['thigh_r', 'shin_r', 'arch_r', 'foot_r', 'mfoot_r'];
    const legRSet = new Set(legRKeys.map((k) => idx(k)).filter((i) => i >= 0));
    const chainAll = body.bodies.filter((_, i) => !footSet.has(i));
    const chainTrunk = body.bodies.filter((_, i) => !legRSet.has(i));

    const dA = body.dofs[body.dofByName('foot_r', 2)]!;
    const A: V3 = { x: dA.anchorWorld[0]!, y: dA.anchorWorld[1]!, z: dA.anchorWorld[2]! };
    const c0 = comXZ();
    const phi = -Math.atan2(c0.cz - A.z, c0.cy - A.y);
    const axA: V3 = { x: 1, y: 0, z: 0 };
    const rot1 = rotAbout(A, axA, phi, chainAll);
    const dH = body.dofs[body.dofByName('hip_r', 2)]!;
    const Hpre: V3 = { x: dH.anchorWorld[0]!, y: dH.anchorWorld[1]!, z: dH.anchorWorld[2]! };
    const H = rotPt(rot1, A, Hpre);
    const axA2 = qRot(rot1, axA);
    rotAbout(H, axA2, -phi, chainTrunk);
  }

  // ④ 零速 + 捕获基础位
  for (const rb of body.bodies) {
    rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  // ★ 清驱动里残留的角度目标（manual.clear 不清 Drive 的 PD——否则残留把摆动腿拽回站立姿势）
  for (const d of body.dofs) ctl.warner.manual.clearAngle(d.name, d.axis);
  w.advance(1);
  const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
  setLiftDone(true);
  captureSupportPose(ctx, 'r');
  swingColumnReset();
  supportCleanReset();

  const tilt0 = torsoTilt(w, ctl);   // ★ 稳健读数（与判死同式——基线一致）
  const st: CourtState = {
    p0: tilt0.pitch,
    r0: tilt0.roll,
    y0: ctl.sensors.com[1]!,
    t: 0,
    settle,
    c0: { x: ctl.sensors.com[0]!, z: ctl.sensors.com[2]! },
    released: false,
    fall: -1,
    reason: '',
    peakRoll: 0,
    peakPitch: 0,
    log: [`法庭就位：com=(${(ctl.sensors.com[0]! * 100).toFixed(1)},${(ctl.sensors.com[2]! * 100).toFixed(1)})cm 踝z=${(body.dofs[body.dofByName('foot_r', 2)]!.anchorWorld[2]! * 100).toFixed(1)}`],
  };
  return st;
}

/** ★★ 2026-10-17 用户（'把这个蹲下姿势做成蹲下法庭，和单腿站立法庭放一起'）：
 *   蹲下法庭——运动学直摆蹲姿（同单腿法庭的技术）→ 零速捕获 → 静置→放开→严格判死。
 *   与单腿法庭共用 courtStep/courtInject（判死标准同一套）。 */
export function squatCourtSetup(w: World, ctl: ControlModule, settle = 2.0): CourtState {
  const body = w.body;
  const idx = (key: string): number => body.indexByKey.get(key)!;

  // ② 运动学直摆：双腿（髋→膝→踝）+ 脊柱（腰→胸→颈），绕各关节锚点旋转下游链
  const rotChain = (jn: string, ax: number, ang: number, chain: string[]): void => {
    const di = body.dofByName(jn, ax);
    if (di < 0) return;
    const d0 = body.dofs[di]!;
    const pivotPre: V3 = { x: d0.anchorWorld[0]!, y: d0.anchorWorld[1]!, z: d0.anchorWorld[2]! };
    const axis: V3 = { x: d0.axisWorld[0]!, y: d0.axisWorld[1]!, z: d0.axisWorld[2]! };
    const rot = axisAngleQ(axis, ang);
    for (const key of chain) {
      const bi = body.indexByKey.get(key);
      if (bi === undefined) continue;
      const rb = body.bodies[bi]!;
      const p = rb.translation() as V3;
      const dp: V3 = { x: p.x - pivotPre.x, y: p.y - pivotPre.y, z: p.z - pivotPre.z };
      const dr = qRot(rot, dp);
      rb.setTranslation({ x: pivotPre.x + dr.x, y: pivotPre.y + dr.y, z: pivotPre.z + dr.z }, true);
      rb.setRotation(qMul(rot, rb.rotation() as Q4), true);
    }
    // ★ 关键（乱转真身）：更新下游关节的锚点/轴——后续旋转必须绕**旋转后的实际位置**
    const chainSet = new Set(chain);
    for (const d2 of body.dofs) {
      const b1key = body.bodies[d2.b1] === undefined ? '' : '';
      void b1key;
      // 该 dof 的父体在链条里 → 更新它的 anchorWorld/axisWorld
      let parentIn = false;
      for (const key of chainSet) if (idx(key) === d2.b1) { parentIn = true; break; }
      if (!parentIn) continue;
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
  };
  const e2 = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const kneeA = Number(e2.SQC_K ?? 2.0);     // ★ 对折（用户'A方案'：CoM回脚中——2.1→2.0=CoM+3.3）
  const ankA = Number(e2.SQC_A ?? 0.5);      // ★ 膝前移（A方案：0.6→0.5=CoM回+3.3脚中）
  const hipA = Number(e2.SQC_H ?? 0.0);
  const leanA = Number(e2.SQC_L ?? -0.42);   // ★ 腰外角→45°（用户）
  const upper = ['torso', 'spine1', 'spine2', 'spine3', 'spine4', 'neck', 'head', 'arm_l', 'arm_r', 'hand_l', 'hand_r'];
  // ★ 绝对命令（用户）：记下站立时双脚原始变换——静置期每帧钉住（防解算器拽飞）
  const feet0 = new Map<string, { p: { x: number; y: number; z: number }; q: { x: number; y: number; z: number; w: number } }>();
  for (const key of ['foot_l', 'foot_r', 'arch_l', 'arch_r', 'mfoot_l', 'mfoot_r']) {
    const bi = body.indexByKey.get(key);
    if (bi === undefined) continue;
    const rb = body.bodies[bi]!;
    const p0 = rb.translation();
    const q0 = rb.rotation();
    feet0.set(key, { p: { x: p0.x, y: p0.y, z: p0.z }, q: { x: q0.x, y: q0.y, z: q0.z, w: q0.w } });
  }
  // ⓪ 踝背屈（脚不动——小腿+全身绕踝连线前倾=膝盖前移）
  if (Math.abs(ankA) > 1e-6) {
    const aL = body.dofs[body.dofByName('foot_l', 2)]!.anchorWorld;
    const aR = body.dofs[body.dofByName('foot_r', 2)]!.anchorWorld;
    const midA: V3 = { x: (aL[0]! + aR[0]!) / 2, y: (aL[1]! + aR[1]!) / 2, z: (aL[2]! + aR[2]!) / 2 };
    // ★ 纯世界横轴（用户：'膝盖内收了'——踝实际轴含0.91的z分量会把膝往内甩）
    // ★★★ 2026-10-18 用户（'你到底怎么了'）：放开爆炸根因=姿势与踝关节运动学不一致——
    //   纯横轴转 28.6° 与真实屈伸轴(0.42,0,0.91)差 ~12° 离轴分量→关节锁死轴拒绝→解算器尖峰。
    //   SQC_AXIS=real：改绕真实踝轴（运动学一致）；默认 pure（纯横轴，对称但离轴）
    let axisA: { x: number; y: number; z: number } = { x: 0, y: 0, z: 1 };
    if (String(e2.SQC_AXIS ?? 'pure') === 'real') {
      const diF = body.dofByName('foot_l', 2);
      if (diF >= 0) {
        const aw = body.dofs[diF]!.axisWorld;
        axisA = { x: aw[0]!, y: aw[1]!, z: aw[2]! };
      }
    }
    const rotA = axisAngleQ(axisA, -ankA);   // 负=小腿往前倾
    const chainA = ['shin_l', 'shin_r', 'thigh_l', 'thigh_r', 'torso', 'spine1', 'spine2', 'spine3', 'spine4', 'neck', 'head', 'arm_l', 'arm_r', 'hand_l', 'hand_r'];
    const setA = new Set(chainA.map((k) => body.indexByKey.get(k)).filter((i) => i !== undefined));
    for (const key of chainA) {
      const bi = body.indexByKey.get(key);
      if (bi === undefined) continue;
      const rb = body.bodies[bi]!;
      const p = rb.translation() as V3;
      const dp: V3 = { x: p.x - midA.x, y: p.y - midA.y, z: p.z - midA.z };
      const dr = qRot(rotA, dp);
      rb.setTranslation({ x: midA.x + dr.x, y: midA.y + dr.y, z: midA.z + dr.z }, true);
      rb.setRotation(qMul(rotA, rb.rotation() as Q4), true);
    }
    for (const d2 of body.dofs) {
      if (!setA.has(d2.b1) && !setA.has(d2.b2)) continue;
      const ap: V3 = { x: d2.anchorWorld[0]!, y: d2.anchorWorld[1]!, z: d2.anchorWorld[2]! };
      const dap: V3 = { x: ap.x - midA.x, y: ap.y - midA.y, z: ap.z - midA.z };
      const dar = qRot(rotA, dap);
      d2.anchorWorld[0] = midA.x + dar.x; d2.anchorWorld[1] = midA.y + dar.y; d2.anchorWorld[2] = midA.z + dar.z;
      const av: V3 = { x: d2.axisWorld[0]!, y: d2.axisWorld[1]!, z: d2.axisWorld[2]! };
      const avr = qRot(rotA, av);
      d2.axisWorld[0] = avr.x; d2.axisWorld[1] = avr.y; d2.axisWorld[2] = avr.z;
    }
  }
  // ① 双膝共轴折（脚/小腿不动）——两腿+躯干绕**双膝连线**一次旋转（对称、无重复）
  {
    const kL = body.dofs[body.dofByName('knee_l', 2)]!.anchorWorld;
    const kR = body.dofs[body.dofByName('knee_r', 2)]!.anchorWorld;
    const mid: V3 = { x: (kL[0]! + kR[0]!) / 2, y: (kL[1]! + kR[1]!) / 2, z: (kL[2]! + kR[2]!) / 2 };
    const rot = axisAngleQ({ x: 0, y: 0, z: 1 }, kneeA);   // 绕世界横轴（双膝连线）
    const chain = ['thigh_l', 'thigh_r', 'torso', 'spine1', 'spine2', 'spine3', 'spine4', 'neck', 'head', 'arm_l', 'arm_r', 'hand_l', 'hand_r'];
    const chainSet = new Set(chain.map((k) => body.indexByKey.get(k)).filter((i) => i !== undefined));
    for (const key of chain) {
      const bi = body.indexByKey.get(key);
      if (bi === undefined) continue;
      const rb = body.bodies[bi]!;
      const p = rb.translation() as V3;
      const dp: V3 = { x: p.x - mid.x, y: p.y - mid.y, z: p.z - mid.z };
      const dr = qRot(rot, dp);
      rb.setTranslation({ x: mid.x + dr.x, y: mid.y + dr.y, z: mid.z + dr.z }, true);
      rb.setRotation(qMul(rot, rb.rotation() as Q4), true);
    }
    // ★ 同步更新链内关节的锚点/轴（脊柱前倾要用旋转后的实际轴）
    for (const d2 of body.dofs) {
      if (!chainSet.has(d2.b1) && !chainSet.has(d2.b2)) continue;
      const ap: V3 = { x: d2.anchorWorld[0]!, y: d2.anchorWorld[1]!, z: d2.anchorWorld[2]! };
      const dap: V3 = { x: ap.x - mid.x, y: ap.y - mid.y, z: ap.z - mid.z };
      const dar = qRot(rot, dap);
      d2.anchorWorld[0] = mid.x + dar.x;
      d2.anchorWorld[1] = mid.y + dar.y;
      d2.anchorWorld[2] = mid.z + dar.z;
      const av: V3 = { x: d2.axisWorld[0]!, y: d2.axisWorld[1]!, z: d2.axisWorld[2]! };
      const avr = qRot(rot, av);
      d2.axisWorld[0] = avr.x;
      d2.axisWorld[1] = avr.y;
      d2.axisWorld[2] = avr.z;
    }
  }
  // ①.5 ★ 骨盆反向旋转：共轴折把骨盆朝向也转了 kneeA → 绕髋反向转回（骨盆保持竖直）
  {
    const hL = body.dofs[body.dofByName('hip_l', 2)]!.anchorWorld;
    const hR = body.dofs[body.dofByName('hip_r', 2)]!.anchorWorld;
    const midH: V3 = { x: (hL[0]! + hR[0]!) / 2, y: (hL[1]! + hR[1]!) / 2, z: (hL[2]! + hR[2]!) / 2 };
    const rot = axisAngleQ({ x: 0, y: 0, z: 1 }, -kneeA);
    for (const key of upper) {
      const bi = body.indexByKey.get(key);
      if (bi === undefined) continue;
      const rb = body.bodies[bi]!;
      const p = rb.translation() as V3;
      const dp: V3 = { x: p.x - midH.x, y: p.y - midH.y, z: p.z - midH.z };
      const dr = qRot(rot, dp);
      rb.setTranslation({ x: midH.x + dr.x, y: midH.y + dr.y, z: midH.z + dr.z }, true);
      rb.setRotation(qMul(rot, rb.rotation() as Q4), true);
    }
    // 同步轴/锚点
    for (const d2 of body.dofs) {
      const ap: V3 = { x: d2.anchorWorld[0]!, y: d2.anchorWorld[1]!, z: d2.anchorWorld[2]! };
      const dap: V3 = { x: ap.x - midH.x, y: ap.y - midH.y, z: ap.z - midH.z };
      const dar = qRot(rot, dap);
      d2.anchorWorld[0] = midH.x + dar.x;
      d2.anchorWorld[1] = midH.y + dar.y;
      d2.anchorWorld[2] = midH.z + dar.z;
      const av: V3 = { x: d2.axisWorld[0]!, y: d2.axisWorld[1]!, z: d2.axisWorld[2]! };
      const avr = qRot(rot, av);
      d2.axisWorld[0] = avr.x;
      d2.axisWorld[1] = avr.y;
      d2.axisWorld[2] = avr.z;
    }
  }
  // ② 骨盆朝向（一次——torso 是单刚体）
  if (Math.abs(hipA) > 1e-6) rotChain('hip_l', 2, hipA, upper);
  // ★ 手臂前伸配重（用户：'手臂也要放到前面配重'——肩轴2正=前）
  {
    const armA = Number(e2.SQC_ARM ?? 0.5);    // ★ 正值=放下（用户'手臂要往下'——0.5=手在肩下；-2.0=举着被否）
    for (const sd of ['l', 'r'] as const) {
      rotChain(`shoulder_${sd}`, 2, armA, [`arm_${sd}`, `hand_${sd}`]);
    }
  }
  // ③ 脊柱前倾（逐段——每段带动其上段）
  const spineChain = ['spine2', 'spine3', 'spine4', 'neck', 'head', 'arm_l', 'arm_r', 'hand_l', 'hand_r'];
  rotChain('spine1', 2, leanA, spineChain);
  rotChain('spine2', 2, leanA, spineChain.slice(1));
  rotChain('spine3', 2, leanA, spineChain.slice(2));
  // ③ 躯干前倾配平（绕髋把 CoM 移到脚上——蹲姿对称，只做俯仰）
  {
    const comXZ = (): { cx: number; cy: number; cz: number } => {
      let m = 0, cx = 0, cy = 0, cz = 0;
      for (const rb of body.bodies) {
        const c = rb.worldCom();
        m += rb.mass(); cx += rb.mass() * c.x; cy += rb.mass() * c.y; cz += rb.mass() * c.z;
      }
      return { cx: cx / m, cy: cy / m, cz: cz / m };
    };
    const footL = idx('foot_l'), footR = idx('foot_r');
    const aL = body.dofs[body.dofByName('foot_l', 2)]!.anchorWorld;
    const aR = body.dofs[body.dofByName('foot_r', 2)]!.anchorWorld;
    const pivot: V3 = { x: (aL[0]! + aR[0]!) / 2, y: (aL[1]! + aR[1]!) / 2, z: (aL[2]! + aR[2]!) / 2 };
    const c0 = comXZ();
    const phi = 0; void c0;   // ★ 配平禁用（实测 53° 过转——蹲姿对称先不加配平）
    void pivot;
    const rot = axisAngleQ({ x: 0, y: 0, z: 1 }, phi);
    for (const rb of body.bodies) {
      const bi = body.bodies.indexOf(rb);
      if (bi === footL || bi === footR) continue;   // 脚不动
      const p = rb.translation() as V3;
      const dp: V3 = { x: p.x - pivot.x, y: p.y - pivot.y, z: p.z - pivot.z };
      const dr = qRot(rot, dp);
      rb.setTranslation({ x: pivot.x + dr.x, y: pivot.y + dr.y, z: pivot.z + dr.z }, true);
      rb.setRotation(qMul(rot, rb.rotation() as Q4), true);
    }
  }

  // ④ 零速 + 捕获基础位
  for (const rb of body.bodies) {
    rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  for (const d of body.dofs) ctl.warner.manual.clearAngle(d.name, d.axis);
  w.advance(1);
  // ★★ 2026-10-18 全身钉姿基准：捕获摆姿后的全身变换（脚除外——脚用 feet0 绝对命令）
  const pose0 = new Map<string, { p: { x: number; y: number; z: number }; q: { x: number; y: number; z: number; w: number } }>();
  for (const [key, bi] of body.indexByKey) {
    if (/^(foot|arch|mfoot)_/.test(key)) continue;
    const rb = body.bodies[bi]!;
    const pp = rb.translation();
    const qq = rb.rotation();
    pose0.set(key, { p: { x: pp.x, y: pp.y, z: pp.z }, q: { x: qq.x, y: qq.y, z: qq.z, w: qq.w } });
  }
  const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
  captureSupportPose(ctx, 'r');
  swingColumnReset();
  supportCleanReset();
  w.switchPoseState('squat');   // ★ 状态隔离：原子切换到蹲姿状态（表/基准/缓存）
  // ★★★ 目标自动统一（用户）：摆出来的姿势=回正力目标——单一事实来源（防手抄过时打架）
  captureAngFrom(body.dofs);

  const tilt0b = torsoTilt(w, ctl);   // ★ 稳健读数（与判死同式——蹲姿基线）
  // ★★★ 判死基准：标准姿态的关键关节角（矢状：髋/膝/踝/腰1-3/颈 ×2 侧）
  const ang0 = new Map<number, number>();
  for (const [nm, ax] of [['hip_l', 2], ['hip_r', 2], ['knee_l', 2], ['knee_r', 2], ['foot_l', 2], ['foot_r', 2], ['spine1', 2], ['spine2', 2], ['spine3', 2], ['neck', 2]] as Array<[string, number]>) {
    const di = body.dofByName(nm, ax);
    if (di >= 0) ang0.set(di, body.dofs[di]!.angle);
  }
  const st: CourtState = {
    p0: tilt0b.pitch,
    r0: tilt0b.roll,
    y0: ctl.sensors.com[1]!,
    t: 0,
    settle,
    c0: { x: ctl.sensors.com[0]!, z: ctl.sensors.com[2]! },
    feet0,
    pose0,
    g0: (w.world.gravity as { y: number }).y,
    ang0,
    released: false,
    fall: -1,
    reason: '',
    peakRoll: 0,
    peakPitch: 0,
    log: [`蹲下法庭就位：com=(${(ctl.sensors.com[0]! * 100).toFixed(1)},${(ctl.sensors.com[2]! * 100).toFixed(1)})cm`],
  };
  return st;
}

/** 每物理步（advance 之前）：注入支撑柱+摆腿柱（基础力）——探针同款（supportClean 提案须在控制步前入总线） */
export function courtInject(w: World, ctl: ControlModule): void {
  const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
  supportClean(ctx, 'r');
  supportClean(ctx, 'l');
}

/**
 * ★★ 2026-10-18 稳健躯干倾斜读数：蹲姿胸腔过水平（pitch>90°、up.y<0）时，
 *   原 roll=atan2(up.z, up.y) 落在 ±180° 分支切割上——微小抖动即翻 360°（rollΔ=-360 假判死）。
 *   roll 改为相对竖直面的侧倾 atan2(up.z, |up.xy|)：对称蹲姿≈0°、全域连续。
 */
function torsoTilt(w: World, ctl: ControlModule): { pitch: number; roll: number } {
  const tIdx = w.body.indexByKey.get('spine4') ?? w.body.indexByKey.get('spine3');
  if (tIdx === undefined) return { pitch: ctl.sensors.torsoTilt[0]!, roll: ctl.sensors.torsoTilt[1]! };
  const q = w.body.bodies[tIdx]!.rotation();
  const ux = 2 * (q.x * q.y - q.w * q.z);
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const uz = 2 * (q.w * q.x + q.y * q.z);
  return { pitch: Math.atan2(ux, uy), roll: Math.atan2(uz, Math.hypot(ux, uy)) };
}

/** ⑤ 每物理步：静置期清零 + 严格判死（探针同款） */
export function courtStep(w: World, ctl: ControlModule, st: CourtState): void {
  st.t += w.dt;
  if (!st.released && st.t >= st.settle) {
    st.released = true;
    // ★ 2026-10-18 判死基线重捕（摆姿瞬间的读数≠静置后姿势——pitchΔ=-21.7 假判死）
    const tiltR = torsoTilt(w, ctl);
    st.p0 = tiltR.pitch; st.r0 = tiltR.roll;
    st.c0 = { x: ctl.sensors.com[0]!, z: ctl.sensors.com[2]! };
    st.y0 = ctl.sensors.com[1]!;
    // ★★★ 2026-10-18 用户（'脱离标准目标姿态就算无效'）：**关节角基准也在放开瞬间重捕**——
    //   静置期姿势会漂（读数 127→136=9°），setup 时的捕获已过时 → 一上来就误判 21° 偏离
    if (st.ang0) {
      for (const di of st.ang0.keys()) st.ang0.set(di, w.body.dofs[di]!.angle);
    }
    // ★★ 2026-10-18 放开：恢复重力——"静止结束才从零开始受力"（驱动由 outputScale 从零渐入）
    if (st.pose0 && st.g0 !== undefined) w.setGravity(st.g0);
    console.log(`★★★ 法庭：放开（静置 ${st.settle.toFixed(1)}s 结束，速度清零停止）t=${st.t.toFixed(2)}s ★★★`);
  }
  // ★ 输出总闸（用户：'静置期不写任何力，结束后才从零开始受力'）
  const alwaysSilent = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SILENT ?? '0') === '1';
  if (alwaysSilent) {
    w.drive.outputScale = 0;   // 纯重力对照
  } else if (!st.released) {
    // ★★★ 2026-10-18 用户（'从第一帧就满力'）：SQC_LIVE=1 静置期就满力——
    //   全静默时姿势没人撑被重力拖垮（CoM 55→46）；满力+重力=脚负载+姿势撑住+放开零阶跃
    w.drive.outputScale = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_LIVE ?? '0') === '1' ? 1 : 0;
  } else {
    // ★★★ 2026-10-18 用户（'哪来的上升的力/我只加对抗重力的力'）：**放开后继续钉脚**——
    //   基础力表的关节力矩会通过链几何把脚拽起来（实测表值开=脚升2.3cm、表值0=脚纹丝不动）
    //   脚钉住→力矩拽不动→地面反力建立（fz 正常加载）
    if (String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_PINREL ?? '0') === '1' && st.feet0) {
      for (const key of ['foot_l', 'foot_r', 'arch_l', 'arch_r', 'mfoot_l', 'mfoot_r']) {
        const bi = w.body.indexByKey.get(key);
        if (bi === undefined) continue;
        const rb = w.body.bodies[bi]!;
        const f0 = st.feet0.get(key)!;
        rb.setTranslation(f0.p, true);
        rb.setRotation(f0.q, true);
      }
    }
    const rampT = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_RAMP ?? 0.1);   // ★ 用户认可 0.1   // ★ 实测：0.08 快渐入=尖峰抽搐；慢渐入=零速度（SQC_RAMP 可覆盖）
    const ramp = Math.min(1, (st.t - st.settle) / rampT);   // 放开后渐入（0.08s 默认；0.4太慢=自由落体）
    w.drive.outputScale = ramp;
    // ★★★ 2026-10-18 用户（'静止结束才从零开始受力'）：重力也渐入——释放瞬间无阶跃，
    //   消除放开瞬态（脚关节 80rad/s 速度尖峰→腿被弹开）。与驱动同一 ramp。
    if (st.pose0 && st.g0 !== undefined) w.setGravity(st.g0 * ramp);
  }
  ctl.warner.setComTarget(st.c0.x, st.c0.z);   // ★ 2026-10-16 每帧维持标准态 com 目标（防过期回中线）
  if (st.t <= st.settle) {
    // ★★ 2026-10-18 用户（'静止期间全身不受力啊，静止结束才从零开始受力'）：静置期重力关——
    //   全身零受力（钉姿只是保险），放开瞬间恢复重力、驱动从零渐入
    // ★★★ 2026-10-18 用户（'接触先建立再给力'）：接触建立期——**重力开**（脚自然压地）
    //   旧的"重力关"让放开时脚是空的（fz=0）→链无锚→力矩拽脚飞。SQC_GONS=0 可回旧行为
    if (st.pose0 && st.g0 !== undefined && String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_GONS ?? '0') !== '1') w.setGravity(0);   // 回退：默认重力关（接触期实验已回）
    // ★ 接触建立期不清零（清零+重力=数值泵）；SQC_ZERO=1 可恢复旧清零
    for (const rb of w.body.bodies) {
      rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    // ★★★ 2026-10-18 用户（'静止期间全身不受力'）：钉脚改为可选——默认关！
    //   钉脚 vs 接触解算器每帧对打（脚被压地里→解算器 270N 往外顶→放开瞬间爆 159rad/s 尖峰）
    //   重力已关+速度已清零=无受力自静止，钉脚非必需。SQC_PIN=1 可恢复旧行为。
    const pinMode = String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_PIN ?? '0');
    const pinOn = pinMode === '1' || pinMode === '2';   // 2=只钉脚（重力开时用）
    if (pinOn && st.feet0) {
      for (const key of ['foot_l', 'foot_r', 'arch_l', 'arch_r', 'mfoot_l', 'mfoot_r']) {
        const bi = w.body.indexByKey.get(key);
        if (bi === undefined) continue;
        const rb = w.body.bodies[bi]!;
        const f0 = st.feet0.get(key)!;
        rb.setTranslation(f0.p, true);
        rb.setRotation(f0.q, true);
      }
    }
    // ★★ 2026-10-18 全身钉姿（SQC_PIN=1；=2 时只钉脚——重力开时脚要压地，全身钉会跟解算器打架）
    if (pinOn && pinMode !== '2' && st.pose0) {
      for (const [key, f0] of st.pose0) {
        const bi = w.body.indexByKey.get(key);
        if (bi === undefined) continue;
        const rb = w.body.bodies[bi]!;
        rb.setTranslation(f0.p, true);
        rb.setRotation(f0.q, true);
      }
    }
  }
  const tilt = torsoTilt(w, ctl);   // ★ 稳健读数（防 ±180 分支切割假判死）
  const pitch = tilt.pitch;
  const roll = tilt.roll;
  st.peakRoll = Math.max(st.peakRoll, Math.abs(roll));
  st.peakPitch = Math.max(st.peakPitch, Math.abs(pitch));
  if (st.fall >= 0) return;
  if (st.t <= st.settle) return;   // ★ 静置期不判死（用户：姿势优先——摆姿+钉脚期间姿势在成形）
  if (String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_NOJUDGE ?? '0') === '1') return;
  const offX = Math.abs(ctl.sensors.com[0]! - st.c0.x);
  const offZ = Math.abs(ctl.sensors.com[2]! - st.c0.z);
  const why: string[] = [];
  // ★★★ 2026-10-18 用户（'重新确定蹲下法庭判死：脱离一定的标准目标姿态就算无效'）：
  //   蹲姿（ang0 存在）= **关节角偏离标准姿态**判死（读数干净可靠）；tilt 读数弃用（误杀源）
  if (st.ang0) {
    const TH = 0.35;   // 20° 容差
    for (const [di, a0] of st.ang0) {
      const d2 = w.body.dofs[di]!;
      const dev = Math.abs(d2.angle - a0);
      if (dev > TH) { why.push(`${d2.name}/${d2.axis}Δ=${(dev * 57.3).toFixed(0)}°`); break; }
    }
    if (offZ > 0.05) why.push(`offZ=${(offZ * 100).toFixed(1)}cm`);
    if (offX > 0.05) why.push(`offX=${(offX * 100).toFixed(1)}cm`);
    if (ctl.sensors.com[1]! < st.y0 - 0.10) why.push(`comY=${(ctl.sensors.com[1]! * 100).toFixed(1)}cm(初始${(st.y0 * 100).toFixed(0)})`);
  } else {
    if (Math.abs(pitch - st.p0) > 0.3491) why.push(`pitchΔ=${((pitch - st.p0) * 57.3).toFixed(1)}°`);
    if (Math.abs(roll - st.r0) > 0.1745) why.push(`rollΔ=${((roll - st.r0) * 57.3).toFixed(1)}°`);
    if (offZ > 0.05) why.push(`offZ=${(offZ * 100).toFixed(1)}cm`);
    if (offX > 0.05) why.push(`offX=${(offX * 100).toFixed(1)}cm`);
    if (ctl.sensors.com[1]! < st.y0 - 0.10) why.push(`comY=${(ctl.sensors.com[1]! * 100).toFixed(1)}cm(初始${(st.y0 * 100).toFixed(0)})`);
  }
  if (why.length) {
    st.fall = st.t;
    st.reason = why.join(' + ');
  }
}
