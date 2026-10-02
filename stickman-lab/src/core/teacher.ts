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
import { wholeBodyAngularMomentum } from './balance';
import { ADJUST_MIN } from './gaitPhase';
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
  /**
   * ★★ CMP / Moment Balance Strategy 增益（用户 2026-10-02："迈出脚后为啥不能自主调整平衡"）。
   *   文献：Popovic, Hofmann & Herr (2004) —— 把 CoP 稳在支撑中心**并不能**保证平衡
   *   （那等于一个静态不稳定、无执行器的倒立摆）；**唯一出路是产生关于质心的非零力矩**，
   *   即 CMP ≠ ZMP（"Moment Balance Strategy"）。恢复力由"质心地面投影与 CMP 的间距"调制。
   *   人在走路时 **CMP 全程被约束在支撑面内**（Herr 2008：CMP 与实测 CoP 距离仅足长 14±2%）。
   *   我们的执行器：支撑腿的**髋外展**（把骨盆挪向支撑脚）+ **脊柱侧屈**（上身反向配重）。
   *   这是落地后那一层"自主调整"，此前 teacher 里**完全没有**。
   */
  cmBalance: number;
  /** 角动量变化率（dL/dt）的阻尼增益 */
  cmBalanceD: number;
  /**
   * ★★ 脊椎/骨盆**反相旋转**增益（用户 2026-10-02："身体调整需要脊椎同步发力对吧"——对）。
   *
   * 文献：Takemura et al. 2007（*Dynamic Walk of Humanoids: Momentum Compensation
   * Based on the Optimal Pelvic Rotation*）—— 正常走路里摆动腿产生的角动量是靠
   * **胸廓/肩的反相旋转**抵消的（van Emmerik & Wagenaar 1996；Lamoth 2002；
   * LaFiandra 2003）；而"trunk-twistless walk"更直接：**骨盆与摆动腿反相**，
   * 骨盆旋转本身就抵消腿的动量。HRP-2 实测：垂直轴**峰值动量降 13%、积分降 18%**；
   * 动捕数据上最优骨盆旋转降 **42%**。最优旋转由**最小化垂直轴动量**求得。
   *
   * 实测依据（probe-gaitcycle ③）：未做这一项时单支撑 |WBAM| 中位 **5.36**
   * = 平衡基线 0.16 的 **33.5×** ⇒ 完全没有角动量抵消。
   */
  spineSync: number;
  /** ★★ 上身发力：手臂摆动幅度（rad）。肩与同侧髋**反相**摆动。
   *   Sci Rep 2019：摆臂力矩是胸廓-骨盆反相的主因，并抵消摆动腿的垂直轴角动量。
   *   0 = 关闭（旧行为：肩只是 `-h*0.4` 的装饰，实测只有 4°）。 */
  armSwing?: number;
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
  opts: {
    dur?: number; clockDriven?: boolean; record?: boolean;
    data?: { X: number[][]; A: number[][] };
    /** 每控制拍的回调（探针用它取角度/接触状态做逐帧统计） */
    onFrame?: (t: number, stanceL: boolean, s: number) => void;
  } = {},
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
  // CMP/Moment-balance 的角动量状态（关于质心，额状/矢状）
  const lbuf = new Float64Array(3);
  let prevLz = 0, prevLy = 0, hasL = false;

  const jHip = sk.joints.find((j) => j.name === 'hip_l')!;
  const jKnee = sk.joints.find((j) => j.name === "knee_l")!;
  const jElbow = sk.joints.find((j) => j.name === "elbow_l")!;
  // ★ 肩必须用**肩自己的**限位归一化：之前错用 jHip ⇒ 指令幅度被髋的限位缩放了
  const jShoulder = sk.joints.find((j) => j.name === "shoulder_l")!;
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
    // ★★ 状态机增益调度（iCub 框架 arXiv 1707.08359 的做法：**姿态是低优先级任务**，
    //   用状态机在"迈步相/调整相"之间调度增益）。
    //   实测依据（probe-gaitcycle ④）：脊椎反相**全程开**会把双支撑占比从 83% 顶到 94%
    //   —— 它让角色更想站住而不是迈步，正是"姿态压过推进"的典型症状。
    //   ⇒ 调整相（落地后的前 ADJUST_MIN 秒）全力做姿态；迈步相只留一点点。
    const inAdjust = (t - lastSwitch) < ADJUST_MIN;
    const postGain = inAdjust ? 1 : 0.15;
    // ★★ CMP / Moment Balance Strategy：主动产生**关于质心的力矩**，把全身角动量调回 0。
    //   为什么必须主动做（Popovic, Hofmann & Herr 2004）：仅靠 CoP 位置控制不够 ——
    //   把 ZMP 放在支撑中心等于一个"静态不稳定、无执行器的倒立摆"。
    //   为什么用角动量当被控量（Herr 2008 / Sci Rep 2023）：正常走路 WBAM≈0，
    //   段间抵消 70~95%；偏离它就说明身体在"整体转"，必须靠髋/脊柱配重来抵消。
    //   实测（probe-gaitcycle）：未启用时单支撑 |WBAM| 中位 5.36 = 平衡基线 0.16 的 **33.5×**。
    let cmRoll = 0;
    // ★ 脊椎归属的模块走统一开关（否则 `mod.enable('cmBalance', false)` 是假的：
    //   实测关掉脊椎两行数字完全一样 ⇒ 老师根本不看模块表）。
    const cmOn = p.cmBalance > 0 && sim.mod.active('cmBalance', sim.gp.now, 2, null);
    if (cmOn) {
      wholeBodyAngularMomentum(sim.doll, com, lbuf);
      const lz = lbuf[2]!;                       // 额状面：绕竖直轴（左右转）
      const ly = lbuf[1]!;                       // 矢状面：绕侧向轴（前扑后仰的转动）
      const dlz = hasL ? (lz - prevLz) / dt : 0;
      const dly = hasL ? (ly - prevLy) / dt : 0;
      prevLz = lz; prevLy = ly; hasL = true;
      // PD：力矩 ∝ −k·L − kd·dL/dt
      cmRoll = -(p.cmBalance * lz + p.cmBalanceD * dlz) * 0.02
        - (p.cmBalance * ly + p.cmBalanceD * dly) * 0.02;
    }
    for (const side of ['l', 'r'] as const) {
      const isStance = (side === 'l') === stanceL;
      const hipX = com.x + (side === 'l' ? HIP_Z : -HIP_Z);
      const [h, k] = isStance
        ? ik(hipX, com.y - 0.10, side === 'l' ? plantL : plantR, 0.012)
        : ik(hipX, com.y - 0.10, swingX, swingY);
      // ⚠ 2026-10-02 记录：这里**曾经**试过"平衡修正只给支撑腿"（摆动腿不加 corr），
      //   理由是双脚支撑时两腿受同一指令只会产生纯俯仰力矩。**实测更差了**：
      //   存活 3.85s → 2.43s，双支撑 35% → 71%，步长 0.111m → 0.033m。
      //   ⇒ 两条腿都需要这个修正（它同时起到"髋策略撑住躯干"的作用）。
      //   保留原样；要试别的角色分工请先跑 npm run tune + npm run gaitcycle 回读。
      setAxis(`hip_${side}`, h + corr, jHip);
      setAxis(`knee_${side}`, k + (isStance ? -Math.abs(absorb) : 0), jKnee);
      setAxis(`shoulder_${side}`, -h * 0.4, jHip);
      // ★★ 上身发力（用户 2026-10-02 要求"包括上身发力"）：手臂摆动。
      //   文献：肩与**同侧髋反向**摆动（相位差 ~180°）；Sci Rep 2019 证明正是这个
      //   摆动力矩（arm swing moment）把胸廓拉向与骨盆**反相**、并抵消摆动腿的
      //   垂直轴角动量。旧代码只给 `−h×0.4`（≈同相、幅度仅 4°）⇒ 手臂是摆设。
      //   改：① 用**摆动进度** sin(πs) 驱动（真实摆臂在摆动相最大）
      //       ② 与**同侧髋**符号相反（反相）
      //       ③ 幅度 0.6~0.8 × 髋幅度，肩峰可达 ~25~30°
      const armSwing = p.armSwing ?? 0;
      if (armSwing > 0) {
        const swingNow = Math.sin(Math.PI * Math.min(1, s));
        // 同侧腿在**摆**时，同侧肩要**向后**；同侧腿在**支撑**时，肩向前
        const armTarget = (isStance ? 1 : -1) * armSwing * (0.35 + 0.65 * swingNow);
        setAxis(`shoulder_${side}`, armTarget, jShoulder);
        // 肘：摆动相微屈（真实步态肘屈 20~40°），支撑相伸直
        setAxis(`elbow_${side}`, isStance ? -0.12 : 0.55, jElbow);
      }
      // ★★ 脊椎同步发力（Takemura 2007）：摆动相里让**胸廓（脊椎）绕竖直轴反相旋转**，
      //   抵消摆动腿产生的垂直轴角动量。本 rig 的"胸廓"= spine1..3，
      //   "骨盆"= 根刚体（由两髋的轴 1 扭转反向叠加得到）。
      //   摆动腿是左 ⇒ 胸廓往 +yaw 走（右转），反之亦然；幅度随摆动进度 sin(πs) 起伏。
      if (p.spineSync > 0 && sim.mod.active('spineSync', sim.gp.now, 2, null)) {
        const sw = Math.sin(Math.PI * Math.min(1, s));
        const dir = isStance ? -1 : 1;      // 与摆动腿反相（isStance=false 即该腿在摆）
        const yaw = dir * p.spineSync * sw;
        // 胸廓：spine1..3 绕竖直轴（axis 2）同向转
        for (const sj of ['spine1', 'spine2', 'spine3']) setAxis(sj, yaw * 0.6, jHip, 2);
        // 骨盆：两髋绕自身长轴反向扭转（axis 1）⇒ 骨盆相对脚反向转
        setAxis('hip_l', -dir * p.spineSync * 0.5 * sw, jHip, 1);
        setAxis('hip_r', dir * p.spineSync * 0.5 * sw, jHip, 1);
      }
      // ★ 把 CMP 力矩加进**支撑腿的髋外展**（这是我们唯一能产生额状面力矩的通道，
      //   因为没有踝关节）。cmRoll > 0 ⇒ 骨盆往 +z 挪（把上身质量推向支撑脚对侧…，
      //   符号由实测调，见 tools/probe-gaitcycle 的开关对比）。
      const latCorr = p.kLat * (com.z - (side === 'l' ? HIP_Z : -HIP_Z)) + p.kLatV * com.vz
        + (isStance ? cmRoll : -cmRoll * 0.3);
      setAxis(`hip_${side}`, isStance ? latCorr : -p.kLatSwing, jHip, 0);
    }
    opts.onFrame?.(t, stanceL, s);
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
