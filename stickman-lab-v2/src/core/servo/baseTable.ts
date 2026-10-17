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
  /** 基础力矩（N·m，每轴 `${关节}${轴}`） */
  tq: Record<string, number>;
  /** 目标角度（rad，每轴；缺省=初态捕获） */
  ang?: Record<string, number>;
}

export const BASE_TABLE: Record<string, BasePose> = {
  stand: {
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
  // singleR / singleL / stepR / stepL —— 待标定（用户："单腿站着的表不同"）
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

/** 查表：目标角度（rad；undefined=用初态捕获） */
export function baseAng(jn: string, ax: number): number | undefined {
  const T = BASE_TABLE[_state] ?? BASE_TABLE.stand!;
  return T.ang?.[`${jn}${ax}`];
}
