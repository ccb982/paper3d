// jointProgram —— 把奖励写成"程序"：先定义一个步态程序（相位 → 每个关节的目标角），
// 再逐关节算跟踪误差。这样每个关节都有独立的一项分，出问题能直接看出是哪个关节不听话。
//
// 为什么换掉笼统分数（用户 2026-10-01）：
//   原来一个 `total` 里塞了十几个手调权重，迈步/站稳/抢步互相耦合，
//   训练不动时**不知道是哪个关节**的问题。改成程序之后：
//   - 每个关节一项（jt.hip_l / jt.knee_r / …），可以单独看、单独加权；
//   - 腿部交替是一个**显式的相位约束**（alt 项），不是"碰巧换脚才给分"；
//   - "鼓励盆骨和膝盖骨的移动"是 move 项：髋/膝的平均角速度越接近目标越高（有上限）。
//
// 相位约定：φ = 2π · t · gaitHz，φ=0 是左腿在最前。左腿用 sin(φ)，右腿用 sin(φ+π) = −sin(φ)
// ⇒ 天然反相（180°），这就是"腿部交替"的参考。

import { BEST_PHASE, type PhaseSpec } from './phaseSeed';

/**
 * ★ 抬腿规格（用户 2026-10-01："需要抬腿调控啊，交替抬腿，一次抬一条"）。
 *
 * 只要"互斥"，**不规定相位**：实测两腿的膝关节在角度上并不同相（全局拟合还受相位漂移影响），
 * 而"一次抬一条"是硬约束（不能同时抬），与相位无关 ⇒ 更稳、也不会因为猜错相位而全盘皆错。
 *
 * `liftSign`：哪个方向算"抬"。选错的话 `excl` 会接近 0，在逐关节表里一眼能看出来。
 * `ref`：抬多高算 1（rad，取实测膝摆幅）。
 */
export interface LiftSpec {
  joint: string;
  sign: 1 | -1;
  ref: number;
  /** 中位角（= 实测 bias），超过它才算抬起 */
  base: number;
}

export interface JointSpec {
  /** 关节名（skeleton 的 JOINT_ORDER 里的名字） */
  joint: string;
  /** 绕哪个轴：0=X 1=Y 2=Z（与 ragdoll.jointRot 的下标一致） */
  axis: number;
  /**
   * ★ 目标角 = bias + aSin·sin φ + aCos·cos φ（φ = 2π·phase）
   *   这三个系数是**实测拟合**出来的（`tools/probe-seed` 对最好那组步态做最小二乘），
   *   不是拍脑袋写的。用 sin/cos 两个自由度 ⇒ **相位也包含在里面**，
   *   不用另外猜 lead（之前猜错，整个 jt 项就是一个恒定的巨大误差）。
   */
  aSin: number;
  aCos: number;
  bias: number;
  /** 该关节的跟踪权重（相对值，程序里直接写死，方便逐关节调） */
  w: number;
  /** 是否属于"必须交替"的关节对 */
  leg: boolean;
  /** 是否属于"要鼓励移动"的关节（骨盆=髋、膝盖） */
  move: boolean;
}

export interface GaitProgram {
  name: string;
  joints: JointSpec[];
  /** 需要 180° 反相的关节对（左, 右） */
  pairs: [string, string][];
  /** 目标髋/膝角速度（rad/s）：move 项达到这个值就满分 */
  moveTarget: number;
  /** 要互斥抬腿的关节对（[左膝, 右膝]） */
  liftPairs: [string, string][];
  /** 每条腿的抬腿规格（哪条腿、哪个方向、抬多高算满） */
  lifts: LiftSpec[];
  /** 两条腿平均抬腿高度的目标（不到这个数 ⇒ "没在抬"，互斥分不给） */
  liftTarget: number;
  /**
   * ★★ 为什么"跟踪目标角"不是主项（实测，tools/probe-fit）：
   *   把最好那组步态的实际关节角拟到时钟基 `bias + aSin·sinφ + aCos·cosφ`，
   *   **残差 RMS ≈ 拟合幅度的 70%**（髋：幅度 0.11 / 残差 0.066~0.080）。
   *   也就是说这段运动**不是单频正弦**，用正弦当参考 ⇒ jt 项里有一大块永远扣不掉的常数误差。
   *   而且"下发命令角"更不可达（马达力矩+地面让实际角只有命令的 1/3）。
   *   ⇒ 主项改成**完全可达的规格**：`move`（每个关节必须以 ~v 持续动）
   *     + `alt`（两条腿角速度和 ≈ 0 ⇒ 交替）。`jt` 保留为弱项（w.joint 默认 0.3），
   *     系数就是 probe-fit 实测出来的那一组。
   */
}

const TAU = Math.PI * 2;

