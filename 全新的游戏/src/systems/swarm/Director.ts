// ============================================================
// Director —— 战斗节奏导演（《蜂群架构.md》§5.8；P4→日节律版）
// ============================================================
// 节奏（2026-09-13 用户定调）：
//   · 平时：少量怪物游荡（环境散兵，无意图）
//   · 每天 1~2 波大举进攻：提前预警（倒计时 + 目标告知）→ 集中大波 → 间歇
//   · 敌人按天增强（血量/攻击/防御），同日第二波更凶
// 输出 = 生成订单（锚点 / intent / 波数 / 每波人数 / 偏成群），由模式层执行；
// 预警/开战/结束 通过 DirectorHooks 交给 UI 层播报。
// ============================================================

/** 攻击意图（代理索敌偏好；255 = 无意图，维持"游走 + 仇恨圈"旧观感） */
export const INTENT_PLAYER = 0;
export const INTENT_SHIP = 1;
export const INTENT_FLANK = 2;
export const INTENT_NONE = 255;

export type DirectorPhase = 'calm' | 'warning' | 'assault' | 'lull';

/** 每名敌人的威胁成本（预算单位） */
const AGENT_COST = 3;
/** 预算上限与回复（单位/秒） */
const BUDGET_MAX = 220;
const REGEN: Record<DirectorPhase, number> = { calm: 5, warning: 6, assault: 10, lull: 6 };

// ---- 日节律（2026-09-13 用户定调：平时少量游荡、每天 1~2 波大举进攻） ----
/** 预警提前量（秒）：预警期内 HUD 倒计时 + 目标告知 */
const WARNING_LEAD = 40;
/** 首波袭击时间区间（秒；自当天出击开始） */
const FIRST_ASSAULT_MIN = 100;
const FIRST_ASSAULT_SPAN = 80;
/** 两波袭击之间的间隔区间（秒） */
const ASSAULT_GAP_MIN = 150;
const ASSAULT_GAP_SPAN = 120;
/** 单次袭击：波数 / 每波人数 / 波间隔（秒）/ 收尾时长（秒） */
const ASSAULT_WAVES_MIN = 3;
const ASSAULT_WAVES_SPAN = 2;
const ASSAULT_WAVE_COUNT_MIN = 8;
const ASSAULT_WAVE_COUNT_SPAN = 7;
const ASSAULT_WAVE_INTERVAL = 7;
const ASSAULT_SETTLE = 30;
/** 间歇时长（秒） */
const LULL_TIME = 18;
/** 平时游荡目标数量：低于此值 → 每 10s 补一只无意图散兵 */
const AMBIENT_TARGET = 15;
const AMBIENT_INTERVAL = 10;

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
  /** 偏成群兵种（大波洪流感） */
  preferPack: boolean;
  /** 袭击序号（0/1；第二波强化 ×1.15 用；环境散兵 = -1） */
  assaultIndex?: number;
  /** 优选扇区（袭击：整场固定主攻方向；环境散兵 = 不指定 → 全向随机） */
  sector?: number;
}

/** UI 播报钩子（预警倒计时 / 开战 / 结束） */
export interface DirectorHooks {
  /** 预警倒计时（秒；每整秒回调一次；null = 清除） */
  onWarning?: (secondsLeft: number, targetLabel: string) => void;
  /** 开战播报 */
  onAssault?: (targetLabel: string) => void;
  /** 结束播报（清除预警/战报） */
  onClear?: () => void;
}

/** 敌人强化倍率（按天） */
export interface EnemyScale {
  hp: number;
  atk: number;
  def: number;
}

interface AssaultPlan {
  at: number;
  waves: number;
  count: number;
  /** 开战前解析（用当时的位置）：目标与标签 */
  intent: number;
  label: string;
  resolved: boolean;
  /** 同日第几波（用于强化） */
  index: number;
}

export class Director {
  phase: DirectorPhase = 'calm';
  private day = 1;
  private dayTime = 0;
  private budget = 60;
  private spawnTimer = AMBIENT_INTERVAL;
  private lullTimer = 0;
  private warnedSecond = -1;

  /** 当日袭击计划（1~2 次） */
  private plan: AssaultPlan[] = [];
  /** 进行中的袭击 */
  private assault: {
    wavesLeft: number;
    count: number;
    intent: number;
    label: string;
    waveTimer: number;
    settle: number;
    /** 主攻扇区（本场固定；各波小幅偏转） */
    sector: number;
    /** 本场总波数（扇区偏转计算用） */
    wavesTotal: number;
  } | null = null;

  /** 敌人强化（按天） */
  private scaleHp = 1;
  private scaleAtk = 1;
  private scaleDef = 0;

  // ============================================================
  // 日生命周期
  // ============================================================

  /** 新的一天（出击开始）调用：重置计时 + 排 1~2 次袭击 */
  beginDay(day: number, hooks?: DirectorHooks): void {
    this.day = Math.max(1, day);
    this.dayTime = 0;
    this.phase = 'calm';
    this.assault = null;
    this.warnedSecond = -1;
    this.spawnTimer = 3;
    // 按天强化（封顶 3×；同日第二波再 ×1.15）
    const d = this.day - 1;
    this.scaleHp = Math.min(3, 1 + d * 0.12);
    this.scaleAtk = Math.min(2.5, 1 + d * 0.08);
    this.scaleDef = Math.min(20, Math.floor(d * 0.8));

    const n = 1 + (Math.random() < 0.55 ? 1 : 0); // 每天 1~2 波
    this.plan = [];
    let t = FIRST_ASSAULT_MIN + Math.random() * FIRST_ASSAULT_SPAN;
    for (let i = 0; i < n; i++) {
      this.plan.push({
        at: t,
        waves: ASSAULT_WAVES_MIN + Math.floor(Math.random() * ASSAULT_WAVES_SPAN),
        count: ASSAULT_WAVE_COUNT_MIN + Math.floor(Math.random() * ASSAULT_WAVE_COUNT_SPAN),
        intent: INTENT_PLAYER,
        label: '玩家',
        resolved: false,
        index: i,
      });
      t += ASSAULT_GAP_MIN + Math.random() * ASSAULT_GAP_SPAN;
    }
    hooks?.onClear?.();
  }

