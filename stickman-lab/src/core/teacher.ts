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
import { readCom, newCom, omegaAt, footGrounded } from './posture';
import { wholeBodyAngularMomentum } from './balance';
import { ADJUST_MIN } from './gaitPhase';
import { JOINT_ORDER, jointIndexByName, spineJointNames, type Skeleton } from './skeleton';
import { cell } from './normGait';

// ── 腿长/髋偏置：全部从纹理像素换算（px2m = 0.00068，画布 y=2899 是地面）──
const PX2M = 0.00068;
const Y = (py: number): number => (2899 - py) * PX2M;
export const LEN_A = Y(1574.5) - Y(2206);      // 大腿 0.429 m
export const LEN_B = Y(2206) - Y(2792);        // 小腿 0.398 m
export const HIP_Z = 0.007;
/**
 * ★★ CoM 到**真实髋**的垂直落差（m）。
 *   腿长（髋→踝）实测 0.828 m、真实髋高 0.901 m、CoM 高约 1.208 m ⇒ 落差 ≈0.307 m。
 *   **旧值 0.10 是错的**：它把 IK 的虚拟髋点抬到 CoM 下方仅 10 cm，于是 IK 要解
 *   "|髋−脚| = 腿长" 时垂直落差 = 1.208−0.10−0.012 = **1.096 m > 0.828 m**
 *   ⇒ 任何前伸都**解不出来**。这就是"抬腿的时候脚都不往前伸"的根因
 *   （实测前伸 3 mm；`reach`、踝指令全救不了，因为不是能力问题而是无解）。
 *   改成 0.307 后最大水平步长 ≈ √(0.828² − 0.889²) 无解…… 见下方 sanity：
 */
export const HIP_DY = 0.307;
/** ★ 落地吸能上限（rad）= 20°。Oberg 初始接触膝屈 ~15°、负重反应峰 ~20°。
 *  超过它落地就会把支撑腿压塌（实测 57° ⇒ 脚撑不住）。 */
export const ABSORB_MAX = 0.35;
/** 真实髋高（m），由 limbAxes.json 锚点 Y(1574.5) 换算 */
export const HIP_Y = Y(1574.5);

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
  /** ★ 支撑腿发力前送（rad）：支撑相后半段线性增大的髋伸驱动。
   *   文献：支撑腿要持续把身体推过支撑脚（跖屈+髋伸），不是被动站立。
   *   之前完全没有这一项 ⇒ 净位移 0、越走越慢。 */
  stancePush?: number;
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
  /** ★ 支撑腿在「迈步相」锁定到文献姿态的权重（0=不锁，1=全锁）。依据 npm run roles：
   *   step 相支撑腿 髋 ROM 38.5°/膝 ROM 30.7°，而 Oberg slow midstance 要求 15°/15.7°。 */
  stanceLock?: number;
  /** ★ 摆动脚**显式前伸**量（m）。用户 2026-10-02："抬腿的时候脚都不往前伸"。
   *   实测旧行为只前伸 **3mm**（标准慢速步长 ≈500mm）⇒ 等于没迈步。
   *   0 = 退回旧行为（只跟捕获点 xi）。 */
  reach?: number;
  /** ★★ 踝：摆动期背屈峰值（°）—— 勾脚把腿往前送 */
  ankleSwing?: number;
  /** ★★ 踝：支撑期起立跖屈（°）—— 顶髋把身体前送 */
  anklePush?: number;
  /** ★★ 踝：支撑中期中立角（°） */
  ankleStance?: number;
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
  const footBufL = new Float64Array(2), footBufR = new Float64Array(2);
  let prevLz = 0, prevLy = 0, hasL = false;

  const jHip = sk.joints.find((j) => j.name === 'hip_l')!;
  const jKnee = sk.joints.find((j) => j.name === "knee_l")!;
  // ★★ 踝（foot_l/foot_r）—— 之前**从不下指令**，脚掌是自由体。
  //   这就是"抬腿的时候脚都不往前伸"的直接原因：脚掌朝向恒定（只跟小腿走），
  //   膝控制的只是小腿，**脚要往前伸必须靠踝**（人走路：摆动期背屈→蹬离跖屈）。
  const jFoot = sk.joints.find((j) => j.name === "foot_l")!;
  // ★ 腰（脊柱）关节的实际名字与描述：spineSegments>1 时才存在
  const spineNames = spineJointNames(sk);
  const nSpine = spineNames.length;
  // ★ 肩必须用**肩自己的**限位归一化：之前错用 jHip ⇒ 指令幅度被髋的限位缩放了