/** 由 PhaseSpec 生成一份完整的步态程序（默认即"骨盆前后摆 + 膝屈伸 + 手臂反相 + 腰微摆"） */
/**
 * ★ 下面 joints[] 里的 aSin/aCos/bias 全部是**实测拟合值**（`tools/probe-fit`，scale=0.15、
 *   legPhase=1 那组最好步态的前 2 s），不是拍脑袋写的。改程序 = 改这一张表。
 */
export function phaseProgram(s: PhaseSpec = BEST_PHASE): GaitProgram {
  const sc = s.scale;
  const hip = 0.6 * sc, knee = 0.5 * sc, arm = 0.3 * sc, waist = 0.2 * sc;
  const joints: JointSpec[] = [
    // ★★ 骨盆（髋）：**左右下发同相**（amp 同号、lead 同为 0）。
    //   这是实测出来的，不是随手写的：`tools/probe-seed` 扫 legPhase = ±1 × 三档幅度，
    //   legPhase=+1（左右同相下发）才**往前走**（+1.25 m / 2 次有效迈步 / altQ=0.75），
    //   legPhase=−1（反相下发）会**往后走**（−1.24 m）。
    //   也就是说：**命令同相 ⇒ 实测反相** —— 交替是地面把一条腿按住"造"出来的。
    //   所以"腿部要交替"这条要求由 **alt 项**（量的是实际角速度）负责，程序只描述可实现的命令。
    { joint: 'hip_l', axis: 2, aSin: 0.0557, aCos: -0.0973, bias: 0.1302, w: 1.0, leg: true, move: true },
    { joint: 'hip_r', axis: 2, aSin: 0.0534, aCos: -0.0705, bias: 0.1529, w: 1.0, leg: true, move: true },
    // ★ 膝盖：与同侧髋同相、略滞后（收腿），左右同样同相下发
    { joint: 'knee_l', axis: 2, aSin: -0.1022, aCos: 0.0922, bias: 0.1, w: 1.0, leg: true, move: true },
    { joint: 'knee_r', axis: 2, aSin: -0.0847, aCos: 0.0749, bias: 0.0843, w: 1.0, leg: true, move: true },
    // ★ 没有踝/足关节（JOINT_ORDER 只有 8 个），脚只能被小腿拖着走 ⇒ 程序里也不写脚
    // 手臂：与同侧腿反相（平衡用），权重低一点，免得它抢戏
    { joint: 'shoulder_l', axis: 2, aSin: -0.0981, aCos: 0.0826, bias: 0.0131, w: 0.4, leg: false, move: false },
    { joint: 'shoulder_r', axis: 2, aSin: 0.0871, aCos: 0.0038, bias: 0.0251, w: 0.4, leg: false, move: false },
    { joint: 'elbow_l', axis: 2, aSin: -0.0045, aCos: 0.0163, bias: 0.0013, w: 0.25, leg: false, move: false },
    { joint: 'elbow_r', axis: 2, aSin: 0.0064, aCos: 0.0035, bias: 0.0014, w: 0.25, leg: false, move: false },
  ];
  for (let i = 1; i <= 3; i++) {
    // 脊柱：实测 −0.0056 / 0.0222 / 0.0237（三个 spine 段同值，见 probe-fit）
    joints.push({ joint: `spine${i}`, axis: 0, aSin: -0.0056, aCos: 0.0222, bias: 0.0237, w: 0.2, leg: false, move: false });
  }
  return {
    name: 'walk-phase-v1',
    joints,
    pairs: [['hip_l', 'hip_r'], ['knee_l', 'knee_r']],
    moveTarget: 1.0,   // rad/s：髋/膝平均角速度到这个值就满分（×0.15 步态实测 0.58、×0.5 饱和）
    // ★ 抬腿：左右膝"一次抬一条"。base 取实测 bias，ref 取实测摆幅 0.2 rad。
    //   ★ sign=+1 是**屈膝**方向（实测：sign=−1 时抬腿高度≈0、同时抬占比≈0 ⇒ 那是伸腿方向，
    //   等于"从来不抬"白拿互斥满分）。
    liftPairs: [['knee_l', 'knee_r']],
    // 两条腿平均抬到这个高度才算"真在抬腿"（实测最好那组是 0.22~0.23）
    liftTarget: 0.25,
    lifts: [
      { joint: 'knee_l', sign: 1, ref: 0.2, base: 0.10 },
      { joint: 'knee_r', sign: 1, ref: 0.2, base: 0.084 },
    ],
  };
}

/** 目标角：bias + aSin·sin(2π·phase) + aCos·cos(2π·phase) */
export function targetAngle(j: JointSpec, phase: number): number {
  return j.bias + j.aSin * Math.sin(TAU * phase) + j.aCos * Math.cos(TAU * phase);
}

/** 关节的摆动幅度（= sqrt(aSin²+aCos²)），诊断用 */
export function swingAmp(j: JointSpec): number {
  return Math.hypot(j.aSin, j.aCos);
}
export { TAU };
