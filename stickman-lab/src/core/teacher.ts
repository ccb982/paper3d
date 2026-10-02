/**
 * 手写"捕获点行走控制器"——**单一真源**。
 *
 * 为什么它在一个模块里而不是散在探针里：
 * 1. `tools/probe-capture.ts` 用它搜参数；
 * 2. `tools/probe-clone.ts` 用它**采数据做行为克隆**（把它的策略蒸馏进神经网络基因组）。
 *    克隆要求 teacher 是观测的纯函数，所以这里提供 `clockDriven` 模式：
 *    换脚由**时钟**触发（周期 T/2），而不是由捕获点越界触发。
 *    时钟相位在观测里是 `sin/cos(2π·phase)`（`gaitHz = 1/T` 时一一对应），
 *    于是"摆到第几步、抬多高"全部可观测 ⇒ 克隆出来的网络不需要任何内部记忆。
 *
 * 观测侧需要的量它全都在读：com/om/ξ、躯干俯仰与角速度、脚底世界 x（当支撑脚时
 * 落脚点就等于脚的当前位置）、每脚载荷份额（判别哪条腿是支撑腿）。缺的只有绝对时间 t，
 * 而时钟补上了。
 */

import type { Sim } from './sim';
import { readCom, newCom, omegaAt } from './posture';
import { JOINT_ORDER, type Skeleton } from './skeleton';

// ── 腿长/髋偏置：全部从纹理像素换算（px2m = 0.00068，画布 y=2899 是地面）──
const PX2M = 0.00068;
const Y = (py: number): number => (2899 - py) * PX2M;
export const LEN_A = Y(1574.5) - Y(2206);      // 大腿 0.429 m
export const LEN_B = Y(2206) - Y(2792);        // 小腿 0.398 m
export const HIP_Z = 0.007;

export interface CaptureParams {
  /** 步态周期（s）：一左一右两个支撑相 */
  T: number;
  /** 目标速度（m/s） */
  vDes: number;
  /** 摆动脚抬多高（m） */
  lift: number;
  /** Raibert 速度误差增益：x* = ξ + kv·(vDes − vx)·T/2 */
  kv: number;
  kPitch: number;
  kRate: number;
  kLat: number;
  kLatV: number;
  kLatSwing: number;
  /** 捕获点走出支撑脚的换脚阈值（m），仅 clockDriven=false 时用 */
  thresh: number;
  /** 落地吸能强度（rad） */
  absorb: number;
  /** 吸能时间常数（s） */
  absorbTau: number;
}

/** 二连杆 IK：髋 (hipX,hipY) → 脚 (fx,fy)，返回 [髋屈伸, 膝屈伸]（膝屈为负） */
export function ik(hipX: number, hipY: number, fx: number, fy: number): [number, number] {
  const dx = fx - hipX, dy = fy - hipY;
  let d = Math.hypot(dx, dy);
  d = Math.min(d, (LEN_A + LEN_B) * 0.995);
  d = Math.max(d, Math.abs(LEN_A - LEN_B) + 0.02);
  const base = Math.atan2(dx, -dy);
  const cosK = Math.max(-1, Math.min(1,
    (LEN_A * LEN_A + LEN_B * LEN_B - d * d) / (2 * LEN_A * LEN_B)));
  const interior = Math.acos(cosK);
  const hipRel = base + Math.atan2(LEN_B * Math.sin(interior), LEN_A + LEN_B * Math.cos(interior));
  return [hipRel, -(Math.PI - interior)];
}

export interface TeacherResult {
  x: number;
  alive: boolean;
  steps: number;
  t: number;
  /** 采样到的样本数（record=true 时） */
  n: number;
}

/**
 * 跑一整段 teacher。
 * @param record  true 时把 (观测, 归一化目标) 存进 `data`，供行为克隆用
 */
