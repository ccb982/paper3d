/** baseTable.ts —— 基础力矩表 + 目标角度表（v3 架构：状态相关、手动指定）
 *
 *  用户定调（2026-10-17）：
 *   · "基础力在正常站着、单腿站着都是不同的" —— 状态相关表
 *   · "需要手动介入设定目标力矩" —— 表驱动，不运行时算
 *   · "关节回正也要有目标的角度" —— 目标角度表
 *   · "重力补偿说不定在一些中间态或者预测层预测应急的时候可能要用；
 *      一些重要基础的标准姿势可能不需要重力补偿了"
 *     ⇒ 标准姿势查表；中间态/预测应急保留 gcomp
 *
 *  表的来源：gcomp 标定工具测量 + 旧版验证值（150/40/30——703c8bcb 站稳档）
 */

export interface BasePose {
  /** ★ 状态参数集（用户架构：所有参数状态隔离）——回正力 kp/lim 补丁 + CoM */
  params?: {
    comX?: number;           // CoM 目标 x（缺省 0）
    footFloor?: number;      // 踝 tau 地板（站立 15 / 蹲姿 80）
    kneeTwFloor?: number;    // 膝扭转 tau 地板（蹲姿 180）
    hipKpMul?: number;       // 髋 kp 倍率（默认 1）
  };
  /** 基础力矩（N·m，每轴 `${关节}${轴}`） */
  tq: Record<string, number>;
  /** 目标角度（rad，每轴；缺省=初态捕获） */
  ang?: Record<string, number>;
}

export const BASE_TABLE: Record<string, BasePose> = {
  stand: {
    params: { comX: 0, footFloor: 15, kneeTwFloor: 0, hipKpMul: 1 },
    tq: {
      // ★ 2026-10-17 双腿站立标定（旧版150是单腿值；双腿扫描最佳：20/30/40）
      // ★ 2026-10-17 基础力矩表（实测静态重力矩；**右腿原始值**——左腿由镜像自动取反）
      sup_hip0: 0.9, sup_hip1: 0, sup_hip2: 0,
      sup_knee0: -1.3, sup_knee1: 0, sup_knee2: 0,
      sup_foot0: 0, sup_foot1: 0, sup_foot2: 0,
      swing_hip0: 0, swing_hip1: 0, swing_hip2: 80,
      swing_knee0: 0, swing_knee1: 0, swing_knee2: -55,
      swing_foot0: 0, swing_foot1: 0, swing_foot2: 0,
    },
    ang: {
      // S 形脊柱（矢状=轴2；轴2 正=后仰、负=前倾）—— 标准姿态目标角
      spine1_2: -0.07, spine2_2: 0.10, spine3_2: -0.082,
      neck_2: 0.04,
      // 脊柱基础力矩（实测静态重力矩）
    },
  },
  // ★ 2026-10-17 深蹲状态（用户设计：蹲下的状态=三层架构）
  //   蹲姿态角与蹲底静态力矩：探针实测（2026-10-17：[hip=1.0,knee=-1.0,foot=-0.3] → 头79cm）
  //   论文依据：三关节峰值在蹲底；躯干前倾30-40°保 CoM
  squat: {
    params: { comX: 0, footFloor: 80, kneeTwFloor: 180, hipKpMul: 1 },
    tq: {
      // 蹲底静态维持力矩（实测；轴蹢；双腿同值——矢状轴不镜像）
      // ★ 2026-10-18 新姿势实测（法庭共轴折姿势 t0.5s 平衡点 applied 读数）
      sup_hip2: 35, sup_knee2: -220, sup_foot2: 150,   // 迭代2（knee2漂+66→继续加）
      sup_hip0: 0.9, sup_knee0: -1.3, sup_foot0: 0,
      swing_hip2: 80, swing_knee2: -55, swing_foot2: 0,
    },
    ang: {
      // 蹲姿态目标角（回正力的目标；按全名分侧）
      // ★ 2026-10-18 目标姿势（K=2.1+膝前22cm）rotvec实测读数（rad）
      hip0: 0, hip1: 0, hip2: 2.09,
      knee0: 0, knee1: -0.30, knee2: -2.08,
      foot0: 0, foot1: 0, foot2: 0,   // ★ 踝背屈（=法庭摆姿的 ankA！目标0会把踝往回猛拉=脚飞）
      // 躯干前倾（论文：蹲时躯干前倾30-40°配 CoM）
      spine1_2: -0.42, spine2_2: -0.42, spine3_2: -0.42,   // ★ 与法庭摆姿一致（-0.42×3=腰43°）——否则回正力把腰拉回-0.25→后弹
      neck_2: 0.04,
      // ★ 手臂前伸配重（用户：'手臂也要放到前面配重'——与法庭 SQC_ARM 一致）
      shoulder2: 0.5,    // ★ 与法庭一致（手在肩下）
    },
  },
  // ★ 2026-10-17 用户（'单腿也是一个伺服状态'）：占位状态——名字就位，参数待标定
  //   单腿（右腿支撑）——张力/回正/基础力都将是独立的一套
  singleR: {
    params: { comX: 0, footFloor: 15, kneeTwFloor: 0, hipKpMul: 1 },   // 待标定
    tq: {},    // 待标定（右支撑腿/左摆动腿各自的静态力矩表）
    ang: {},   // 待标定（单腿目标姿态）
  },
  // stepR / stepL —— 迈步状态占位（待用）
  stepR: { params: { comX: 0, footFloor: 15, kneeTwFloor: 0, hipKpMul: 1 }, tq: {}, ang: {} },
  stepL: { params: { comX: 0, footFloor: 15, kneeTwFloor: 0, hipKpMul: 1 }, tq: {}, ang: {} },
};

let _state = 'stand';

/** 切换状态（状态机接管；当前默认 stand） */
export function setBaseState(s: string): void { _state = s; }
export function baseState(): string { return _state; }

/** 查表：基础力矩（N·m；缺省 0） */
export function baseTq(jn: string, ax: number, sup = true): number {
  const T = BASE_TABLE[_state] ?? BASE_TABLE.stand!;
  const pre = sup ? 'sup_' : 'swing_';
  return T.tq[`${pre}${jn}${ax}`] ?? T.tq[`${jn}${ax}`] ?? 0;
}

/** ★ 查表：状态参数（comX/kp 地板——状态隔离） */
export function baseParams(): { comX: number; footFloor: number; kneeTwFloor: number; hipKpMul: number } {
  const T = BASE_TABLE[_state] ?? BASE_TABLE.stand!;
  return { comX: 0, footFloor: 15, kneeTwFloor: 0, hipKpMul: 1, ...(T.params ?? {}) };
}

/** 查表：目标角度（rad；undefined=用初态捕获） */
export function baseAng(jn: string, ax: number): number | undefined {
  const T = BASE_TABLE[_state] ?? BASE_TABLE.stand!;
  const a = T.ang;
  if (!a) return undefined;
  // ★ 2026-10-17 兼容两种键：调用方有的传全名（knee_r）、有的传基名（knee）
  return a[`${jn}${ax}`] ?? a[`${jn.replace(/_[lr]$/, '')}${ax}`] ?? a[`${jn}_${ax}`];   // 三种键：knee_r2 / knee2 / spine1_2
}