const setAxis = (joint: string, ang: number, j: typeof jHip | undefined, ax = 2): void => {
      // ★★★ 查索引必须走 `jointIndexByName`（查**实际关节实例**），
      //   不能用 `JOINT_ORDER.indexOf` —— 后者是硬编码常量，**不含运行时追加的脊柱关节**：
      //     spine1/spine2/spine3（腰）在 `spineSegments > 1` 时才被 joints.push 进去，
      //     indexOf 永远 −1 ⇒ setAxis 静默 return ⇒ **腰从来没被下过指令**。
      const ji = jointIndexByName(sk, joint);
      const o = ji * 3 + ax;
      // ★ 静默失效点（曾让我们误判"某个模块在起作用"）：
      //   12 关节配置里**没有 ankle**，此时 `j` 为 undefined（踝只存在于 14 关节）
      if (o < 0 || !j) return;
      // ★★ 归一化必须用该轴的**最大行程**，不能用"这一侧的小限位"。
      //   旧写法 `ang>=0 ? ang/(0.9*maxRad) : ang/(0.9*-minRad)` 在**不对称限位**上
      //   会把正向指令掐死：膝限位 [-145°, +2°] ⇒ 正指令除以 0.9*2° = 1.8°，
      //   一个 0.5 的指令只产生 **0.9°** 目标 ⇒ 实测膝只动 1.6°/5.1°、肘 4.4°。
      //   （hip [-80°,+60°] 较对称，所以髋看起来正常 —— 这就是"只有髋像有关节"的错觉。）
      //   改成按 `max(|min|,|max|)` 双向一致归一化。
      const span = Math.max(Math.abs(j.minRad[ax]), Math.abs(j.maxRad[ax]));
      if (span <= 1e-6) return;
      out[o] = ang / (0.9 * span);
      nAxes++;
    };
  /** 本拍真正下出去的轴数（调试用：0 说明某个角色压根没被控制） */
  let nAxes = 0;

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
      if (wantL !== stanceL) {
        // ★ 校验：**新支撑腿真的着地，且确实比另一条腿承重更多**，才算换成功。
        //   没校验就翻 ⇒ 指令与物理脱节（实测右腿从未被指令）。
        const nl = footGrounded(sim.doll, 'l'), nr = footGrounded(sim.doll, 'r');
        const [fl, fr] = sim.doll.footLoadFrac(dt);
        const wantStanceLeft = wantL;
        const ok = wantStanceLeft ? (nl && fl >= fr) : (nr && fr >= fl);
        if (ok) {
          steps++;
          lastSwitch = t;
          stanceL = wantL;
          prevStance = stanceL ? 1 : 2;
          // 落脚点记**实测落点**（见下）
          sim.doll.soleXZ('l', footBufL); sim.doll.soleXZ('r', footBufR);
          const landed = stanceL ? footBufL[0]! : footBufR[0]!;
          if (stanceL) plantL = landed; else plantR = landed;
        }
// ⚠ 校验没过就**保持原指令**（不翻转、不推进相位）——
      //   不能 `continue`：那会跳过本拍剩下的全部伺服（含马达下发），人就不动了。
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
    // 原式 `xi + kv·(vDes−vx)·T/2`：xi 是捕获点，跟随身体前进。身体还没动起来时
    //   `xi ≈ com.x` ⇒ 每只脚都被种在**原来的位置** ⇒ 净位移≈0（实测前伸仅 3mm）。
    const swingX0 = xi + p.kv * (p.vDes - com.vx) * p.T * 0.5;
    // ★ 显式前伸：强制摆动脚至少比**支撑脚**再往前 `reach` 米（文献慢速步长 ≈0.5m）
    let swingX = swingX0;
    const reach = p.reach ?? 0;
    if (reach > 0) {
      sim.doll.soleXZ('l', footBufL); sim.doll.soleXZ('r', footBufR);
      const stanceX = stanceL ? footBufL[0]! : footBufR[0]!;
      swingX = Math.max(swingX0, stanceX + reach);
    }

    const swingY = 0.012 + p.lift * Math.sin(Math.PI * Math.min(1, s));
    const dtSw = t - lastSwitch;
    // ★★ 落地吸能**必须限幅**（用户 2026-10-02："脚落地后甚至无法实现支撑"）。
    //   旧式：`absorb = p.absorb · exp(−dtSw/τ)`，触地那一帧 dtSw=0 ⇒ **满量** p.absorb。
    //   而寻优把 p.absorb 推到 1.0 rad = **57°**（因为目标函数只测摆动膝峰值、
    //   不测支撑膝，它一路涨没有代价）⇒ 落地瞬间支撑膝被命令屈 57° ⇒ **腿直接塌**，
    //   脚当然撑不住。
    //   文献：Oberg 初始接触膝屈 ~15°、负重反应峰 ~20°（midstance 15.7°）。
    //   ⇒ 上限取 20° = 0.35 rad。
    const absorb = Math.min(ABSORB_MAX, p.absorb)
      * Math.exp(-dtSw / Math.max(0.05, p.absorbTau));
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
        ? ik(hipX, com.y - HIP_DY, side === 'l' ? plantL : plantR, 0.012)
        : ik(hipX, com.y - HIP_DY, swingX, swingY);
      // ⚠ 2026-10-02 记录：这里**曾经**试过"平衡修正只给支撑腿"（摆动腿不加 corr），
      //   **实测更差**（存活 3.85→2.43s、双支撑 35%→71%）。保留原样。
      //
      // ★★★★★ 阶段 × 角色 姿态指令表（normGait.PHASE_ROLE）
      //   目标值全部来自文献（Oberg 膝 15.7°/63°、髋 ROM 46.9°；Sci Rep 2019 腰 −20°），
      //   用**跟踪误差**把实际姿态拉向该阶段该角色的标准姿态。
      const phNow = sim.gp.now;
      const cSwing = cell(phNow, 'swingLeg'), cStance = cell(phNow, 'stanceLeg');
      const roleCell = isStance ? cStance : cSwing;
      const stanceLock = p.stanceLock ?? 0;
      // ⚠ 2026-10-02：把膝**直接**按指令表替换（不做 IK 混合）会更差（存活 3.85→1.37s），
      //   因为落点必须靠 IK。所以按表的正确用法是：**摆动腿用 IK，支撑腿在迈步相锁定**。
      let kneeCmd = k + (isStance ? -Math.abs(absorb) : 0);
      // ★★★ 用户 2026-10-02："先迈出去，再启动支撑的过程啊，迈出去的过程被覆盖了吗"
      //   —— 是的，被覆盖了。旧写法 `hipCmd = h + corr` 把**平衡修正加在两条腿上**，
      //      kPitch=2.544 时躯干一个俯仰就能往摆动腿的髋上叠几十度，把 IK 的迈步冲掉。
      //   正确分工：**摆动腿只吃 IK**（纯迈步），`corr` 只给支撑腿。
      //   （注：早期试过"corr 只给支撑腿"更差，但那是**归一化还坏着**的时候测的
      //     ——膝只能动 1.6°，结论不可信；现在重测。）
      let hipCmd = isStance ? h + corr : h;
      // ★★★ 支撑腿在「迈步相」锁定（用户："脚往前迈的时候，身体别动"）
      //   回读依据（npm run roles）：step 相支撑腿 **髋 ROM 38.5° / 膝 ROM 30.7°**，
      //   而指令表要求 髋 15° / 膝 15.7°（Oberg slow midstance）⇒ 实际是要求的 2 倍。
      if (isStance && roleCell && stanceLock > 0 && phNow === "step") {
        const w = stanceLock;
        if (roleCell.hipDeg != null) hipCmd = hipCmd * (1 - w) + roleCell.hipDeg * Math.PI / 180 * w;
        if (roleCell.kneeDeg != null) kneeCmd = kneeCmd * (1 - w) + roleCell.kneeDeg * Math.PI / 180 * w;
      }
      // ★★ 支撑腿蹬离（**必须在写马达之前**加！旧代码加在 setAxis 之后 ⇒ 完全无效）
      //   支撑相后半段线性增大的髋伸驱动，把身体推过支撑脚。
      if (isStance && s > 0.5) hipCmd += (p.stancePush ?? 0) * (s - 0.5) * 2;
      setAxis(`hip_${side}`, hipCmd, jHip);
      setAxis(`knee_${side}`, kneeCmd, jKnee);
      setAxis(`shoulder_${side}`, -h * 0.4, jHip);
      // ★★★ 踝指令（新增，之前完全缺失）
      //   文献量级：摆动期背屈 ~10°（脚尖上勾，利于前伸）→ 蹬离跖屈 ~15~20°（脚尖下压推髋前送）
      //   相位 s：0=刚离地  0.5=摆动中  1=落地
      const aStance = p.ankleStance ?? 0, aPush = p.anklePush ?? 0, aSwing = p.ankleSwing ?? 0;
      // ★★ 符号约定（用户 2026-10-02："踝关节是不是方向反了" —— 是的，反了，已修）：
      //   partsMeta: `limitDeg = [低头(plantarflex), 勾脚(dorsiflex)]` = [−10°, +18°]
      //   ⇒ **负 = 跖屈（脚尖下压）**，**正 = 背屈（脚尖上勾）**。
      //   我第一版写成「摆动前半 −aSwing = 背屈、支撑起立 +aPush = 跖屈」——**两者都反了**。
      const ankleDeg = isStance
        // 支撑相：起立时**跖屈**（脚尖下压，顶髋把身体前送）→ 中后期回中立
        ? aStance - aPush * Math.max(0, 1 - 2 * s)
        // 摆动相：前半**背屈**（勾脚往前送）→ 后半跖屈（脚尖先着地）
        : (s < 0.5 ? aSwing * (s / 0.5) : -aSwing * (1 - (s - 0.5) / 0.5));
      setAxis(`foot_${side}`, ankleDeg * Math.PI / 180, jFoot);
      // ★★ 脊椎同步发力（Takemura 2007）：摆动相里让**胸廓（脊椎）绕竖直轴反相旋转**，
      //   抵消摆动腿产生的垂直轴角动量。本 rig 的"胸廓"= spine1..3，
      //   "骨盆"= 根刚体（由两髋的轴 1 扭转反向叠加得到）。
      //   摆动腿是左 ⇒ 胸廓往 +yaw 走（右转），反之亦然；幅度随摆动进度 sin(πs) 起伏。
      if (p.spineSync > 0 && sim.mod.active('spineSync', sim.gp.now, 2, null)) {
        const sw = Math.sin(Math.PI * Math.min(1, s));
        const dir = isStance ? -1 : 1;      // 与摆动腿反相（isStance=false 即该腿在摆）
        const yaw = dir * p.spineSync * sw;
        // 胸廓：**用实际的脊柱关节名**（spineSegments>1 时才有，可能是 spine1..3 或更长）
        //   旧写法硬编码 ['spine1','spine2','spine3'] + JOINT_ORDER.indexOf ⇒ 永远 −1 ⇒ 腰从未被驱动。
        //   每段用**它自己的**关节描述做归一化（错用 jHip 会让限位算错）。
        for (const sj of spineNames) {
          const sjDesc = sk.joints[jointIndexByName(sk, sj)];
          if (sjDesc) setAxis(sj, yaw * 0.6, sjDesc, 2);
        }
        // 骨盆：两髋绕自身长轴反向扭转（axis 1）⇒ 骨盆相对脚反向转
        setAxis('hip_l', -dir * p.spineSync * 0.5 * sw, jHip, 1);
        setAxis('hip_r', dir * p.spineSync * 0.5 * sw, jHip, 1);
      }
      // ══════════════════════════════════════════════════════════════════════
      // ★★★ 两个用户点名要调、但参数一直是 0（等于没接）的机制：
      //
      // ① **重心转移**（用户："这个重心转移…都得调"）
      //    迈步前必须先把体重**横向挪到支撑脚上**，才能把摆动腿卸掉抬起来。
      //    现在 `kLat/kLatV` 全是 0 ⇒ 从来没有主动转移 ⇒ 摆动腿抬不起来（离地峰值
      //    长期只有 0~6mm）。文献：成人单支撑期 CoM 横向偏移 ≈ 步宽的一半（~7cm）。
      //    `latCorr` = kLat·(com.z − 目标) + kLatV·com.vz：把 CoM 拉向**支撑脚**。
      //
      // ② **支撑腿保持发力 / 蹬离**（用户："迈出的腿保持发力"）
      //    支撑腿不是"站住"，而是要**持续把身体推过支撑脚**（跖屈 + 髋伸）。
      //    现在支撑腿的指令 = IK(落脚点) + corr，没有任何前送项 ⇒ 纯被动站立，
      //    所以净位移为 0、越走越慢。
      //    `pushDrive` = 支撑相后段线性增大的髋伸驱动，配合踝跖屈（anklePush）。
      // ══════════════════════════════════════════════════════════════════════
      const stanceZ = stanceL ? HIP_Z : -HIP_Z;
      // ① 重心转移：把 CoM 拉向支撑脚（kLat/kLatV 现在必须非 0 才有用）
      const shiftErr = stanceZ - com.z;
      const latCorr = p.kLat * shiftErr + p.kLatV * com.vz
        + (isStance ? cmRoll : -cmRoll * 0.3);
      // ② 支撑腿发力前送：支撑相后半段线性增大（s∈[0.5,1]），把身体推过支撑脚

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
