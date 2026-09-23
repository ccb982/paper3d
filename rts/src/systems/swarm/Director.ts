// ============================================================
// Director —— 攻势播报器（M3.5 收敛：旧"日节律/波次/预算"已删）
// ============================================================
// 节奏唯一来源 = PostureFn（schedule + provocation）；
// 本模块只做 UI 播报：大队姿态 mass → 预警、assault → 开战、回落 → 清除。
// （旧实现里的刷怪订单/预算/计划全部删除；兵力由账本 releaseCap + 指挥器释放。）
// ============================================================

import { neutralThreat, type ThreatProfile } from './EnemyScaling';

/** 攻击意图（代理索敌偏好；255 = 无意图，维持"游走 + 仇恨圈"旧观感） */
export const INTENT_PLAYER = 0;
export const INTENT_SHIP = 1;
export const INTENT_FLANK = 2;
export const INTENT_NONE = 255;

export type DirectorPhase = 'calm' | 'warning' | 'assault' | 'lull';

/** 波次订单（保留类型以兼容旧接线；新节律不再产出订单） */
export interface SpawnOrder {
  anchorX: number;
  anchorZ: number;
  intent: number;
  waves: number;
  count: number;
  preferPack: boolean;
  assaultIndex?: number;
  sector?: number;
}

/** UI 播报钩子 */
export interface DirectorHooks {
  /** 预警（secondsLeft = 0 表示"即将来袭"；null = 清除） */
  onWarning?: (secondsLeft: number, targetLabel: string) => void;
  /** 开战播报 */
  onAssault?: (targetLabel: string) => void;
  /** 结束播报（清除预警/战报） */
  onClear?: () => void;
}

export class Director {
  phase: DirectorPhase = 'calm';
  private day = 1;
  private hooks: DirectorHooks | undefined;
  private warned = false;
  private assaulted = false;
  private threat: ThreatProfile = neutralThreat();

  /** 威胁档案（UI 标签/难度仍由模式层读取；本模块只存不消费） */
  setThreat(t: ThreatProfile): void {
    this.threat = t;
  }

  /** 新的一天：复位播报状态 */
  beginDay(day: number, hooks?: DirectorHooks): void {
    this.day = Math.max(1, day);
    this.hooks = hooks;
    this.phase = 'calm';
    this.warned = false;
    this.assaulted = false;
    hooks?.onClear?.();
  }

  /** ★ 每帧（WorldMode explore 调用）：用大队姿态驱动播报（幂等，只在跨越时触发） */
  announce(posture: string, p = 0): void {
    const h = this.hooks;
    if (!h) return;
    if (!this.warned && (posture === 'mass' || p >= 0.55)) {
      this.warned = true;
      this.phase = 'warning';
      h.onWarning?.(0, '玩家');
    }
    if (!this.assaulted && (posture === 'assault' || p >= 0.8)) {
      this.assaulted = true;
      this.phase = 'assault';
      h.onAssault?.('玩家');
    }
    if (this.assaulted && (posture === 'patrol' || posture === 'fortify')) {
      this.assaulted = false;
      this.warned = false;
      this.phase = 'lull';
      h.onClear?.();
    }
  }

  planRemaining(): number {
    return 0;
  }

  debugInfo(): { phase: DirectorPhase; budget: number; day: number; plan: number } {
    return { phase: this.phase, budget: 0, day: this.day, plan: 0 };
  }
}
