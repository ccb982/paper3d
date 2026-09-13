// ============================================================
// Director —— 蜂群导演（《蜂群架构.md》§5.8；P4）
// ============================================================
// 职责：节奏（静→试探→突涌→间歇）+ 威胁预算 + intent 分工（打谁 / 包抄）。
// 不再由两个独立计时器刷波次——波次是导演节拍，代理人选与数量受预算约束。
// 输出 = 一次生成订单（锚点 / intent / 数量 / 是否偏成群兵种），由模式层执行。
// ============================================================

/** 攻击意图（代理索敌偏好；255 = 无意图，维持"游走 + 仇恨圈"旧观感） */
export const INTENT_PLAYER = 0;
export const INTENT_SHIP = 1;
export const INTENT_FLANK = 2;
export const INTENT_NONE = 255;

export type DirectorPhase = 'calm' | 'probe' | 'surge' | 'lull';

/** 每名敌人的威胁成本（预算单位） */
const AGENT_COST = 3;
/** 预算上限 */
const BUDGET_MAX = 220;
/** 各阶段预算回复（单位/秒） */
const REGEN: Record<DirectorPhase, number> = { calm: 5, probe: 7, surge: 11, lull: 6 };

/** ★ 大波节奏（2026-09-13 用户定调）：每次 1~2 波、每波人数多、方向集中，便于防守 */
/** 每次事件波数（1~2） */
const EVENT_WAVES: Record<DirectorPhase, number> = { calm: 1, probe: 1, surge: 2, lull: 0 };
/** 每波人数区间 */
const WAVE_COUNT: Record<DirectorPhase, [number, number]> = {
  calm: [5, 7], probe: [7, 10], surge: [10, 14], lull: [0, 0],
};
/** 事件间隔（秒） */
const EVENT_INTERVAL: Record<DirectorPhase, number> = { calm: 15, probe: 12, surge: 9, lull: Infinity };

export interface DirectorInputs {
  dt: number;
  /** 全图存活（实体 + 代理） */
  alive: number;
  playerHpRatio: number;
  playerX: number;
  playerZ: number;
  shipX: number;
  shipZ: number;
}

export interface SpawnOrder {
  anchorX: number;
  anchorZ: number;
  intent: number;
  /** ★ 本次事件的波数（1~2；每波方向集中） */
  waves: number;
  /** ★ 每波人数 */
  count: number;
  /** 偏成群兵种（突涌期洪流感） */
  preferPack: boolean;
}

export class Director {
  phase: DirectorPhase = 'calm';
  private timer = 8;
  /** 距下次生成（独立于阶段计时） */
  private spawnTimer = 3;
  private budget = 40;

  /** 每帧推进；返回生成订单（null = 本帧不刷） */
  update(inp: DirectorInputs): SpawnOrder | null {
    const { dt } = inp;
    this.budget = Math.min(BUDGET_MAX, this.budget + REGEN[this.phase] * dt);
    this.timer -= dt;
    this.spawnTimer -= dt;

    // ---- 阶段切换（压力修正：场上过少加速） ----
    if (this.phase === 'calm') {
      if (inp.alive < 30) this.timer = Math.min(this.timer, 4);
      if (this.timer <= 0) {
        this.phase = 'probe';
        this.timer = 12 + Math.random() * 5;
      }
    } else if (this.phase === 'probe') {
      if (this.timer <= 0) {
        this.phase = 'surge';
        this.timer = 16 + Math.random() * 6;
      }
    } else if (this.phase === 'surge') {
      if (this.timer <= 0) {
        this.phase = 'lull';
        this.timer = 5 + Math.random() * 3;
      }
    } else {
      if (this.timer <= 0) {
        this.phase = 'calm';
        this.timer = 14 + Math.random() * 6;
      }
    }

    // ---- 生成闸门（大波：事件间隔长、单次人数多） ----
    if (inp.playerHpRatio < 0.3) return null;  // 濒死：收手
    if (this.phase === 'lull') return null;    // 间歇期不刷
    if (inp.alive >= 200) return null;
    if (this.spawnTimer > 0) return null;
    const waves = EVENT_WAVES[this.phase];
    const [lo, hi] = WAVE_COUNT[this.phase];
    const count = lo + Math.floor(Math.random() * (hi - lo + 1));
    if (this.budget < count * waves * AGENT_COST) return null;
    this.spawnTimer = EVENT_INTERVAL[this.phase];
    this.budget -= count * waves * AGENT_COST;

    // ---- intent 分工（距离上下文加权） ----
    const dx = inp.playerX - inp.shipX;
    const dz = inp.playerZ - inp.shipZ;
    const playerShipDist = Math.hypot(dx, dz);
    let wShip = 0.3;
    if (playerShipDist < 60) wShip += 0.2;   // 近舰：袭扰压力（可回防）
    else if (playerShipDist > 150) wShip += 0.15; // 远探：后方压力
    const r = Math.random();
    let intent = INTENT_PLAYER;
    if (r < wShip) intent = INTENT_SHIP;
    else if (r < wShip + 0.2) intent = INTENT_FLANK;

    const anchorToShip = intent === INTENT_SHIP;
    return {
      anchorX: anchorToShip ? inp.shipX : inp.playerX,
      anchorZ: anchorToShip ? inp.shipZ : inp.playerZ,
      intent,
      waves,
      count,
      preferPack: this.phase === 'surge',
    };
  }

  /** 当前阶段 + 预算（HUD/调试用） */
  debugInfo(): { phase: DirectorPhase; budget: number } {
    return { phase: this.phase, budget: this.budget };
  }
}
