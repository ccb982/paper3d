// ============================================================
// PostureFn —— 连续态势函数（M2；《RTS架构.md》§2/§3.5）
// ============================================================
// p = clamp(schedule(t) + provocation, 0, 1)
//   schedule：单日节律（时间主导：0.45 第一波 / 0.80 总攻）
//   provocation：挑衅累加（击杀/被击/工事被拆）→ 指数衰减，上限 +0.35
// 迟滞：上升快、回落慢；总攻进入后锁定，仅 withdraw 安全阀可打断。
// 已接线（M2）：data/SwarmData.tick 读太阳钟（世界 6:00=0 / 18:00=1）+ 挑衅采样；
// 节奏口径 = 从落地起算、黄昏到 1（落地即黄昏 → 直接满节奏）。
// ============================================================

import type { BattlePosture } from './Posture';

/** 单日节律锚点 [dayProgress, schedule]（分段线性） */
const SCHEDULE_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0.00, 0.00],
  [0.10, 0.10],
  [0.30, 0.25],
  [0.45, 0.45],   // 第一波
  [0.65, 0.60],
  [0.80, 0.90],   // 总攻
  [1.00, 1.00],
];

/** ★ 兵力放行曲线：早间只放少量（扎根），随后补满基数，两个波峰放宽 */
const RELEASE_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0.00, 0.20],
  [0.30, 0.50],
  [0.45, 0.75],   // 第一波
  [0.65, 0.95],
  [0.80, 1.00],   // 总攻：满编
  [1.00, 1.00],
];

/** ★ 白昼窗口（与 SunCycle 的 SUNRISE/SUNSET 对齐）：白天 6:00~18:00 */
export const DAWN_HOUR = 6;
export const DUSK_HOUR = 18;

/** 太阳小时 → 当日进度 0~1（6:00 = 0，18:00 = 1；夜晚钳到端点） */
export function dayT01FromHour(hour: number): number {
  return clamp01((hour - DAWN_HOUR) / (DUSK_HOUR - DAWN_HOUR));
}

/** 锚点分段线性采样 */
function sampleAnchors(anchors: ReadonlyArray<readonly [number, number]>, v: number): number {
  const t = clamp01(v);
  let a = anchors[0];
  for (const b of anchors) {
    if (t <= b[0]) {
      const span = b[0] - a[0];
      const k = span > 0 ? (t - a[0]) / span : 0;
      return a[1] + (b[1] - a[1]) * k;
    }
    a = b;
  }
  return 1;
}

export function scheduleAt(dayT01: number): number {
  return sampleAnchors(SCHEDULE_ANCHORS, dayT01);
}

/** ★ 兵力放行比例 0~1（指挥器每拍写入账本 releaseCap） */
export function releaseAt(dayT01: number): number {
  return sampleAnchors(RELEASE_ANCHORS, dayT01);
}

/** 姿态阈值（由 p 映射；assault 后锁定） */
const P_FORTIFY = 0.22;
const P_ADVANCE = 0.30;
const P_MASS = 0.55;
const P_ASSAULT = 0.80;

/** 挑衅衰减参数（秒） */
const PROV_TAU = 90;
const PROV_MAX = 0.35;
/** 姿态停留最短时间（秒；只约束"降级/平移"，升级立即生效） */
const DWELL: Partial<Record<BattlePosture, number>> = { fortify: 6, patrol: 10, advance: 8, mass: 6, assault: 5 };
/** 姿态强度次序（升级 = 立即；降级 = 过 DWELL 才回落） */
const POSTURE_RANK: Record<BattlePosture, number> = {
  fortify: 0, patrol: 1, advance: 2, withdraw: 2, mass: 3, assault: 4,
};

export interface PostureState {
  p: number;
  schedule: number;
  provocation: number;
  posture: BattlePosture;
  /** ★ 稳步推进闸门 0~1：整条战线离舰角落差的放行比例（只进不退，见 FRONT_TAU） */
  frontP: number;
}

/** ★ 稳步推进：各姿态的**离舰前沿放行上限**（fortify 起手顶多放开一点；总攻才贴近船）
 *  frontP 只增长、单调向目标值逼近 —— 事态再落也不再回拉阵地（《RTS架构.md》§3.9） */
const FRONT_BY_POSTURE: Record<BattlePosture, number> = {
  fortify: 0.00,
  patrol: 0.15,
  advance: 0.40,
  mass: 0.70,
  assault: 0.95,
  withdraw: 0.15,   // 撤退重组的"前沿锚"回落许可（但 frontP 单调，此处只影响目标值不再起作用）
};
/** 前沿放行的逼近时间常数（越大越"稳步"；63% 到达耗时）
 *  ★ 2026-09-25 用户定：40 → 18（第一波前压时间太长，加快放行） */
const FRONT_TAU = 18;

export class PostureFn {
  private prov = 0;
  private posture: BattlePosture = 'fortify';
  private since = 0;
  private locked = false;   // 总攻锁定（只有 withdraw 能解）
  private frontP = 0;       // ★ 稳步推进闸门（单调不降）

  reset(now: number): void {
    this.prov = 0;
    this.posture = 'fortify';
    this.since = now;
    this.locked = false;
    this.frontP = 0;
  }

  /** 调试/测试：强制切姿态（不走 p 阈值；总攻同样锁定） */
  force(p: BattlePosture, now: number): void {
    this.posture = p;
    this.since = now;
    this.locked = p === 'assault';
  }

  /** 事件挑衅：击杀 / 被击 / 工事被拆（外部按权重调用） */
  provoke(amount: number): void {
    this.prov = Math.min(PROV_MAX, this.prov + Math.max(0, amount));
  }

  /** 每拍更新（dt 秒；dayT01 = 当日进度 0~1；aliveRatio 供撤退安全阀） */
  update(dt: number, dayT01: number, aliveRatio: number, now: number): PostureState {
    if (this.since === 0) this.since = now;
    this.prov *= Math.exp(-dt / PROV_TAU);   // 回落慢

    const schedule = scheduleAt(dayT01);
    const p = clamp01(schedule + this.prov);
    const hold = now - this.since;

    let next = this.posture;
    if (this.locked) {
      // 总攻锁定：只受 withdraw 安全阀影响（损 60%）
      if (aliveRatio < 0.4) { next = 'withdraw'; this.locked = false; }
    } else {
      // ★ 上升快、回落慢：升级立即生效；降级要过最短停留（防抖）
      let target: BattlePosture = 'fortify';
      if (p >= P_ASSAULT) target = 'assault';
      else if (p >= P_MASS) target = 'mass';
      else if (p >= P_ADVANCE) target = 'advance';
      else if (p >= P_FORTIFY) target = 'patrol';
      const up = POSTURE_RANK[target] > POSTURE_RANK[this.posture];
      if (up || hold >= (DWELL[this.posture] ?? 0)) next = target;
      if (this.posture === 'withdraw' && (hold > 30 || p >= P_ADVANCE)) next = 'patrol';
    }
    if (next !== this.posture) {
      this.posture = next;
      this.since = now;
      if (next === 'assault') this.locked = true;
    }
    // ★ 稳步推进闸门：随姿态档单调放开（只进不退；FRONT_TAU 决定"再稳一点"）
    const fpTarget = FRONT_BY_POSTURE[this.posture];
    if (this.frontP < fpTarget) {
      this.frontP += (fpTarget - this.frontP) * (1 - Math.exp(-dt / FRONT_TAU));
    }
    return { p, schedule, provocation: clamp01(this.prov), posture: this.posture, frontP: this.frontP };
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