export function runCaptureTeacher(
  sk: Skeleton,
  sim: Sim,
  p: CaptureParams,
  opts: { dur?: number; clockDriven?: boolean; record?: boolean; data?: { X: number[][]; A: number[][] } } = {},
): TeacherResult {
  const dur = opts.dur ?? 8;
  const clockDriven = opts.clockDriven ?? false;
  const out = new Float32Array(sim.doll.jointCount * 3);
  const com = newCom();
  const dt = 1 / sim.cfg.controlHz;
  const iL = sk.bodies.findIndex((b) => b.key === 'shin_l');
  const iR = sk.bodies.findIndex((b) => b.key === 'shin_r');
  let plantL = sim.doll.bodies[iL].translation().x;
  let plantR = sim.doll.bodies[iR].translation().x;
  let t = 0, steps = 0, prevStance = 1, lastSwitch = 0;

  const jHip = sk.joints.find((j) => j.name === 'hip_l')!;
  const jKnee = sk.joints.find((j) => j.name === 'knee_l')!;
  const setAxis = (joint: string, ang: number, j: typeof jHip, ax = 2): void => {
    const o = JOINT_ORDER.indexOf(joint) * 3 + ax;
    if (o < 0) return;
    out[o] = ang >= 0 ? ang / (0.9 * j.maxRad[ax]) : ang / (0.9 * -j.minRad[ax]);
  };

  while (!sim.finished && t < dur) {
    sim.advance(1);
    const torso = sim.doll.torso();
    const rot = torso.rotation();
    const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (rot.w * rot.x + rot.y * rot.z))));
    const av = torso.angvel();
    readCom(sim.doll, com);
    const om = omegaAt(com.y);
    const xi = com.x + com.vx / om;                    // ★ 捕获点

    let stanceL = prevStance === 1;
    if (clockDriven) {
      // ★ 时钟驱动：每个支撑相固定 T/2 秒。好处是"该抬哪条腿、抬到第几步"完全由
      //   观测里的 sin/cos(2π·phase) 决定 ⇒ teacher 成为观测的纯函数（可克隆）。
      const half = p.T * 0.5;
      const k = Math.floor(t / half);
      const wantL = k % 2 === 0;
      if (wantL !== stanceL) {                          // 跨过边界 ⇒ 换支撑脚
        steps++;
        lastSwitch = k * half;
        if (stanceL) plantL = xi; else plantR = xi;    // 落脚点 = 换脚瞬间的捕获点
        stanceL = wantL;
        prevStance = stanceL ? 1 : 2;
      }
    } else {
      // 状态触发：ξ 走出当前支撑脚的落点，且过了半个周期（防抖）才换脚
      const plantNow = stanceL ? plantL : plantR;
      if (Math.abs(xi - plantNow) > p.thresh && t - lastSwitch > p.T * 0.5) {
        stanceL = !stanceL;
        steps++;
        lastSwitch = t;
        if (stanceL) plantL = xi; else plantR = xi;
        prevStance = stanceL ? 1 : 2;
      }
    }
    const s = Math.max(0, Math.min(1, (t - lastSwitch) / Math.max(0.2, p.T * 0.5)));
    const swingX = xi + p.kv * (p.vDes - com.vx) * p.T * 0.5;
    const swingY = 0.012 + p.lift * Math.sin(Math.PI * Math.min(1, s));
    const dtSw = t - lastSwitch;
    const absorb = p.absorb * Math.exp(-dtSw / Math.max(0.05, p.absorbTau));
    const corr = p.kPitch * pitch + p.kRate * av.x;
    for (const side of ['l', 'r'] as const) {
      const isStance = (side === 'l') === stanceL;
      const hipX = com.x + (side === 'l' ? HIP_Z : -HIP_Z);
      const [h, k] = isStance
        ? ik(hipX, com.y - 0.10, side === 'l' ? plantL : plantR, 0.012)
        : ik(hipX, com.y - 0.10, swingX, swingY);
      setAxis(`hip_${side}`, h + corr, jHip);
      setAxis(`knee_${side}`, k + (isStance ? -Math.abs(absorb) : 0), jKnee);
      setAxis(`shoulder_${side}`, -h * 0.4, jHip);
      const latCorr = p.kLat * (com.z - (side === 'l' ? HIP_Z : -HIP_Z)) + p.kLatV * com.vz;
      setAxis(`hip_${side}`, isStance ? latCorr : -p.kLatSwing, jHip, 0);
    }
    sim.doll.setMotorTargets(out);
    // ★★ 采样：观测是 advance 之后取的（与训练时的时序一致：控制目标由上一帧状态算出，
    //    下一帧的观测才能反映它的效果 ⇒ 这里必须记录**这一帧的观测**而不是上一帧）。
    if (opts.record && opts.data) {
      opts.data.X.push(Array.from(sim.observation()));
      opts.data.A.push(Array.from(out));
    }
    t += dt;
  }
  return { x: sim.distance, alive: !sim.fallen, steps, t, n: opts.data?.X.length ?? 0 };
}
