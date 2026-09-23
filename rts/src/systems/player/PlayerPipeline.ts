// ============================================================
// PlayerPipeline —— 玩家专属每帧管线（《实体架构.md》§7）
// ============================================================
// 职责（WorldMode 不再散落玩家分支）：
//   ① 效果队列 tick（当前仅玩家参与）
//   ② 属性脏刷新（基础+遗物+装备一次聚合）
//   ③ 复活倒计时与复位（阶梯延迟 × 遗物缩短乘区）
// 玩家行为本身（输入/载具/操作锁）在 entity/player/Player.ts；
// 本类只做"每帧编排"，不碰敌/友逻辑。
// ============================================================

import { effectSystem } from '../../services/combat/EffectSystem';
import { queryFinalStats } from '../../services/combat/FinalStats';
import type { Player } from '../../entity/player/Player';

/** ★ 复活倒计时阶梯（按"当天出击内"累计死亡次数分档；每天出击重置）：
 *   1 死瞬间复活 → 2~10 死 5s → 11~20 死 10s → 21~30 死 20s → 31 死起 30s 封顶 */
const RESPAWN_TIERS: { minDeaths: number; delay: number }[] = [
  { minDeaths: 1, delay: 0 },
  { minDeaths: 2, delay: 5 },
  { minDeaths: 11, delay: 10 },
  { minDeaths: 21, delay: 20 },
  { minDeaths: 31, delay: 30 },
];
/** ★ 复活血量保底 = 最大血量 × 该比例（死前一半更低时取保底） */
const RESPAWN_FLOOR_HP_RATIO = 0.1;

/** 模式层依赖（WorldMode 实现；只读调用 + 两个标记） */
export interface PlayerPipelineDeps {
  player: Player;
  /** 属性是否脏（其他系统写脏标记） */
  isStatsDirty(): boolean;
  /** 重算玩家属性（WorldMode.refreshPlayerStats） */
  refreshStats(): void;
  /** 标记属性脏（玩家死亡时触发遗物"每次死亡"生效） */
  markStatsDirty(): void;
  /** 复活倒计时 HUD（null = 隐藏） */
  setRespawnCountdown(sec: number | null): void;
  /** 复活落点（舰船停靠点 / 出生点） */
  respawnPoint(): { x: number; z: number };
  /** 地表高度 */
  surfaceHeightAt(x: number, z: number): number;
  /** 相机瞬移（复活时镜头归位） */
  snapCamera(x: number, y: number, z: number): void;
  /** 世界飘字 */
  showFloating(x: number, y: number, z: number, text: string,
    style: 'normal' | 'crit' | 'heal' | 'miss' | 'pickup'): void;
}

export class PlayerPipeline {
  /** 当天出击内累计死亡次数（复活阶梯 + 遗物死亡事件共用口径） */
  private runDeaths = 0;
  /** 复活倒计时（秒；>0 = 死亡等待中） */
  private respawnTimer = 0;
  /** 已播报的倒计时值（0.1s 粒度，防重复刷新 HUD） */
  private respawnShown = -1;
  /** 遗物复活时间乘区（refreshStats 时写入；<1 = 更快复活） */
  private respawnMul = 1;

  constructor(private deps: PlayerPipelineDeps) {}

  /** 开局 / 换日重置（每天出击重置：首死瞬间复活） */
  resetRun(): void {
    this.runDeaths = 0;
    this.respawnTimer = 0;
    this.respawnShown = -1;
  }

  /** 遗物复活时间乘区（属性重算时写入） */
  setRespawnTimeMul(v: number): void {
    this.respawnMul = v;
  }

  /** ★ 玩家致死（killed 事件玩家分支调用）：分档计时 + 标脏 */
  onPlayerDeath(): void {
    this.deps.markStatsDirty();
    this.runDeaths++;
    let delay = 0;
    for (const t of RESPAWN_TIERS) {
      if (this.runDeaths >= t.minDeaths) delay = t.delay;
    }
    // ★ 遗物缩减（砾小姐的爱等：respawnTimeMul < 1）
    this.respawnTimer = delay * this.respawnMul;
    this.respawnShown = -1;
  }

  /** ★ 每帧：效果队列 → 属性脏刷新 → 复活倒计时 */
  update(dt: number): void {
    const p = this.deps.player;
    if (p.effects) effectSystem.tickEntity(p, dt);
    if (this.deps.isStatsDirty()) this.deps.refreshStats();
    this.updateRespawn(dt);
  }

  /** 复活倒计时推进与复活结算（死前一半，保底最大血量 10%） */
  private updateRespawn(dt: number): void {
    const p = this.deps.player;
    if (!p.dead) return;
    if (this.respawnTimer > 0) {
      this.respawnTimer = Math.max(0, this.respawnTimer - dt);
      const shown = Math.ceil(this.respawnTimer * 10) / 10;
      if (shown !== this.respawnShown) {
        this.respawnShown = shown;
        this.deps.setRespawnCountdown(shown);
      }
      if (this.respawnTimer > 0) return;
    }
    const maxHp = queryFinalStats(p).maxHp;
    const hp = Math.max(p.preDeathHp * 0.5, maxHp * RESPAWN_FLOOR_HP_RATIO);
    // ★ 复活点 = 舰船停靠点（出生点）；死亡期间镜头留在死亡地点
    const sp = this.deps.respawnPoint();
    const pos = p.position;
    pos.x = sp.x;
    pos.z = sp.z;
    pos.y = this.deps.surfaceHeightAt(sp.x, sp.z);
    this.deps.snapCamera(pos.x, pos.y, pos.z);
    p.revive(hp);
    this.respawnShown = -1;
    this.deps.setRespawnCountdown(null);
    this.deps.showFloating(pos.x, pos.y, pos.z, '复活', 'heal');
  }
}