  /** 当前敌人强化倍率（生成时乘算；同日第二波已含 ×1.15） */
  scale(assaultIndex = -1): EnemyScale {
    const bonus = assaultIndex > 0 ? 1.15 : 1;
    return { hp: this.scaleHp, atk: this.scaleAtk * bonus, def: this.scaleDef };
  }

  /** 当天是否还有未打的袭击（HUD/调试） */
  planRemaining(): number {
    return this.plan.length;
  }

  // ============================================================
  // 每帧推进
  // ============================================================

  update(inp: DirectorInputs, hooks?: DirectorHooks): SpawnOrder | null {
    const { dt } = inp;
    this.dayTime += dt;
    this.budget = Math.min(BUDGET_MAX, this.budget + REGEN[this.phase] * dt);

    if (this.phase === 'calm') {
      // ---- 平时：少量怪物游荡（低频补散兵） ----
      this.spawnTimer -= dt;
      const next = this.plan[0];
      if (next) {
        const remain = next.at - this.dayTime;
        if (remain <= WARNING_LEAD) {
          if (!next.resolved) {
            const r = Math.random();
            const dx = inp.playerX - inp.shipX, dz = inp.playerZ - inp.shipZ;
            const nearShip = dx * dx + dz * dz < 60 * 60;
            next.intent = r < (nearShip ? 0.5 : 0.35) ? INTENT_SHIP : r < 0.75 ? INTENT_FLANK : INTENT_PLAYER;
            next.label = next.intent === INTENT_SHIP ? '舰船' : '玩家';
            next.resolved = true;
          }
          this.phase = 'warning';
          this.warnedSecond = -1;
        }
      }
      if (this.phase === 'calm' && this.spawnTimer <= 0) {
        this.spawnTimer = AMBIENT_INTERVAL;
        if (inp.alive < AMBIENT_TARGET && inp.playerHpRatio >= 0.3) {
          return {
            anchorX: inp.playerX, anchorZ: inp.playerZ,
            intent: INTENT_NONE,
            waves: 1, count: 1,
            preferPack: false,
          };
        }
      }
      return null;
    }

    if (this.phase === 'warning') {
      const next = this.plan[0];
      if (!next) {
        this.phase = 'calm';
        return null;
      }
      const remain = Math.max(0, next.at - this.dayTime);
      const sec = Math.ceil(remain);
      if (sec !== this.warnedSecond || this.warnedSecond < 0) {
        this.warnedSecond = sec;
        hooks?.onWarning?.(sec, next.label);
      }
      if (remain <= 0) {
        // ---- 开战 ----
        this.phase = 'assault';
        this.assault = {
          wavesLeft: next.waves,
          count: next.count,
          intent: next.intent,
          label: next.label,
          waveTimer: 0.5,
          settle: ASSAULT_SETTLE,
          sector: Math.random() * Math.PI * 2,
          wavesTotal: next.waves,
        };
        hooks?.onAssault?.(next.label);
      }
      return null;
    }

    if (this.phase === 'assault') {
      const a = this.assault;
      if (!a) {
        this.phase = 'lull';
        this.lullTimer = LULL_TIME;
        return null;
      }
      if (a.wavesLeft > 0) {
        a.waveTimer -= dt;
        if (a.waveTimer <= 0 && this.budget >= a.count * AGENT_COST) {
          a.waveTimer = ASSAULT_WAVE_INTERVAL;
          a.wavesLeft--;
          this.budget -= a.count * AGENT_COST;
          if (a.wavesLeft <= 0) a.settle = ASSAULT_SETTLE;
          const ship = a.intent === INTENT_SHIP;
          return {
            anchorX: ship ? inp.shipX : inp.playerX,
            anchorZ: ship ? inp.shipZ : inp.playerZ,
            intent: a.intent,
            waves: 1,
            count: a.count,
            preferPack: true,
            assaultIndex: this.plan[0]?.index ?? 0,
            // 同场袭击固定主攻扇区，各波 +0.6rad 偏移（一侧压上，不四面开花）
            sector: a.sector + (a.wavesTotal - a.wavesLeft) * 0.6,
          };
        }
      } else {
        a.settle -= dt;
        if (a.settle <= 0) {
          hooks?.onClear?.();
          this.plan.shift();
          this.phase = 'lull';
          this.lullTimer = LULL_TIME;
        }
      }
      return null;
    }

    // ---- lull（间歇）：不刷 ----
    this.lullTimer -= dt;
    if (this.lullTimer <= 0) this.phase = 'calm';
    return null;
  }

  /** 当前阶段 + 预算（HUD/调试用） */
  debugInfo(): { phase: DirectorPhase; budget: number; day: number; plan: number } {
    return { phase: this.phase, budget: this.budget, day: this.day, plan: this.plan.length };
  }
}
