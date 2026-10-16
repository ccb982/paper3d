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
  t: number;              // 法庭时间（④ 起）
  settle: number;         // 静置时长（秒）
  released: boolean;      // ★ 放开标记（静置结束）
  c0: { x: number; z: number };
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

  const st: CourtState = {
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

/** 每物理步（advance 之前）：注入支撑柱+摆腿柱（基础力）——探针同款（supportClean 提案须在控制步前入总线） */
export function courtInject(w: World, ctl: ControlModule): void {
  const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
  supportClean(ctx, 'r');
  supportClean(ctx, 'l');
}

/** ⑤ 每物理步：静置期清零 + 严格判死（探针同款） */
export function courtStep(w: World, ctl: ControlModule, st: CourtState): void {
  st.t += w.dt;
  if (!st.released && st.t >= st.settle) {
    st.released = true;
    console.log(`★★★ 法庭：放开（静置 ${st.settle.toFixed(1)}s 结束，速度清零停止）t=${st.t.toFixed(2)}s ★★★`);
  }
  ctl.warner.setComTarget(st.c0.x, st.c0.z);   // ★ 2026-10-16 每帧维持标准态 com 目标（防过期回中线）
  if (st.t <= st.settle) {
    for (const rb of w.body.bodies) {
      rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }
  const pitch = ctl.sensors.torsoTilt[0]!;
  const roll = ctl.sensors.torsoTilt[1]!;
  st.peakRoll = Math.max(st.peakRoll, Math.abs(roll));
  st.peakPitch = Math.max(st.peakPitch, Math.abs(pitch));
  if (st.fall >= 0) return;
  const offX = Math.abs(ctl.sensors.com[0]! - st.c0.x);
  const offZ = Math.abs(ctl.sensors.com[2]! - st.c0.z);
  const why: string[] = [];
  if (Math.abs(pitch) > 0.3491) why.push(`pitch=${(pitch * 57.3).toFixed(1)}°`);
  if (Math.abs(roll) > 0.1745) why.push(`roll=${(roll * 57.3).toFixed(1)}°`);
  if (offZ > 0.05) why.push(`offZ=${(offZ * 100).toFixed(1)}cm`);
  if (offX > 0.05) why.push(`offX=${(offX * 100).toFixed(1)}cm`);
  if (ctl.sensors.com[1]! < 0.75) why.push(`comY=${(ctl.sensors.com[1]! * 100).toFixed(1)}cm`);
  if (why.length) {
    st.fall = st.t;
    st.reason = why.join(' + ');
  }
}
