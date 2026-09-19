// ============================================================
// EventBus.ts —— 类型安全事件总线
// 跨系统横向解耦通信
// ============================================================

/** 事件定义（枚举 + 泛型负载） */
export interface EventMap {
  // 拾取事件
  'pickup': { itemId: string; position: { x: number; z: number } };
  // 守卫警报
  'ship_alert': { wave: number; direction: number };
  // 抽卡结果
  'gacha_result': { result: any };
  // 对话/事件
  'dialogue': { id: string };
  'story_event': { id: string };
  // 死亡/结算
  'death': { entityId: number };
  'run_end': { survived: number };
  // 背包变动
  'inventory_change': { layer: string };
  // 遗物获得
  'relic_acquired': { relicId: string };
  // 科技树解锁
  'tech_unlock': { nodeId: string };
  // 模式切换
  'mode_switch': { from: string; to: string };
  // 存档变更
  'save_complete': {};
  // 每日进度
  'day_advance': { day: number };
  // ★ 伤害事件（用于显示伤害数字 / 战斗导演编排打击反馈）
  'damage': {
    target: import('../entity/EntityBase').EntityBase;
    /** ★ 伤害来源（子弹实体/近战发起者；主角攻击=player camp，浮动数字据此过滤） */
    source: import('../entity/EntityBase').EntityBase | null;
    damage: number;
    crit: boolean;
    dodged: boolean;
    blocked: boolean;
    /** ★ 伤害类型（'physical' 默认；类型化管线后由 applyDamage 统一带出） */
    type?: string;
  };
  // ★ 击杀事件（CombatDirector 编排击杀定格等）
  'killed': {
    target: import('../entity/EntityBase').EntityBase;
    source: import('../entity/EntityBase').EntityBase | null;
  };
  // ★ 舰船受击（结算/UI/复活流程用）
  'ship_damaged': {
    damage: number;
    destroyed: boolean;
  };
  // ★ 无人机召唤事件（WorldMode 订阅；使用「可露希尔的无人机」道具触发）
  'drone_summon': { x?: number; z?: number };
  // ★ 祖宗召唤事件（WorldMode 订阅；使用「祖宗」局内道具触发 → 身前放置站桩友军）
  'sentinel_summon': { x?: number; z?: number };
  // ★ 城墙/墙部署事件（WorldMode 订阅；「城墙」「墙」→ 沿准星发射投送弹，落点生成）
  'cover_summon': { x?: number; z?: number; variant?: 'cover' | 'wall' };
  // ★ 出击槽池变动（背包页面拖入/拖出/替换；WorldMode 订阅生成/回收友军 + 贴片兜底同步）
  'deployment_changed': { slotIndex: number; itemId: string | null; prev: string | null };
  // ★ 存档基础属性被永久改写（「训练类」消耗品，如糖果加上限）；
  //   WorldMode 订阅 → 重算玩家实体；BaseMode 订阅 → 刷新属性面板
  'player_stats_changed': { reason: string };
  // ★ 敌人真击杀（2026-09-16 击杀统计）：**仅统计口径**，不影响掉落/遗物管线。
  //   由 EnemyBase.onRetire('killed') 发出（2026-09-18 起退役原因收口）；
  //   降格/回收/清场走其他 reason，不触发本事件。
  //   代理路径由 WorldMode.onAgentKilled 直接记数（不发本事件，避免双计）。
  'enemy_killed': {
    source: import('../entity/EntityBase').EntityBase | null;
    x: number;
    z: number;
  };
  // ★ 敌人受击（步骤 10 自主 LOD）：实体被击广播 → WorldMode 转交 swarm.noteHit
  'enemy_hit': { squadId: number };
}

export type EventKey = keyof EventMap;
export type EventHandler<K extends EventKey = EventKey> = (payload: EventMap[K]) => void;

export class EventBus {
  private listeners = new Map<string, Set<EventHandler>>();

  /** 订阅事件 */
  on<K extends EventKey>(key: K, handler: EventHandler<K>): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(handler as EventHandler);
    return () => {
      this.listeners.get(key)?.delete(handler as EventHandler);
    };
  }

  /** 发送事件 */
  emit<K extends EventKey>(key: K, payload: EventMap[K]): void {
    const handlers = this.listeners.get(key);
    if (!handlers) return;
    for (const handler of handlers) {
      handler(payload);
    }
  }

  /** 清除所有订阅 */
  clear(): void {
    this.listeners.clear();
  }
}

/** 全局单例 */
export const eventBus = new EventBus();